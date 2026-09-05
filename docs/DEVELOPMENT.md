# Development model

Totem is software-first and PC-first.

## Primary development environment

The first complete implementation should run on a normal development PC with:

- display simulator in a desktop/browser window
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

Routine code, docs, SDK contracts, tests, and repository maintenance can be implemented directly. Codex/other coding agents should be used when agentic exploration, large refactors, parallel tasks, repository-wide investigation, or parametric CAD generation materially benefit from autonomous workflows.

Do not hand every trivial change to an agent merely because Totem integrates agents.

## Proposed initial stack

The exact stack is finalized in Phase 1, but the project should favor:

- TypeScript for dashboard/display/shared protocol and SDK surfaces
- a lightweight local service runtime for orchestration
- explicit JSON-schema/typed manifest contracts
- WebSocket/SSE-style event streaming to UI clients
- SQLite or an equivalent embedded durable store for local state
- platform adapters for Windows development and Linux/Pi deployment

No technology choice should make third-party extensions depend on private core internals.

## Quality gates

Before merging core architectural changes:

- formatting/linting passes
- type checks pass
- unit tests pass
- extension/theme manifest fixtures validate
- protocol compatibility tests pass
- simulator smoke test passes

CI will be added as implementation begins.

## Compatibility

SDK and protocol versions must be explicit. Before 1.0, breaking changes are allowed but must be documented. After 1.0, extensions/themes need a compatibility policy and migration story.
