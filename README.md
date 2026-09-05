# Totem

Totem is an open-source platform for building physical, voice-first AI assistants that can be extended with capabilities and transformed with themes.

Totem deliberately separates **what the assistant can do** from **what the assistant looks and sounds like**:

- **Core** provides the runtime, display, speech pipeline, agent bridge, permissions, events, task state, storage, and management dashboard.
- **Extensions** add capabilities such as Spotify, GitHub, Home Assistant, DoorDash/MCP integrations, timers, weather, or device control.
- **Themes** change visual identity, animations, sounds, persona instructions, wake-word presentation, LED behavior, and TTS configuration without granting new capabilities.
- **Agent providers** bridge Totem to external agent runtimes such as Codex CLI and Claude Code CLI. Totem does not require a general-purpose LLM to run on the device.

The initial development target is a Windows PC running a complete device simulator. Raspberry Pi 5 deployment and physical hardware integration come later, after the software contracts are stable.

## Project principles

1. **Generic core, specific themes.** Character- or franchise-specific assets do not belong in the public core.
2. **Extensions add capability; themes add identity.** Themes must not silently gain privileged access.
3. **No on-device general-purpose LLM requirement.** Local compute is reserved for speech, UI, orchestration, and lightweight deterministic functions; agentic reasoning is delegated to pluggable external agent providers.
4. **MCP is a first-class extension mechanism.** Extensions may register MCP servers/connectors with compatible agent providers.
5. **Hardware-agnostic UI.** Totem must work with rectangular, square, masked-circular, or headless displays.
6. **Simulator first.** Everything practical should be testable on a normal development PC before Pi or enclosure work begins.
7. **Explicit permissions and auditability.** Privileged operations, credentials, and extension capabilities must be declared and logged.
8. **Long-running work survives UI sessions.** Agent tasks are persistent first-class objects, not tied to one transient chat view.

## Repository family

See [docs/REPOSITORIES.md](docs/REPOSITORIES.md) for the role and dependency boundaries of every Totem repository.

## Current status

**Phase 0 is complete.** The core architectural decisions, repository boundaries, security direction, software-first roadmap, and hardware/CAD handoff have been documented.

In progress: **Phase 1 — core software platform and PC simulator.**

The initial workspace scaffold is runnable. See [development setup](docs/DEVELOPMENT.md#run-the-t102-scaffold) for installation, checks, and local startup.

See [docs/PHASE0.md](docs/PHASE0.md) for the completion record and [docs/ROADMAP.md](docs/ROADMAP.md) for the implementation plan.

## Documentation

- [Vision](docs/VISION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Repository map](docs/REPOSITORIES.md)
- [Extensions](docs/EXTENSIONS.md)
- [Themes](docs/THEMES.md)
- [Agent providers](docs/AGENTS.md)
- [Display and simulator](docs/DISPLAY.md)
- [Speech](docs/SPEECH.md)
- [Security model](docs/SECURITY.md)
- [Storage](docs/STORAGE.md)
- [Development](docs/DEVELOPMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 completion](docs/PHASE0.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing

Licensing is intentionally not finalized yet. The public repositories are intended to be open source, but the exact software/hardware licenses will be selected before the first public release. Proprietary or copyrighted character assets belong only in private/local themes and are not part of Totem's public distribution.
