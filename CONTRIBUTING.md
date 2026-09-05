# Contributing to Totem

Totem is in early architecture/implementation work. Contributions should preserve the repository boundaries and architectural decisions documented in `docs/`.

## Before changing architecture

Read:

- `docs/ARCHITECTURE.md`
- `docs/REPOSITORIES.md`
- `docs/EXTENSIONS.md`
- `docs/THEMES.md`
- `docs/AGENTS.md`
- `docs/SECURITY.md`
- `docs/adr/`

If a change contradicts an accepted ADR, update/supersede the ADR explicitly rather than silently bypassing it.

## Core contribution rules

- Keep service-specific integrations out of core when they can be extensions.
- Keep identity/persona-specific behavior out of core when it can be a theme.
- Keep provider-specific behavior behind `AgentProvider` adapters.
- Do not assume a circular physical LCD.
- Do not require a general-purpose local LLM.
- Do not commit secrets, private voice models, copyrighted character assets, or private themes.
- Privileged operations need an explicit/auditable path.

## Development workflow

During Phase 1, changes should be small enough to validate through the PC simulator and automated tests. Raspberry-Pi-only shortcuts should not leak into shared core logic.

Implementation stack, formatting, test commands, and CI instructions will be added once the initial workspace is scaffolded.

## Issues and pull requests

Prefer an issue for significant architecture changes. PRs should explain:

- what changed
- why it belongs in this repository/layer
- how it was tested
- whether it changes a public contract
- whether it adds permissions, secrets, or privileged behavior
