# Raspberry Pi durable-state compatibility

Totem releases share a durable state directory (`/var/lib/totem` by default) across install, update, rollback, uninstall, and recovery operations. Release artifacts are replaceable; durable state is not.

## Current compatibility contract

The release descriptor at `deploy/pi/state-compatibility.json` is machine-readable and validated by:

```bash
pnpm release:state:compatibility:check
```

The current format is `opaque-v0`. This name is intentionally conservative: Totem currently treats the durable-state tree as opaque persisted application data and performs **no implicit in-place migration** during install or rollback. The installer copies/builds a new release, verifies compatibility against the currently active release, and only then changes `/opt/totem/current`.

Pre-contract releases that do not contain `state-compatibility.json` are treated as the explicitly declared `legacyUnversionedFormat` (`opaque-v0`) only while the current descriptor continues to opt into that baseline. A future release that changes the state format must update the descriptor and add an explicit migration/recovery design; merely changing the format string will make incompatible transitions fail closed.

## Update behavior

`deploy/pi/install.sh` validates the transition from the active release to the newly staged release before switching the `current` symlink. If the target release cannot read the state format written by the active release, installation stops before activation and removes the incomplete staged release.

The compatibility check does not mutate durable state. The existing `/var/lib/totem` tree is reused by the compatible release.

## Rollback behavior

`deploy/pi/rollback.sh` validates the reverse transition before switching the `current` symlink. If the active release cannot prove that the rollback target can read the currently written state format, rollback is refused rather than risking state corruption.

A rollback changes release artifacts, not durable state. If application-level state must be reverted as well, use the stopped-service recovery workflow instead of assuming release rollback rewinds data.

## Recovery for an unsafe or uncertain transition

For a release transition that fails compatibility validation:

1. Stop `totem.service`.
2. Create and verify a release-grade backup with `pnpm recovery:backup` / `pnpm recovery:verify` using the deployed release tooling.
3. Select a release whose descriptor explicitly accepts the existing state format, or follow a future documented migration path.
4. If state restoration is required, use `pnpm recovery:restore` while the service is stopped.
5. Start Totem and run `pnpm validate:pi` from the active release.
6. Keep the pre-restore state directory until the recovered installation is validated.

The recovery tooling verifies SHA-256 inventories and preserves the pre-restore state. Hot restore remains unsupported.

## Hosted validation

`deploy/pi/state-compatibility.node-test.mjs` covers:

- current-format update and rollback compatibility;
- explicit legacy pre-contract handling;
- fail-closed incompatible future formats;
- preservation of shared durable state across simulated release transitions; and
- verified backup/restore after a simulated transition.

These hosted tests validate the contract without requiring a Raspberry Pi. They do not replace T907 real-Pi lifecycle evidence or T912 physical-prototype validation.
