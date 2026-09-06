# Core configuration and data layout

Phase 1 core configuration is intentionally local, explicit, and portable across Windows development and later Linux/Pi deployment.

The authoritative startup values currently come from environment variables. Invalid values fail startup deterministically with a structured JSON error rather than being silently coerced.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOTEM_HOST` | `127.0.0.1` | Local HTTP bind hostname/address. |
| `TOTEM_PORT` | `3000` | Local HTTP port, integer `1..65535`. |
| `TOTEM_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `TOTEM_ENV` | `development` | `development`, `test`, or `production`. Falls back to `NODE_ENV` when unset. |
| `TOTEM_DATA_DIR` | per-user application data directory | Root for relocatable Totem state. Relative overrides are resolved from the process working directory. |
| `TOTEM_EXTENSION_ROOTS` | `<TOTEM_DATA_DIR>/extensions` | Ordered local extension discovery roots. Separate multiple roots with the platform path-list delimiter (`;` on Windows, `:` on Unix). |
| `TOTEM_THEME_ROOTS` | `<TOTEM_DATA_DIR>/themes` | Ordered local theme discovery roots, using the same path-list delimiter. |
| `TOTEM_ACTIVE_THEME` | unset | Optional preferred enabled theme id. If unavailable/invalid, discovery falls back to enabled `default`, then the built-in fallback presentation. |

The default data root is platform-friendly rather than Pi-specific:

- Windows: `%LOCALAPPDATA%\Totem` when `LOCALAPPDATA` exists, otherwise the user's `AppData\Local\Totem` directory.
- Other platforms: `$XDG_DATA_HOME/totem` when configured, otherwise `~/.local/share/totem`.

A later Pi installation can point `TOTEM_DATA_DIR` at an external HDD such as `/srv/assistant` without changing application code.

## Data layout

Core startup creates the configured root and these Phase 1 subdirectories when missing:

```text
<TOTEM_DATA_DIR>/
├── state/
├── extensions/
├── themes/
└── logs/
```

`state/` is reserved for durable core state such as the SQLite database introduced by the persistence task. Extension/theme discovery uses the corresponding directories by default. `logs/` is reserved for file-backed logging/export if enabled later; Phase 1 currently emits structured Pino/Fastify logs to the process output stream.

No code may assume that this tree lives on NVMe, microSD, an external HDD, or a specific drive letter.

## Extension and theme discovery

Phase 1 scans each immediate child directory of every configured discovery root and looks for `totem-extension.json` or `totem-theme.json` according to the package type. Invalid candidates are reported independently and do not prevent other packages or core startup from working.

Discovery state is exposed read-only through:

```text
GET /api/extensions
GET /api/themes
```

The responses include package identity where valid, path, enabled/invalid state, diagnostics, and root-level scan errors. Theme responses also report whether the current presentation selection came from an explicitly configured theme, the enabled `default` theme, or the built-in fallback presentation.

The normative Phase 1 schema and security rules remain in [`DISCOVERY.md`](DISCOVERY.md). These endpoints do not install packages, freeze the public SDK v1, or grant extension capabilities.

### First-party Phase 1 fixtures

For a sibling checkout containing `totem`, `totem-base-extensions`, and `totem-base-themes`, the public first-party fixtures can be exercised through the exact same configurable discovery roots used for third-party packages; no copy step or first-party special case is required.

PowerShell from the `totem` checkout:

```powershell
$env:TOTEM_EXTENSION_ROOTS = (Resolve-Path "..\totem-base-extensions").Path
$env:TOTEM_THEME_ROOTS = (Resolve-Path "..\totem-base-themes").Path
$env:TOTEM_ACTIVE_THEME = "default"
pnpm --filter @totem/core dev
```

Unix shell from the `totem` checkout:

```sh
TOTEM_EXTENSION_ROOTS="$(cd ../totem-base-extensions && pwd)" \
TOTEM_THEME_ROOTS="$(cd ../totem-base-themes && pwd)" \
TOTEM_ACTIVE_THEME=default \
pnpm --filter @totem/core dev
```

The Phase 1 fixture directories are `clock/` and `default/`, each containing only the corresponding v0 manifest plus explanatory documentation. They intentionally do not bypass the normal scanner and do not imply that the eventual SDK v1 is frozen.

## Health and status

The core exposes:

```text
GET /health
GET /api/status
```

`/health` is a minimal liveness response. `/api/status` provides the local management surfaces with runtime identity, environment, start time, uptime, process/Node version, and active data root.

These endpoints are local Phase 1 surfaces, not a frozen remote-management API.

## Tasks and the runtime event stream

The core also exposes the durable task surfaces plus a mocked task entry point:

```text
GET  /api/tasks               # durable task list (newest first)
GET  /api/tasks/:taskId       # task snapshot + append-only event log
POST /api/tasks               # start a mocked agent task
POST /api/tasks/:taskId/interrupt
GET  /api/events              # Server-Sent Events: core.status + normalized runtime events
```

`POST /api/tasks` accepts `{ "prompt": string, "kind"?: string, "title"?: string, "scenario"?: "success" | "failure" | "wait" }`
and returns `202` with `{ taskId, sessionId, status }`. The task then runs
against the in-process deterministic `MockAgentProvider`: its normalized events
are persisted through the durable `TaskStore` and broadcast on `/api/events`.
The `wait` scenario leaves the task `running` until `POST /api/tasks/:taskId/interrupt`
drives it through `cancelling` → `cancelled`.

Core derives `display.scene_changed` / `display.led_changed` events from task
lifecycle and publishes them on the same stream so the display simulator reflects
live task state. Browser clients treat the persisted task store as authoritative
and use `/api/events` only for live updates; reloading a client replays durable
state from `GET /api/tasks`.

## Lifecycle logging

Normal runtime logging goes through Fastify's Pino logger and includes semantic event keys such as:

```text
system.ready
system.stopping
system.stop_failed
```

Configuration/startup failures that occur before Fastify exists are emitted as one-line structured JSON records using events such as `system.config_invalid` or `system.start_failed`.

The later activity/audit subsystem is separate from operational logs; do not treat generic log output as an authorization audit trail.

## Examples

PowerShell:

```powershell
$env:TOTEM_DATA_DIR = "D:\TotemData"
$env:TOTEM_EXTENSION_ROOTS = "D:\TotemPackages\extensions;D:\Dev\totem-extensions"
$env:TOTEM_ACTIVE_THEME = "default"
$env:TOTEM_LOG_LEVEL = "debug"
pnpm --filter @totem/core dev
```

Unix shell:

```sh
TOTEM_DATA_DIR=/srv/assistant \
TOTEM_EXTENSION_ROOTS=/srv/assistant/extensions:/opt/totem/extensions \
TOTEM_LOG_LEVEL=debug \
pnpm --filter @totem/core dev
```
