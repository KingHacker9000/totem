# Repository map

Totem is intentionally split across a small set of repositories with narrow responsibilities.

## Public repositories

### `KingHacker9000/totem`

Main runtime and product repository. Owns the core services, dashboard, display simulator/client, speech orchestration, extension/theme loading, permissions, storage, event protocol, task engine, device abstractions, and developer tooling.

### `KingHacker9000/totem-hardware`

Generic reference hardware and enclosure engineering. Later phases will contain parametric CAD, print-ready exports, mechanical drawings, electronics/wiring, cooling and acoustic design, BOMs, measurements, print profiles, prototypes, and validation notes.

Software is built first. Final CAD begins only after representative components are selected and measured. Codex or another coding agent may be used heavily for parametric CAD generation and parallel hardware-analysis work.

### `KingHacker9000/totem-extension-sdk`

Stable public contract for third-party extensions. Owns manifest schemas, generated types, SDK helpers, testing utilities, extension scaffolding, example fixtures, compatibility tooling, and extension developer documentation.

### `KingHacker9000/totem-theme-sdk`

Stable public contract for third-party themes. Owns theme manifest schemas, assets/layout contracts, persona and speech configuration schemas, theme preview/testing tools, scaffolding, and theme developer documentation.

### `KingHacker9000/totem-base-extensions`

Official bundled/reference extensions. Initial targets are clock, weather, timer, and system status. Later examples may include Spotify or other integrations, but only when they are suitable as maintained first-party examples.

### `KingHacker9000/totem-base-themes`

Official copyright-clean themes. Contains the default theme plus reference themes used to exercise the theme SDK.

### `KingHacker9000/totem-agent-providers`

Agent runtime adapters. Initial providers are Codex CLI, Claude Code CLI, and a deterministic mock provider for tests. This repository must not duplicate Totem core or extension logic.

### `KingHacker9000/totem-registry`

Registry metadata and validation rules for discoverable extensions/themes. It begins as a simple signed/indexed metadata source and may later gain a hosted service. The core must continue to support direct/local installation without depending on this registry.

## Private/local repositories

### `KingHacker9000/totem-portal-theme`

Private personal theme repository. May contain locally used character-specific visual assets, sounds, persona configuration, wake-word settings, and TTS models. Nothing in public Totem should require this repository.

### `KingHacker9000/totem-portal-hardware`

Private personal cosmetic/mechanical overlay repository for the user's themed enclosure. Generic chassis engineering, reusable mounts, cooling, acoustics, electronics, and broadly redistributable CAD stay in `totem-hardware`; franchise-specific cosmetic geometry and themed physical details stay private/local. Nothing in public Totem requires this repository.

## Temporary coordination infrastructure

### `KingHacker9000/totem-taskboard`

Disposable, non-product coordination repository used while the project is being built. Its issues coordinate parallel ChatGPT/Codex work, task claims, blockers, dependencies, and handoffs. It is **not** a runtime dependency, SDK dependency, registry source, or part of the shipped Totem product and may be deleted once project coordination no longer needs it.

## Later repositories

### `totem-node`

Planned remote-node agent for Windows/Linux/macOS/Pi devices, exposing explicit remote capabilities such as command execution, notifications, system status, file transfer, application launching, and power control.

### `totem-docs`

Only split out if the documentation/site becomes large enough to justify it. Until then, architecture and product documentation lives with the relevant code.

## Dependency direction

```text
base extensions  ---> extension SDK ----\
                                     \   \
base themes      ---> theme SDK ------>  totem
                                         ^
agent providers -------------------------|
                                         |
registry ----- metadata only ------------|

hardware is mechanically coupled to deployment requirements,
but not imported as a software dependency.

private Portal repositories and totem-taskboard are not
runtime or package dependencies of the public project.
```

The SDK repositories define contracts; `totem` consumes them. Base packages are examples/first-party implementations of those contracts. Third-party packages must not need private core APIs.
