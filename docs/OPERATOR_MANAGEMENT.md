# Operator management APIs

Totem's `/operator` surface reads management state from core APIs. It does not keep a parallel browser-owned settings database.

## Endpoints

- `GET /api/operator/capabilities` reports display transport, speech capability-probe endpoints, backup location, and remote-exposure posture.
- `GET /api/operator/logs?limit=40` returns a bounded structured request history maintained by core. The dashboard does not scrape arbitrary log files.
- `GET /api/operator/backups` lists state snapshots created through core.
- `POST /api/operator/backups` creates a timestamped state snapshot beneath the Totem data root.
- `POST /api/operator/backups/:backupId/restore-plan` returns the explicit restart-required restore sequence. Totem deliberately does not replace live durable state while the service is running.

## Security posture

The default core bind remains `127.0.0.1`. `/api/operator/capabilities` reports whether the effective bind is loopback-only. That loopback default is the only security boundary core claims today.

Totem does **not** currently implement application-wide authentication. A non-loopback bind is therefore reported as needing action even when an operator declares an external access layer through `TOTEM_REMOTE_ACCESS_LAYER`. The declaration is diagnostic metadata only; it is not treated as proof that the deployment is protected.

For remote operation, keep `TOTEM_HOST` on loopback and expose Totem through the host's authenticated reverse-access layer, or otherwise ensure authentication is enforced before traffic reaches core. The dashboard deliberately does not present a configured-but-unenforced token as security.

## Speech and display

The management console probes `/api/speech/status` directly. On builds where the production speech lane is not installed, the panel stays explicitly unavailable. Once the speech route exists, the console renders the core-owned status without requiring another dashboard state model.

Display management reports the normalized core-event transport (`/api/events`) and the configured simulator URL. Hardware-specific display controls remain capability-gated rather than being simulated in browser state.

## Backup safety

Backups are written outside the live `state` directory and receive a `totem.backup/v0` manifest. Restore is intentionally plan-only while core is running. Before applying a restore, stop Totem, preserve the current state directory, replace it from the selected snapshot, restart Totem, and run health/self-test validation.

A snapshot created by the running core API is useful for convenience/export, but it is **not** claimed as a release-grade SQLite disaster-recovery point because the database and WAL sidecars may still be changing while the copy runs. Release-grade recovery uses the stopped-service tooling below; its manifest carries a SHA-256 file inventory and `captureMode: "quiesced"`, and verification rejects legacy/uninventoried, incomplete, extra, or tampered snapshot contents.

## Release-grade disaster recovery

The recovery CLI fails closed unless it can prove the systemd service is inactive or failed. On the Raspberry Pi, use a maintenance window and keep the service stopped for both snapshot creation and restore:

```bash
sudo systemctl stop totem.service
sudo systemctl is-active totem.service || true

pnpm recovery:backup -- \
  --root /var/lib/totem \
  --state /var/lib/totem/state \
  --service totem.service
```

The command copies the stopped state, inventories every regular file (including SQLite `-wal`/`-shm` sidecars when present), records SHA-256 plus byte size, and immediately verifies the resulting `totem.backup/v0` snapshot. Symbolic links and other unsupported filesystem entries fail closed.

Before a restore, verify the selected snapshot explicitly:

```bash
pnpm recovery:verify -- \
  --backup /var/lib/totem/backups/20260907T073000.000Z
```

Then, while `totem.service` is still stopped:

```bash
pnpm recovery:restore -- \
  --backup /var/lib/totem/backups/20260907T073000.000Z \
  --state /var/lib/totem/state \
  --service totem.service
```

Restore verification happens **before** the live state is touched. The replacement is staged beside the live directory, the current live state is renamed to a timestamped `state.pre-restore.*` rollback copy, and only then is the verified staged snapshot moved into place. The rollback copy is never silently deleted.

Finish the rehearsal by restarting and validating the recovered installation:

```bash
sudo systemctl start totem.service
pnpm validate:pi
```

Do not remove the `state.pre-restore.*` copy until readiness/self-test and the operator's durable-state checks are successful. If `systemctl` cannot prove the service is stopped, recovery intentionally refuses to proceed. Hot restore remains unsupported.
