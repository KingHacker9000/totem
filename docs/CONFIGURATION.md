# Core configuration and data layout

Core configuration is intentionally local, explicit, and portable across Windows development and later Linux/Pi deployment.

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
| `TOTEM_EXTENSION_GRANTS` | unset / deny all | JSON object mapping extension IDs to explicitly granted permission strings, for example `{"weather":["network.internet","display.present"]}`. This is runtime authority, separate from manifest requests. |

The default data root is platform-friendly rather than Pi-specific:

- Windows: `%LOCALAPPDATA%\Totem` when `LOCALAPPDATA` exists, otherwise the user's `AppData\Local\Totem` directory.
- Other platforms: `$XDG_DATA_HOME/totem` when configured, otherwise `~/.local/share/totem`.

A later Pi installation can point `TOTEM_DATA_DIR` at an external HDD such as `/srv/assistant` without changing application code.

## Data layout

Core startup creates the configured root and these subdirectories when missing:

```text
<TOTEM_DATA_DIR>/
├── state/
├── extensions/
├── themes/
└── logs/
```

`state/` contains durable core state such as SQLite. Extension/theme discovery uses the corresponding directories by default. `logs/` is reserved for file-backed logging/export if enabled later; normal runtime logs currently go to structured Pino/Fastify output.

No code may assume that this tree lives on NVMe, microSD, an external HDD, or a specific drive letter.

## Extension and theme discovery

Core scans each immediate child directory of every configured discovery root and looks for `totem-extension.json` or `totem-theme.json` according to the package type. Invalid candidates are reported independently and do not prevent other packages or core startup from working.

Discovery and runtime state are exposed through:

```text
GET /api/extensions
GET /api/extensions/runtime
GET /api/themes
```

`GET /api/extensions` is the compatibility discovery snapshot. `GET /api/extensions/runtime` is the Phase 2 security/runtime snapshot: it reports lifecycle state, manifest-requested permissions, effective granted permissions, contribution/settings declarations, secret references, MCP declarations, and diagnostics. It does not return secret values. When `TOTEM_EXTENSION_GRANTS` is absent, effective grants are empty by design.

Theme responses also report whether the current presentation selection came from an explicitly configured theme, the enabled `default` theme, or the built-in fallback presentation.

The normative Phase 2 extension manifest and permission rules live in [`EXTENSION_MANIFEST_V0.md`](EXTENSION_MANIFEST_V0.md). The Phase 1 compatibility scanner remains documented in [`DISCOVERY.md`](DISCOVERY.md) until the Phase 2 integration pass removes that transitional layer.

### First-party fixtures

For a sibling checkout containing `totem`, `totem-base-extensions`, and `totem-base-themes`, public first-party packages use the same configurable discovery roots as third-party packages; no first-party special case is required.

PowerShell from the `totem` checkout:

```powershell
$env:TOTEM_EXTENSION_ROOTS = (Resolve-Path "..\totem-base-extensions").Path
$env:TOTEM_THEME_ROOTS = (Resolve-Path "..\totem-base-themes").Path
$env:TOTEM_ACTIVE_THEME = "default"
$env:TOTEM_EXTENSION_GRANTS = '{"weather":["network.internet","display.present"]}'
pnpm --filter @totem/core dev
```

Unix shell from the `totem` checkout:

```sh
TOTEM_EXTENSION_ROOTS="$(cd ../totem-base-extensions && pwd)" \
TOTEM_THEME_ROOTS="$(cd ../totem-base-themes && pwd)" \
TOTEM_ACTIVE_THEME=default \
TOTEM_EXTENSION_GRANTS='{"weather":["network.internet","display.present"]}' \
pnpm --filter @totem/core dev
```

## Health and status

The core exposes:

```text
GET /health
GET /api/status
```

`/health` is a minimal liveness response. `/api/status` provides local management surfaces with runtime identity, environment, start time, uptime, process/Node version, and active data root.

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
$env:TOTEM_EXTENSION_GRANTS = '{"weather":["network.internet","display.present"]}'
$env:TOTEM_ACTIVE_THEME = "default"
$env:TOTEM_LOG_LEVEL = "debug"
pnpm --filter @totem/core dev
```

Unix shell:

```sh
TOTEM_DATA_DIR=/srv/assistant \
TOTEM_EXTENSION_ROOTS=/srv/assistant/extensions:/opt/totem/extensions \
TOTEM_EXTENSION_GRANTS='{"weather":["network.internet","display.present"]}' \
TOTEM_LOG_LEVEL=debug \
pnpm --filter @totem/core dev
```
