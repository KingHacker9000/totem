# Muse companion sidecar (Pi deployment, work in progress)

This optional deployment service owns companion semantic state, alerts and timers
beside the existing Totem core release. It does not change core, load a private
character, replace the kiosk, or embed Muse transport in core. The Muse service
uses the unmodified upstream Linux SDK with a restricted executor/registry.
Private artwork remains in the theme repository. This is an incremental adapter
for the existing Pi installation, not a new core or extension SDK contract.

Tracked by epic #109 and #93–108. The original installed idle is the visual
baseline; final visual additions must come from Claude Design. No new artwork
is shipped in this directory.

## Current boundaries

- HTTP binds to `127.0.0.1:4181`; 4180 is the existing authenticated admin.
- `GET /state`, `GET /events` (SSE), `POST /heartbeat` and `POST /command`
  are presentation endpoints. Browser commands are a narrow subset, without
  generic notification injection, core restart or display restart.
- The group-protected `/run/totem-companion/commands.sock` accepts one newline
  JSON `{ "command": "totem.health", "args": {} }` per connection. Muse's
  restricted executor uses this socket. Arguments are validated in the sidecar,
  independently of the model's tool schemas.
- Muse advertises only `totem.*`: avatar state/look/reaction, notification/card,
  acknowledgement, health, focus, next/briefing, brightness and fixed recovery.
  Shell and file commands are neither registered nor executable.
- Muse runs as `musegadget`, with no sudo and `NoNewPrivileges`. Credentials
  and identity are in `/var/lib/musegadget` (0700); companion data is owned by
  `totem-companion` on the HDD (0700). The common group permits sockets and
  transport status, not credential or application-state directory access.
- The recovery helper takes only a fixed kiosk/core unit or integer backlight
  percentage. Its root-owned path is the only sudo grant to `totem-companion`.
  No service name, shell, path, URL, reboot, deletion or network-setting tool is
  exposed to Muse.
- Core restart is unavailable by default (`TOTEM_COMPANION_APPROVALS` unset).
  When a real physical confirmation UI is integrated, opt-in allows expiring,
  single-use requests. Remote tools cannot approve their own requests. A future
  remote approval protocol must authenticate an explicit human confirmation,
  rather than trusting another model tool call.
- Auto kiosk restart is opt-in (`TOTEM_COMPANION_AUTO_RECOVER=1`) and requires
  the active original display to send heartbeats. Leave it disabled until that
  integration is verified. Existing systemd crash restarts remain in place.

## State and delivery

`state.json` is atomically replaced and flushed on the HDD, with a flushed backup. Invalid state is preserved and a backup restored, or a fresh state used with a persistent recovery notice. Persistent events, acknowledgements,
focus timers, outbox, delivery counters and bounded audit survive service restarts.
Critical alerts require acknowledgement; ordinary cards expire. Recently expired
or acknowledged dedupe keys are remembered for 24 hours (bounded to 512). Each source may hold at most 16 queued events.
The event and outbox queues cap at 128. Messages expire after 24 hours, retry with
bounded backoff and use stable source sessions; global limit six/hour and two/hour
per source. Quiet hours are 22:00–07:00 in the configured service timezone; urgent
and critical messages bypass quiet hours but not rate limits. Focus suppresses
ordinary display cards. Remote notifications never echo back to Muse.

The monitor reads existing navigation/widgets/attention on 4174 and core `/health`
on 3000. Existing calendar, academic, GitHub and SwingLab adapters continue running.
Attention records are normalized for the outbox without changing their producers.
The current original screen is **not yet subscribed to companion state**. Thus
backend command success is not proof of final on-screen behavior. Preserved idle,
Claude Design presentation integration, physical controls and adapter acknowledgements
must be finished before closing visual issues. Automatic briefing scheduling and
printing/local-job adapters are also not complete.

## Install on the inspected Pi

These sample units document the actual checkout paths; adapt them for another host.
Code and venv are HDD-backed. Do not change `/opt/totem/current`, the existing theme
files or the kiosk URL. Create system users `totem-companion` and `musegadget` with
shared group `totem-companion`, shell `/usr/sbin/nologin`, and no additional groups.
Create `/srv/pi-hdd/totem-companion-state` owned by `totem-companion` mode 0700, and
`/var/lib/musegadget` owned by `musegadget` mode 0700.

Upstream SDK pin: `facebookincubator/muse-gadget-sdk` commit
`74a5e2d7fc895f109f83a9a1dbed705dbcd8b1ff`. Keep its clone at
`/srv/pi-hdd/totem-companion-work/muse-gadget-sdk`. Review
[upstream Linux documentation](https://github.com/facebookincubator/muse-gadget-sdk/tree/74a5e2d7fc895f109f83a9a1dbed705dbcd8b1ff/linux).
Use distro Python with `--system-site-packages` for cryptography, D-Bus and GI:

```sh
python3 -m venv --system-site-packages /srv/pi-hdd/totem-companion-work/muse-venv
/srv/pi-hdd/totem-companion-work/muse-venv/bin/pip install --no-cache-dir --require-hashes -r /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux/src/musegadget/data/requirements.lock
/srv/pi-hdd/totem-companion-work/muse-venv/bin/pip install --no-cache-dir --no-deps /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux
```

Install `recover.sh` as root-owned executable
`/usr/local/libexec/totem-companion-recover`; validate `sudoers.example` with
`visudo -cf` and install mode 0440 to `/etc/sudoers.d/totem-companion`.
Install the units, `systemctl daemon-reload`, then enable/start the two new services.
They wait for HDD code paths and restart independently. `/etc/totem-companion.env`
may configure optional display root/recovery; the samples do not reference a
private theme. The inspected Pi service timezone is `America/New_York`.

## Pair later (requires SDK token and the user's phone)

Pairing is intentionally not started without the user. Store the token in
`/var/lib/musegadget/sdk_token`, owned by `musegadget`, mode 0600, without placing
it in shell arguments, source, issue text or normal Totem data. Use the official
Muse app and SDK token flow. Before pairing, review the upstream BlueZ GATT
`ExchangeMTU=256` requirement; this Pi's Bluetooth config has not been changed yet.

```sh
sudo -u musegadget /srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m musegadget info
sudo -u musegadget /srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m musegadget pair
sudo journalctl -u musegadget -f
```

In Muse app Settings → Devices, enable Developer mode and add the advertised
MuseGadget device. Verify logs say `registered with the Muse`, then run harmless
health/reaction commands from the phone. Never launch upstream `musegadget run`:
it advertises shell/file tools. The installed service launches `muse_bridge.py`.
For unpairing, run the CLI `unpair` as `musegadget` and restart this service.
Identity persists. Neither pairing nor Muse failure restarts core.

## Verification and upgrade

```sh
pnpm test:companion
/srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m unittest discover -s deploy/companion -p '*_test.py'
/srv/pi-hdd/totem-companion-work/muse-venv/bin/python -m pytest -q /srv/pi-hdd/totem-companion-work/muse-gadget-sdk/linux/tests
```

The wrapper uses upstream Service's pinned registry/current-session fields. On SDK
upgrade, review these interfaces, pin the new source and dependencies, rerun tests
and verify pairing/reconnect/phone tools before claiming upgrade compatibility.

## Rollback

The original kiosk and core are unchanged. Disable/stop only `musegadget` and
`totem-companion`, remove their units and the recovery sudoers grant/helper if
uninstalling. Retain state and pairing until explicitly asked to remove them.
There is no core release migration. Core rollback still uses its existing release
symlink. Preserve the original theme checkout for Claude Design implementation.
