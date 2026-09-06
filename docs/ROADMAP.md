# Roadmap

The project is intentionally software-first. Hardware/CAD work begins after the software contracts and simulator are mature enough to define real physical requirements.

## Phase 0 — architecture and repository bootstrap

Status: **complete.**

Deliverables:

- project vision and public/private boundary
- repository ownership map
- core architecture
- extension/theme separation
- agent-provider abstraction
- MCP integration direction
- display/simulator requirements
- local speech direction
- security/privilege model
- storage strategy
- software-first development policy
- ADRs recording the major architectural decisions
- all existing Totem repositories initialized with scope/readme documentation

See [PHASE0.md](PHASE0.md).

## Phase 1 — core software platform + PC simulator

Status: **complete.** The clean-checkout release gate passed on 2026-09-06; see [PHASE1.md](PHASE1.md).

Goal: boot Totem on a normal PC without any AI, Pi, or special hardware.

Delivered:

- workspace/build scaffolding
- core process and typed protocol
- configuration + embedded durable SQLite state
- event bus
- durable task model and ordered history
- dashboard shell with live status and task views
- display simulator
- device profile / visible-safe-area model
- virtual touch/LED drivers
- extension/theme discovery seams and base fixtures
- deterministic mock agent provider
- end-to-end mock task flow with interruption, reconnect, and restart persistence

Exit criterion: **passed.** A user can start Totem locally, see the simulated device and dashboard, inspect system state, and run a mocked task end to end from a fresh checkout.

## Phase 2 — extension platform

Status: **active.**

- finalize extension manifest v0
- permission declarations
- extension lifecycle
- event subscriptions/publications
- display/dashboard contributions
- settings and secrets references
- MCP registration contract
- extension SDK + validation tooling
- hello-world fixture
- first base extensions: clock, weather, timer, system status

## Phase 3 — theme platform

- finalize theme manifest v0
- visual tokens and assets
- display scene overrides
- ambient/screensaver contract
- sounds/LED behavior
- persona configuration
- TTS model/voice references
- hot theme switching
- default/reference themes
- private theme tested without any public-core special casing

## Phase 4 — agent providers

- shared AgentProvider contract
- Codex CLI adapter
- Claude Code CLI adapter
- mock provider
- session persistence/resume
- streaming normalized events
- workspace policy
- cancellation/interruption
- MCP injection
- task/dashboard integration

## Phase 5 — local speech on PC

- wake word / push-to-talk baseline
- VAD
- local STT
- local TTS
- streaming response playback
- barge-in/cancellation
- keyboard and dashboard input remain equivalent paths
- theme-driven voice selection

## Phase 6 — dashboard + management hardening

- extension/theme management
- agent/provider settings
- MCP inspection
- tasks and activity log
- permission controls
- speech/display settings
- storage/backup status
- developer tooling

## Phase 7 — real ecosystem validation

Use deliberately different integrations to pressure-test the contracts:

- Spotify: OAuth, events, rich display UI, controls
- GitHub: agent/MCP/tool integration
- system extension: host permissions
- additional MCP-backed integration such as food delivery, where practical

Revise SDK contracts before 1.0 as needed.

## Phase 8 — Raspberry Pi deployment

- Linux/Pi packaging
- system service lifecycle
- Pi display/touch driver
- Linux audio drivers
- external-HDD data path
- recovery/safe mode
- thermal/performance profiling

The Pi should use the same core, extensions, themes, and provider contracts as the PC version.

## Phase 9 — hardware engineering and CAD

Only now freeze representative physical components.

Process:

1. choose inexpensive screen, mic hardware, speaker/amplifier, LEDs, cooling, power, and connectors
2. measure real parts with calipers, including PCBs/connectors/cable bend clearances
3. feed measurements into a parametric CAD model
4. use Codex/agentic parallel workflows where useful to generate/review parametric CAD and engineering variants
5. print small fit/tolerance coupons first
6. prototype modular internal chassis
7. validate acoustics, fan noise, airflow, LED diffusion, light bleed, touch access, and serviceability
8. iterate enclosure
9. export STEP/STL/3MF and assembly docs

The public hardware repository remains generic. Private franchise-specific cosmetic skins stay separate.

## Phase 10 — physical integration

- assemble final Pi device
- touchscreen integration
- microphone/speaker integration
- LED controller
- external HDD rear I/O
- cooling validation under realistic workloads
- wake/STT/TTS latency tuning
- end-to-end daily-use testing

## Phase 11 — ecosystem / remote nodes

- registry UX and signing model
- remote `totem-node` agent
- Windows/Linux/macOS device capabilities
- richer automations and cross-device workflows
- long-term update/rollback system
