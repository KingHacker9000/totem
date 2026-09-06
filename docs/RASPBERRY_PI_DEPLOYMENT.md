# Raspberry Pi deployment

Totem uses the same core, extension, theme, provider, task, and event contracts on Raspberry Pi as it does on a development PC. The Pi deployment layer packages those existing contracts; it does not introduce Pi-only product semantics.

This phase is software-only. It deliberately does not select a display, microphone, amplifier, speaker, LED controller, enclosure, or other physical component.

## Supported baseline

- 64-bit Linux with systemd (Raspberry Pi OS or another Debian-family distribution is the primary target).
- Node.js >= 22.20.0.
- pnpm 10.x.
- A normal checkout or release tree of this repository.

The default service binds core to localhost. A reverse proxy or remote-node layer should be used when remote access is intentionally enabled; do not expose the core API directly by changing the bind address without also considering authentication and firewall policy.

## Install

From a checked-out release:

```bash
sudo bash deploy/pi/install.sh
```

The installer:

1. verifies systemd, Node, pnpm, tar, and the supported Node version floor;
2. creates a locked-down `totem` service account when needed;
3. stages a clean source snapshot into `/opt/totem/releases/<timestamp>` without `.git`, `node_modules`, or previous `dist` output;
4. runs `pnpm install --frozen-lockfile` and `pnpm build`;
5. atomically points `/opt/totem/current` at the new release;
6. creates `/etc/totem/totem.env` on first install;
7. installs/enables/restarts `totem.service`.

No mutable application state is stored in the release directory, so release rollback does not roll back or overwrite task history/configuration.

### Custom release/state locations

The installer accepts environment overrides:

```bash
sudo env \
  TOTEM_PREFIX=/opt/totem \
  TOTEM_STATE_DIR=/srv/totem-data \
  bash deploy/pi/install.sh
```

`TOTEM_STATE_DIR` controls the directory the installer creates and owns. Set the matching `TOTEM_DATA_DIR` in `/etc/totem/totem.env` when using a non-default state location.

For an external HDD, prefer mounting the filesystem at a stable path such as `/srv/totem-data` via `/etc/fstab`, then set `TOTEM_DATA_DIR=/srv/totem-data`. Do not identify storage by transient `/dev/sdX` names. The systemd unit intentionally permits relocatable writable state while keeping `/usr`, `/boot`, and `/etc` read-only to the service.

## Service lifecycle

```bash
sudo systemctl status totem --no-pager
sudo systemctl restart totem
sudo systemctl stop totem
sudo journalctl -u totem -f
```

The service restarts after unexpected failures with a bounded retry rate. Normal SIGTERM shutdown is passed to the existing core lifecycle so SQLite and task state can close cleanly.

## Safe/headless defaults

`deploy/pi/totem.env.example` starts with replaceable driver selections:

```text
TOTEM_DISPLAY_DRIVER=headless
TOTEM_TOUCH_DRIVER=none
TOTEM_AUDIO_DRIVER=none
TOTEM_LED_DRIVER=virtual
```

The `@totem/device-drivers` package defines hardware-independent display/touch/audio/LED interfaces plus headless/none/virtual defaults. These are software seams, not frozen physical-driver implementations. Hardware-specific implementations must consume the same semantic contracts instead of introducing component-specific behavior into core.

## Recovery and rollback

A failed application release can be rolled back without touching durable state:

```bash
sudo bash deploy/pi/rollback.sh
```

The helper points `/opt/totem/current` to the most recent previous release and restarts the service.

If the service enters a restart loop:

```bash
sudo systemctl stop totem
sudo journalctl -u totem -n 200 --no-pager
sudo bash deploy/pi/diagnose.sh
```

Then either repair `/etc/totem/totem.env`, roll back the application release, or temporarily run core manually with safe/headless driver configuration. Do not delete `TOTEM_DATA_DIR` as a generic recovery step because it contains durable task/session state.

## Diagnostics and performance baseline

Run:

```bash
sudo bash deploy/pi/diagnose.sh
```

It reports service status, core health, filesystem capacity, memory, recent logs, and available CPU temperature/throttling telemetry (`vcgencmd` when installed, otherwise Linux thermal sysfs).

Performance tuning should record at least:

- idle and active-task RSS;
- CPU temperature under sustained task/UI load;
- throttling state;
- state-filesystem capacity/latency problems;
- core health latency and restart behavior.

No enclosure/cooling conclusion should be drawn from these software metrics until representative hardware and an enclosure prototype exist.

## Update/rollback contract

The timestamped `releases/` directory plus atomic `current` symlink is the local primitive that later registry/update work can drive. An updater should stage and validate a new release before moving `current`; application rollback must leave `/var/lib/totem` or another configured `TOTEM_DATA_DIR` untouched.

## Hardware gate

This deployment work does **not** authorize:

- selecting or freezing screen/audio/LED/power/cooling components;
- enclosure CAD;
- physical fit, acoustic, thermal, or electrical validation;
- product-specific cosmetic geometry.

Those remain later hardware tasks after representative parts are explicitly selected and measured.
