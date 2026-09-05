# Phase 0 completion record

Phase 0 establishes the architecture and repository boundaries before production implementation begins.

## Completed

- [x] Define Totem as a generic open-source physical-assistant platform.
- [x] Separate capability (extensions) from identity (themes).
- [x] Keep character/franchise-specific assets private/local and outside public core dependencies.
- [x] Decide that a general-purpose LLM/agent does not run locally by default.
- [x] Define external agent providers around Codex CLI / Claude Code CLI with a shared abstraction.
- [x] Make MCP a first-class extension capability.
- [x] Define local speech responsibilities: wake word, VAD, STT, TTS, interruption/playback.
- [x] Define persistent tasks independent of UI/conversation lifetime.
- [x] Define auditable privilege/security direction for shell/sudo/system operations.
- [x] Make display geometry hardware-agnostic and support rectangular panels behind circular masks.
- [x] Choose software-first, PC-first implementation before Pi/hardware work.
- [x] Record the external-HDD storage direction for the eventual Pi deployment.
- [x] Record future hardware requirements and parametric-CAD workflow.
- [x] Initialize public SDK/base/provider/registry/hardware repositories with scope documentation.
- [x] Initialize the private Portal-themed repository without making it a public dependency.
- [x] Add architecture decision records for the major decisions.
- [x] Add contribution rules and a first roadmap.

## Deliberately deferred

These are not Phase 0 blockers:

- exact implementation stack/package manager
- exact extension/theme manifest schemas
- exact permission vocabulary
- STT/TTS engine selection
- wake-word engine selection
- final touchscreen/microphone/speaker/LED/fan components
- enclosure dimensions and final CAD
- Raspberry Pi packaging
- extension/theme registry service design

## Open release decision

The exact software and hardware licenses must be chosen before the first public release. The repositories are intended to be open source, but a license is not being guessed implicitly during architecture work.

## Next phase

Phase 1 builds the first runnable Totem entirely on a normal PC:

- core runtime
- typed protocol/events
- durable task state
- dashboard shell
- display simulator with circular-mask support
- virtual touch/LED hardware
- mock agent provider
- extension/theme discovery stubs

Phase 1 is complete when Totem can boot locally, render its simulated physical display, show system state in the dashboard, and execute a mocked persistent task end to end without special hardware.
