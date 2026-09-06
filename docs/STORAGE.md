# Storage

Totem separates application code from persistent user data.

## Development

On a PC, Totem uses a normal configurable data directory. The simulator must not depend on Raspberry-Pi-specific filesystem paths.

## Phase 1 durable state

Phase 1 persists authoritative task and agent-session state in SQLite through the `@totem/storage` package. The implementation uses Kysely with the `better-sqlite3` driver, matching ADR 0010.

The database path is supplied by core/runtime configuration rather than being hard-coded into the storage package. `openTotemDatabase()` creates the containing directory when needed, enables SQLite foreign keys, and uses WAL mode for file-backed databases.

Database changes are explicit committed migrations. `migrateToLatest()` applies the ordered migration set deterministically; migrations are not generated implicitly from TypeScript types at runtime.

The initial schema contains three domain tables:

```text
agent_sessions
  id, provider_id, provider_session_ref, status,
  created_at, updated_at, closed_at

tasks
  id, kind, status, title, session_id, provider_id, correlation_id,
  created_at, updated_at, started_at, completed_at,
  failure_json, result_json

task_events
  task_id, task_sequence, event_id, event_type,
  occurred_at, envelope_json
```

`provider_session_ref` is opaque adapter-owned metadata. Totem UI surfaces use the Totem session id as their primary identity.

### Task snapshot and history guarantees

`@totem/tasks` owns the Phase 1 task/session domain types and allowed lifecycle transitions. `@totem/storage` owns persistence and transaction boundaries.

For each task:

- the current task snapshot is authoritative state;
- task-relevant normalized events are stored as append-only history;
- `task_sequence` increases monotonically within that task, independently of wall-clock ordering;
- lifecycle transitions update the snapshot and append the corresponding lifecycle event in one database transaction;
- terminal states cannot be resurrected;
- normalized failure/result data is stored with terminal snapshots;
- `task.progress` and other non-lifecycle events can be appended without allowing callers to bypass lifecycle validation;
- duplicate event ids are idempotent only when the exact same event is being written to the same task; conflicting reuse is rejected.

This is the durable basis for browser reconnect, task-detail history, and mocked end-to-end agent work later in Phase 1. Live SSE is a freshness mechanism, not the sole copy of task state.

### Native dependency note

`better-sqlite3` contains native code and is explicitly allowed in the pnpm workspace build policy. CI verifies it on the supported Windows/Linux and Node 22/24 matrix. Raspberry Pi ARM64/native-toolchain verification remains a Pi-deployment concern rather than a PC Phase 1 assumption.

## Raspberry Pi target

The eventual Pi 5 deployment may boot from normal Pi storage while large/persistent Totem data lives on an externally connected HDD. The enclosure should expose rear I/O rather than requiring the HDD to fit inside the device.

A future Linux layout may resemble:

```text
/srv/totem/
├── extensions/
├── themes/
├── voices/
├── models/
├── tasks/
├── extension-data/
├── cache/
├── logs/
└── backups/
```

This is a conceptual layout, not a frozen path.

## Storage classes

Totem should distinguish:

- configuration
- secrets
- extension/theme packages
- large local assets/models
- persistent task/session state
- extension-owned data
- caches
- logs/audit history
- optional recordings
- backups

Each class should have explicit retention/backup semantics.

## External drive behavior

When external storage is unavailable, Totem should fail gracefully: the core/dashboard should still explain the problem rather than crash-loop. Extensions depending on missing storage may be disabled or degraded until it returns.

## Portability

Persistent data formats should be versioned. Replacing the Pi or reinstalling the OS should not require losing themes, extensions, settings, task history, or locally managed voice assets when the external data drive remains intact.
