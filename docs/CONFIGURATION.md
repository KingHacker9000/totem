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

## Health and status

The core exposes:

```text
GET /health
GET /api/status
```

`/health` is a minimal liveness response. `/api/status` provides the local management surfaces with runtime identity, environment, start time, uptime, process/Node version, and active data root.

These endpoints are local Phase 1 surfaces, not a frozen remote-management API.

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
$env:TOTEM_LOG_LEVEL = "debug"
pnpm --filter @totem/core dev
```

Unix shell:

```sh
TOTEM_DATA_DIR=/srv/assistant TOTEM_LOG_LEVEL=debug pnpm --filter @totem/core dev
```
