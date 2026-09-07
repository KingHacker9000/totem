# Totem decommission and reinstall

Totem's Raspberry Pi deployment separates immutable application releases from durable operator state. Decommissioning therefore removes the service and release tree by default while preserving state, backups, and configuration for a future reinstall.

## Preview

Before removing anything, preview the exact plan:

```bash
sudo node /opt/totem/current/deploy/pi/decommission.mjs --dry-run --json
```

Environment overrides are the same paths used by the installer:

- `TOTEM_PREFIX` defaults to `/opt/totem`;
- `TOTEM_STATE_DIR` defaults to `/var/lib/totem`;
- `TOTEM_CONFIG_DIR` defaults to `/etc/totem`;
- `TOTEM_SERVICE_FILE` defaults to `/etc/systemd/system/totem.service`.

## State-preserving decommission

Run from the currently installed release:

```bash
sudo node /opt/totem/current/deploy/pi/decommission.mjs
```

The command stops and disables `totem.service`, removes the systemd unit and immutable release tree, then reloads systemd. It deliberately preserves the durable state directory and configuration directory. Release-grade backups stored beneath the state root are therefore preserved as well.

The operation is idempotent: rerunning it after runtime/service artifacts are already absent leaves preserved state/configuration untouched.

If systemd reports an unexpected failure while stopping/disabling the service, decommission fails instead of continuing with a partially quiesced runtime. "not found/not loaded" is treated as an already-decommissioned state.

## Reinstall after a preserved decommission

Reinstall from a clean checkout or release tree with the same path overrides used previously:

```bash
sudo env \
  TOTEM_STATE_DIR=/var/lib/totem \
  bash deploy/pi/install.sh
```

The installer recreates `/opt/totem` and `totem.service` but does not replace an existing `/etc/totem/totem.env`. Existing durable state remains in place. After reinstall, run the normal lifecycle validation:

```bash
sudo node /opt/totem/current/deploy/pi/lifecycle-check.mjs --restart
```

If the deployment used an external disk, remount it at the same stable path before reinstalling. Do not point `TOTEM_STATE_DIR` at an empty replacement location if the intention is to reuse preserved state.

## Destructive purge

State deletion is intentionally separate and requires both an explicit purge flag and an exact confirmation token:

```bash
sudo node /opt/totem/current/deploy/pi/decommission.mjs \
  --purge-state \
  --confirm PURGE-TOTEM-STATE
```

Configuration is still preserved by that command. To delete configuration as well, add `--purge-config` with the same confirmation token.

A purge request without the exact confirmation fails before stopping the service or removing any runtime/state files. This prevents an accidental typo or casual invocation from deleting durable data.

Before destructive purge, create and verify a quiesced backup using the documented recovery workflow if any state may be needed later.

## Hosted validation contract

`deploy/pi/decommission.test.mjs` exercises the lifecycle without requiring a Pi or root access. It verifies that:

- default decommission removes runtime/service artifacts while preserving state, nested backups, and configuration;
- runtime can be recreated afterward while preserved state remains unchanged;
- repeated decommission is safe;
- purge fails before any action without the exact confirmation;
- an explicitly confirmed state purge deletes state without implicitly deleting configuration;
- dry-run mode performs no systemctl or filesystem mutation.

The test is part of `pnpm test` and therefore the normal `pnpm check` CI path.
