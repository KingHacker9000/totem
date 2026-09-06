# Windows Phase 1 development bootstrap

Totem's Phase 1 software stack is designed to run on a normal Windows PC without Raspberry Pi hardware.

## Prerequisites

Install:

- Git for Windows;
- Node.js 24.18.0 (recommended and pinned by `.nvmrc` / `.node-version`) or Node.js 22.20.0+;
- pnpm 10.28.0.

If Corepack is available, enable it with:

```powershell
corepack enable
```

Otherwise install the pinned pnpm release:

```powershell
npm install --global pnpm@10.28.0
```

Verify the toolchain:

```powershell
node --version
pnpm --version
```

## Clean checkout

```powershell
git clone https://github.com/KingHacker9000/totem.git
cd totem
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

`pnpm dev` is the supported Phase 1 one-command launcher. It starts:

- Totem core at `http://127.0.0.1:3000` by default;
- dashboard at `http://127.0.0.1:5173`;
- display simulator at `http://127.0.0.1:5174`.

The deterministic `MockAgentProvider` is a local in-process Phase 1 provider implementation, so it requires no external model credentials or separate provider daemon. The end-to-end integration layer can use it without installing Codex CLI or Claude Code CLI.

Press Ctrl+C once in the launcher terminal to stop the complete stack. If one managed process exits unexpectedly, the launcher stops the remaining managed processes rather than leaving a partial stack running.

## First-party extension and theme fixtures

For the normal multi-repository development layout, clone the fixture repositories as siblings of `totem`:

```text
workspace/
  totem/
  totem-base-extensions/
  totem-base-themes/
```

When those sibling directories exist and no explicit discovery-root environment variables are set, `pnpm dev` automatically points Totem at them. This uses the same configurable discovery-root contract as third-party packages; there is no first-party special case in core discovery.

You can always override discovery explicitly:

```powershell
$env:TOTEM_EXTENSION_ROOTS = "C:\dev\extensions"
$env:TOTEM_THEME_ROOTS = "C:\dev\themes"
pnpm dev
```

On Windows, multiple roots use the normal semicolon-separated PATH convention:

```powershell
$env:TOTEM_EXTENSION_ROOTS = "C:\dev\extensions-a;C:\dev\extensions-b"
```

## Run a mocked task end to end

With the stack running, start a deterministic mocked task from any HTTP client:

```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/tasks `
  -H "content-type: application/json" `
  -d '{\"prompt\":\"say hello\",\"scenario\":\"success\"}'
```

or from the dashboard **Tasks** section, which has a prompt box, a scenario
selector (`success` / `failure` / `wait`), and a live-updating task history.
The task is persisted durably; reloading the dashboard or restarting core
replays it from storage. A `wait` task stays `running` until interrupted
(dashboard **Interrupt** button, or `POST /api/tasks/<id>/interrupt`). The
display simulator's "Core-driven scene" panel reflects the task's scene/LED
transitions live over `/api/events`.

## Core configuration

The launcher preserves explicitly configured environment values. Common settings are:

```powershell
$env:TOTEM_HOST = "127.0.0.1"
$env:TOTEM_PORT = "3000"
$env:TOTEM_DATA_DIR = "C:\totem-dev-data"
$env:TOTEM_LOG_LEVEL = "debug"
$env:TOTEM_ACTIVE_THEME = "default"
pnpm dev
```

Core host, port, data directory, extension roots, theme roots, log level, environment, and active theme are configurable. Browser development ports are currently fixed at 5173 for dashboard and 5174 for display and intentionally fail on conflict rather than silently moving.

## Run one surface only

For focused work you can bypass the stack launcher:

```powershell
pnpm --filter @totem/core dev
pnpm --filter @totem/dashboard dev
pnpm --filter @totem/display dev
```

The legacy all-apps parallel command remains available as `pnpm dev:apps`, but `pnpm dev` is preferred because it applies Phase 1 development defaults and coordinated shutdown behavior.

## Restart and state

Stopping and restarting `pnpm dev` does not intentionally clear durable core state. By default Windows data lives under `%LOCALAPPDATA%\Totem`; `TOTEM_DATA_DIR` relocates it. Delete or point `TOTEM_DATA_DIR` at a fresh directory only when a clean state is specifically required.

Browser clients treat core as authoritative. Reloading a dashboard or display browser tab should not be used as a substitute for restarting core when testing process lifecycle behavior.

## Troubleshooting

### `pnpm` is not recognized

Run `corepack enable`, reopen the terminal, and retry. If Corepack is unavailable, install `pnpm@10.28.0` globally with npm.

### Unsupported Node version or native SQLite errors

Use Node 24.18.0 or Node 22.20.0+. Older Node 22 patch releases are outside the tested Phase 1 floor for the current `better-sqlite3` dependency. After changing Node versions, remove `node_modules` and run `pnpm install --frozen-lockfile` again.

### Port already in use

Stop the process using ports 3000, 5173, or 5174. Core can instead use another port via `TOTEM_PORT`; if core moves, browser proxy configuration may also need to be adjusted for that development session. Dashboard/display Vite ports are strict by design.

### Fixture repositories are not discovered

Either place `totem-base-extensions` and `totem-base-themes` next to the `totem` checkout or set `TOTEM_EXTENSION_ROOTS` / `TOTEM_THEME_ROOTS` explicitly. Check `/api/extensions` and `/api/themes` on core for discovery diagnostics.

### Ctrl+C leaves a child process behind

Run Ctrl+C once and allow the launcher to forward shutdown. If a process was launched independently, stop that terminal separately. On Windows, Task Manager or `Get-Process node` can identify a process that did not originate from the managed launcher.

### WSL

Use Linux Node and pnpm entirely inside WSL. Do not share one installed `node_modules` tree between native Windows and WSL because native dependencies such as SQLite bindings are platform-specific.

## Validation handoff

The Phase 1 integration and regression gates should use this clean-checkout path as their startup baseline. Hardware, GPIO, physical LEDs, Raspberry Pi display drivers, and CAD are not required for this workflow.
