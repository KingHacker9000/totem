# ADR 0010 — Phase 1 uses a TypeScript/Node/browser stack

Status: **Accepted**

Date: 2026-09-05

## Context

Phase 1 must produce a complete Totem development instance on a normal PC while preserving a straightforward path to Raspberry Pi 5 deployment. The core, dashboard, display client, shared protocol, persistence, and mock agent-provider flow need strong shared types without introducing an unnecessary desktop wrapper or a local general-purpose LLM runtime.

## Decision

Phase 1 will use the following stack:

- **Language:** TypeScript in strict mode for core services, browser clients, shared contracts, and Phase 1 SDK-facing seams.
- **Runtime baseline:** Node.js 22 or newer on supported desktop/Linux ARM64 environments. The scaffold will pin/document the exact development version while remaining compatible with the Node 22 line.
- **Workspace/package manager:** pnpm 10 workspaces, using Corepack where available. No Turborepo/Nx dependency in Phase 1; pnpm workspace scripts are sufficient.
- **Core HTTP service:** Fastify. Commands/state queries use JSON HTTP endpoints; server-to-browser live events use Server-Sent Events (SSE) initially.
- **Browser applications:** React + Vite + TypeScript for both the dashboard and the device display client/simulator. The display is a web client so the same application can later run in Chromium kiosk mode on the Pi.
- **Runtime/schema validation:** TypeBox schemas with Ajv validation for protocol/configuration/package-boundary data so the same definitions can produce JSON-Schema-compatible contracts and TypeScript types.
- **Persistence:** SQLite, accessed through Kysely with the `better-sqlite3` driver. Migrations are explicit files committed to the repository and executed by Totem, not generated implicitly at runtime.
- **Logging:** Pino structured JSON logging, integrating with Fastify's logger.
- **Unit/integration tests:** Vitest. Browser end-to-end testing is Playwright when Phase 1 reaches browser integration/validation.
- **Formatting/linting:** Biome for formatting and linting; `tsc --noEmit` remains the authoritative type check.
- **Styling:** ordinary CSS plus CSS custom properties/design tokens in Phase 1. No component framework or Tailwind dependency is required for the initial shell; themes must not be coupled to a third-party UI framework.

Package versions are pinned in the workspace lockfile/package manifests during T102. This ADR chooses technologies and compatibility boundaries rather than guessing long-lived patch versions in prose.

## Workspace contract

The initial `totem` workspace uses these top-level boundaries:

```text
apps/
  core/               authoritative local service/API
  dashboard/          browser management UI
  display/            physical-display client + PC simulator mode
packages/
  protocol/           shared event/API schemas and serialized contracts
  config/             configuration schemas/loaders
  events/             in-process event-bus primitives
  tasks/              task domain model/state-machine interfaces
  storage/            SQLite/Kysely connection + migration infrastructure
  device-profile/     display/input/lighting capability and geometry contracts
  agent-provider-api/ provider-neutral interfaces and normalized events
  extension-runtime/  Phase 1 discovery/runtime seams
  theme-runtime/      Phase 1 discovery/runtime seams
  testkit/            shared deterministic fixtures/helpers when needed
```

A package is added only when it has a real independent contract; T102 may omit an empty placeholder package until its owning task begins. `apps/core` may compose these packages, but browser applications must not import private server implementation modules.

Actual Codex CLI and Claude Code CLI adapters remain in `totem-agent-providers`, not inside core. First-party extension/theme packages remain in their separate repositories.

## Transport boundary

Phase 1 uses a deliberately simple local protocol:

- JSON HTTP for request/response commands and state snapshots;
- SSE for ordered server-to-client event delivery and reconnect support;
- browser clients treat the core as authoritative and must recover state from core after reconnect;
- provider-native events are normalized before entering the shared Totem protocol.

A bidirectional WebSocket transport may be introduced later if a demonstrated requirement cannot be served cleanly by HTTP + SSE. It is not part of the Phase 1 baseline.

## Development commands contract

The scaffold will expose these root commands:

```text
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e     # once browser E2E tests exist
pnpm check        # lint + format check + typecheck + tests
```

`pnpm dev` must start the Phase 1 development surfaces needed at that point without requiring Raspberry Pi hardware. T117 later turns this into the documented complete one-command Windows startup path.

## Consequences

### Positive

- Shared TypeScript schemas/types reduce drift between core, dashboard, display, and SDK seams.
- Browser-based display avoids Electron/Tauri complexity and maps naturally to future Pi kiosk deployment.
- Fastify + HTTP/SSE is small, debuggable, and sufficient for local Phase 1 communication.
- SQLite keeps task state local and portable, including eventual external-HDD data placement.
- pnpm workspaces provide monorepo coordination without another build orchestrator.
- The stack can run on Windows development machines and Linux ARM64/Pi without changing application architecture.

### Costs / constraints

- `better-sqlite3` is a native dependency and the Pi deployment phase must verify/build an ARM64-compatible binary/toolchain.
- SSE is one-way; interactive commands continue over HTTP. A later real-time requirement may justify WebSockets.
- The browser display requires a local browser/kiosk runtime on the final device.

## Rejected alternatives for Phase 1

- **Python as the primary core runtime:** useful for speech/model tooling later, but would duplicate contracts across Python and TypeScript for the web-heavy Phase 1 core.
- **Electron/Tauri for the simulator:** unnecessary packaging complexity before hardware requirements are stable.
- **Docker as the required dev runtime:** useful later for deployment options, but should not be required for the normal PC development loop.
- **Turborepo/Nx:** not needed for the initial repository size; can be introduced only if measurable workspace scaling pain appears.
- **A local LLM runtime:** explicitly conflicts with ADR 0002; general reasoning is delegated to external agent providers.
