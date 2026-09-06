# Development model

Totem is software-first and PC-first.

## Run the T102 scaffold

Install Node.js **24.18.0** (pinned in `.nvmrc` and `.node-version`) and
pnpm **10.28.0**. Node **22.20.0 or newer** is supported. The original scaffold
used the Vite minimum of Node 22.12.0, but Phase 1 durable SQLite validation
showed that older Node 22 patch releases are not a safe runtime floor for the
current native `better-sqlite3` dependency. With Corepack available, run
`corepack enable`; otherwise install pnpm with
`npm install --global pnpm@10.28.0`.

From the repository root, in PowerShell, Command Prompt, or a Unix shell:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

The scaffold starts three independent development processes:

| Surface | Local URL | Current behavior |
| --- | --- | --- |
| Core | http://127.0.0.1:3000/ | JSON scaffold identity response |
| Dashboard | http://127.0.0.1:5173/ | React placeholder |
| Display | http://127.0.0.1:5174/ | React placeholder |

Use Ctrl+C to stop the development processes. Browser ports are strict so a
port conflict fails visibly instead of silently moving a surface. Individual
apps can run with `pnpm --filter @totem/core dev` (or `@totem/dashboard` /
`@totem/display`). After building, `pnpm --filter @totem/core start` runs the
compiled core. Each browser build is emitted to its app's `dist/` directory.

This scaffold establishes tooling only: health/configuration, API/event
contracts, persistence, simulator behavior, and provider integration belong
to subsequent task-board issues. The browser placeholders do not yet connect
to core. Shared `packages/*` are created by their owning tasks when real
contracts exist. SQLite and other future runtime dependencies are deliberately
not installed before their packages exist. Browser E2E tests and
`pnpm test:e2e` are deferred until the browser integration task.

CI runs frozen installation, `pnpm check`, and `pnpm build` on Windows and
Linux with Node 22.20.0 and 24.18.0. `pnpm format` applies Biome formatting;
`pnpm format:check` checks it without writes. Markdown remains source-preserved.
When using WSL, use Linux Node and pnpm in WSL; do not share an installed
`node_modules` tree with native Windows. No Docker or Pi hardware is needed.

## Primary development environment

The first complete implementation runs on a normal development PC with:

- display client in browser-based simulator mode
- mouse acting as touch input
- virtual LEDs
- keyboard input
- real PC microphone/speakers when speech work begins
- local STT/TTS
- Codex CLI and Claude Code CLI provider adapters
- real extension/theme loading
- dashboard on localhost

The Raspberry Pi is a later deployment target, not the primary development machine.

## Implementation rule

Hardware-specific behavior belongs behind interfaces. A feature is not complete if it works only because the desktop implementation bypasses the abstraction that the Pi driver will later need.

## Coding workflow

Routine code, docs, SDK contracts, tests, and repository maintenance can be implemented directly. Codex/other coding agents should be used when agentic exploration, large refactors, parallel tasks, repository-wide investigation, repeated multi-process/browser debugging, or parametric CAD generation materially benefit from autonomous workflows.

Do not hand every trivial change to an agent merely because Totem integrates agents.

## Phase 1 implementation stack

ADR 0010 is the source of truth for the Phase 1 stack. In summary:

- TypeScript in strict mode across core, browser clients, and shared contracts
- Node.js 22+ runtime baseline, with 22.20.0 as the tested minimum patch release
- pnpm 10 workspaces via Corepack where available
- Fastify for the authoritative local core HTTP service
- JSON HTTP endpoints for commands/state snapshots
- Server-Sent Events (SSE) for live server-to-browser event delivery
- React + Vite + TypeScript for dashboard and display client/simulator
- TypeBox + Ajv for runtime validation and JSON-Schema-compatible contracts
- SQLite persistence through Kysely + `better-sqlite3`
- explicit committed migrations
- Pino structured logging
- Vitest for unit/integration tests
- Playwright for browser E2E validation when that layer exists
- Biome for formatting/linting and `tsc --noEmit` for authoritative type checks
- CSS custom properties/design tokens rather than coupling Phase 1 themes to a UI framework

Exact package versions are pinned by the implementation scaffold and lockfile rather than duplicated in prose.

## Workspace layout

The initial `totem` repository is a pnpm workspace with these intended boundaries:

```text
apps/
  core/               authoritative service, API and composition root
  dashboard/          browser management UI
  display/            device display client; simulator mode on PC

packages/
  protocol/           serialized API/event schemas
  config/             configuration schemas and loading
  events/             in-process event-bus primitives
  tasks/              durable task domain/state-machine interfaces
  storage/            SQLite/Kysely infrastructure and migrations
  device-profile/     display/input/lighting geometry/capability contracts
  agent-provider-api/ provider-neutral interfaces and normalized events
  extension-runtime/  extension discovery/runtime seams
  theme-runtime/      theme discovery/runtime seams
  testkit/            shared deterministic fixtures when justified
```

Empty packages do not need to be created prematurely. A package should appear when its owning task has a real contract to implement. Browser apps may consume public shared packages but must not import private `apps/core` implementation modules.

The real Codex/Claude adapters live in `totem-agent-providers`. First-party extensions and themes remain in `totem-base-extensions` and `totem-base-themes`.

## Root developer commands

The Phase 1 scaffold must expose a stable root command surface:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm check
```

`pnpm test:e2e` may initially be a documented no-op/absent until browser E2E tests are introduced; once Playwright tests exist it becomes part of the normal validation path.

`pnpm check` is the local/CI aggregate quality gate and should cover formatting check, lint, type checking, and automated tests. It must not require Raspberry Pi hardware.

## Local process model

During Phase 1 development, the system may run several local processes, but the architectural source of truth remains the core service:

```text
browser dashboard ----\
                       >---- HTTP + SSE ----> core
browser display ------/                       |
                                               +--> durable SQLite state
                                               +--> normalized event bus
                                               +--> mock/external provider boundary
```

Browser clients recover authoritative state from core after reconnect; they do not own durable task state in browser memory.

The display remains a browser application so the same client can later run under a lightweight Chromium kiosk setup on Linux/Pi rather than requiring a desktop-specific wrapper.

## Storage and portability

Development state defaults to a normal per-user application-data directory, selected by the config/storage layer rather than hard-coded absolute paths. The later Pi installation can point the same storage contract at an external HDD without changing core logic.

SQLite database files, migration state, extension data, theme data, logs, caches, and speech assets must be relocatable by configuration where appropriate.

## Quality gates

Before merging core architectural changes:

- formatting check passes
- linting passes
- TypeScript type checks pass
- unit/integration tests pass
- extension/theme manifest fixtures validate when those contracts exist
- protocol compatibility tests pass when implemented
- simulator smoke/E2E tests pass once the simulator exists

CI is added as implementation begins and should execute the same root commands used locally.

## Compatibility

SDK and protocol versions must be explicit. Before 1.0, breaking changes are allowed but must be documented. After 1.0, extensions/themes need a compatibility policy and migration story.
