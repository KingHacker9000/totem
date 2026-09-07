# Totem

Totem is an open-source platform for building physical, voice-first AI assistants that can be extended with capabilities and transformed with themes.

Totem deliberately separates **what the assistant can do** from **what the assistant looks and sounds like**:

- **Core** provides the runtime, display, speech pipeline, agent bridge, permissions, events, task state, storage, and management dashboard.
- **Extensions** add capabilities such as Spotify, GitHub, Home Assistant, DoorDash/MCP integrations, timers, weather, or device control.
- **Themes** change visual identity, animations, sounds, persona instructions, wake-word presentation, LED behavior, and TTS configuration without granting new capabilities.
- **Agent providers** bridge Totem to external agent runtimes such as Codex CLI and Claude Code CLI. Totem does not require a general-purpose LLM to run on the device.

The software platform has advanced beyond the original PC-simulator milestone into real provider adapters, extension/theme runtimes, management tooling, registry/remote-node infrastructure, speech orchestration, deterministic release tooling, and validated Raspberry Pi deployment lifecycle support.

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

The **software platform and Raspberry Pi deployment path are implemented and substantially validated**. The initial physical-product milestone is not complete yet.

Completed/integrated work includes:

- architecture, core runtime, PC simulator, durable task state, and clean-checkout validation;
- extension and theme SDK/runtime contracts, permissions, lifecycle, settings/secrets/MCP, public reference content, and private-theme separation;
- real Codex CLI and Claude Code CLI provider adapters with durable sessions, streaming, cancellation/resume, and workspace policy;
- provider-neutral speech orchestration, deterministic VAD, local STT/TTS adapter seams, streaming playback, barge-in, and device capability/simulation adapters;
- capability-aware management/operator APIs and dashboard surfaces;
- registry signing/install/rollback primitives, ecosystem integration fixtures, remote-node transport, and management APIs;
- Raspberry Pi systemd installation, update/rollback, readiness/self-test lifecycle, low-disk/release-retention safeguards, diagnostics, and real-Pi validation;
- deterministic release configuration checks, third-party manifests, source-to-artifact provenance, public bundle/content-privacy boundaries, and repository metadata checks.

The supported CI matrix validates Linux and Windows on the supported Node releases and includes the pinned public extension integration path. Use the current CI workflow and the release validation commands below instead of relying on historical commit hashes embedded in documentation.

### What is still not complete

The remaining initial-milestone gates are intentionally narrow:

- capture the actual purchased-part identities and real caliper/fit-coupon measurements required for CAD;
- generate measured parametric CAD from those real measurements, then print/assemble and validate the physical prototype;
- select and apply the owner-approved public software/hardware license policy;
- finish final release documentation and workflow supply-chain drift hardening before project closeout.

Final enclosure CAD must not be generated from guessed dimensions. Private Portal cosmetics remain separate from the public generic chassis and public release artifacts.

## Release validation

From a clean checkout with the supported Node and pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm release:config:smoke
pnpm release:bundle:build
pnpm release:bundle:verify
pnpm release:artifact:scan
```

`pnpm check` includes release configuration, repository metadata, documentation drift, lint, formatting, typechecking, and tests. CI additionally validates the public repository-family documentation surfaces, the release artifact content boundary, and the pinned Phase 2 extension integration path.

For a real Raspberry Pi lifecycle check, use:

```bash
pnpm validate:pi
```

For opt-in live provider/service validation, use:

```bash
pnpm validate:live
```

On Windows, see the [one-command development bootstrap](docs/WINDOWS_DEVELOPMENT.md). For architecture/tooling details see [development setup](docs/DEVELOPMENT.md), for startup/runtime settings see [core configuration](docs/CONFIGURATION.md), and for Pi deployment see [Raspberry Pi deployment](docs/RASPBERRY_PI_DEPLOYMENT.md).

See [docs/PHASE0.md](docs/PHASE0.md), [docs/PHASE1.md](docs/PHASE1.md), and [docs/ROADMAP.md](docs/ROADMAP.md) for the implementation plan and completion records.

## Documentation

- [Vision](docs/VISION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol and durable-task contract v0](docs/PROTOCOL.md)
- [Core configuration and data layout](docs/CONFIGURATION.md)
- [Extension/theme discovery contract v0](docs/DISCOVERY.md)
- [Repository map](docs/REPOSITORIES.md)
- [Extensions](docs/EXTENSIONS.md)
- [Themes](docs/THEMES.md)
- [Agent providers](docs/AGENTS.md)
- [Display and simulator](docs/DISPLAY.md)
- [Speech](docs/SPEECH.md)
- [Security model](docs/SECURITY.md)
- [Storage](docs/STORAGE.md)
- [Development](docs/DEVELOPMENT.md)
- [Windows development bootstrap](docs/WINDOWS_DEVELOPMENT.md)
- [Raspberry Pi deployment](docs/RASPBERRY_PI_DEPLOYMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 completion](docs/PHASE0.md)
- [Phase 1 completion](docs/PHASE1.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing

Licensing is intentionally not finalized yet. The public repositories are intended to be open source, but the exact software/hardware licenses will be selected before the first public release. Proprietary or copyrighted character assets belong only in private/local themes and hardware skins and are not part of Totem's public distribution.
