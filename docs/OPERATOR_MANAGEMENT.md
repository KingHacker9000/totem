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

A state snapshot may contain SQLite files. For release-grade disaster recovery, perform snapshot creation during a quiesced maintenance window or after stopping the service so the SQLite database and any WAL sidecars are captured consistently. The API makes the restore requirement explicit and does not claim hot-restore safety.
