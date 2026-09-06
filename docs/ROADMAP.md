# Roadmap

Totem is intentionally software-first. The original software architecture/runtime work is now substantially implemented. The program has entered a **real-world validation and physical-product phase**: prove the software with real providers/audio/Pi hardware, then choose and measure components, generate parametric CAD, assemble the prototype, and complete release readiness.

## Phase 0 — architecture and repository bootstrap

Status: **complete.**

Delivered project vision/public-private boundaries, repository ownership, core architecture, extension/theme separation, agent-provider abstraction, MCP direction, display/simulator requirements, speech/security/storage strategy, development policy, and ADRs.

See [PHASE0.md](PHASE0.md).

## Phase 1 — core software platform + PC simulator

Status: **complete.** The clean-checkout release gate passed on 2026-09-06; see [PHASE1.md](PHASE1.md).

Delivered workspace/build scaffolding, core/typed protocol, durable SQLite tasks/history, event bus, dashboard, display simulator, device profiles, scene/LED simulation, extension/theme discovery, deterministic mock provider, and reconnect/restart-safe mocked task execution.

Exit criterion: **passed.** A fresh PC checkout can run Totem, inspect authoritative system/task state, and execute a mocked persistent task end to end.

## Phase 2 — extension platform

Status: **software implementation complete; product/UI and live-service follow-up active.**

Delivered:

- `totem.extension/v0` manifest and permission vocabulary;
- extension SDK validation and authoring types;
- lifecycle/permission broker with fail-closed grants;
- extension events, settings, secret references, MCP registration and contribution metadata;
- first-party clock/weather/timer/system-status pack;
- clean cross-repository integration gate with Windows/Linux CI.

Final integration evidence is recorded in `PHASE2_INTEGRATION.md` and task-board T207. Remaining follow-up: render extension display/dashboard contributions end to end and validate selected services with real credentials where available.

## Phase 3 — theme platform

Status: **complete.**

Delivered full theme manifest/validation, visual/presentation/persona/voice/LED/sound surfaces, hot switching and rollback, public default/reference themes, and the private Portal theme through the exact same generic contract with no public-core franchise special casing.

## Phase 4 — agent providers

Status: **software implementation complete; real-machine burn-in pending.**

Delivered provider-neutral AgentProvider contract plus concrete Codex CLI and Claude Code CLI adapters, session persistence/resume, normalized streaming, workspace policy, cancellation/interruption, MCP handoff, durable task integration, status/capability APIs, and provider dashboard controls.

Deterministic fake-process tests cover adapter behavior without credentials. A consolidated real-PC gate will later exercise installed/authenticated CLIs rather than spending Codex usage throughout ordinary implementation.

## Phase 5 — local speech on PC

Status: **framework complete; production audio path follow-up active.**

Delivered provider-neutral speech orchestration, deterministic VAD, STT/TTS adapter interfaces, model-path availability handling, streaming TTS playback, barge-in/cancellation, text/speech convergence on one durable task path, and theme voice selection.

Remaining follow-up:

- concrete production local STT and TTS adapters;
- real PC microphone capture and speaker playback adapters;
- operator status/settings surfaces;
- real audio latency/usability validation during the consolidated PC gate.

## Phase 6 — dashboard + management hardening

Status: **substantially complete; targeted operator API follow-up active.**

Delivered extension/theme management, provider configuration/status, MCP/security inspection, durable task activity/interruption, settings editing, health/storage visibility, and capability-aware unavailable states.

Remaining follow-up is to replace mature-but-unexposed unavailable panels with real core APIs for speech/display status/settings, logs, backup/export/restore planning, and secure remote-access configuration.

## Phase 7 — real ecosystem validation

Status: **software contract/fixture validation complete; live-service burn-in pending.**

Spotify, GitHub and system-control fixtures pressure-test OAuth/secret/network/display/audio, MCP/agent-tool, and host-permission classes. Registry/update and remote-node integration are also implemented.

Live account/service checks are intentionally opt-in and belong in the consolidated PC validation harness rather than credentialed CI.

## Phase 8 — Raspberry Pi deployment

Status: **software-only deployment layer complete; real Pi validation pending.**

Delivered:

- Linux/systemd packaging and service lifecycle;
- idempotent timestamped-release installer;
- atomic update/rollback primitive;
- diagnostics and thermal telemetry helpers;
- configurable external-HDD durable-state path;
- hardware-agnostic display/touch/audio/LED driver interfaces with safe headless defaults.

Next steps:

1. harden one-command Pi readiness/self-test reporting;
2. run the software on the user's actual Pi 5;
3. exercise restart/reboot persistence, update/rollback, storage, providers, and sustained CPU/RAM/temperature behavior;
4. only then unlock representative physical component selection.

The Pi continues to use the same core, extensions, themes, provider, task, and event contracts as PC.

## Validation wave — real PC before physical hardware

Status: **active.**

Before selecting physical components, finish the remaining software-product gaps and run one consolidated local burn-in:

1. productionize concrete PC STT/TTS/audio adapters;
2. render extension display/dashboard contributions through the generic extension contract;
3. expose remaining mature operator APIs for speech/display/logs/backups/security;
4. prepare a credential-safe live-provider/live-service validation harness;
5. run one consolidated fresh-PC/browser/audio/provider integration gate.

### Codex usage policy

Codex usage is intentionally scarce. Routine coding, documentation, CI repair, GitHub review, dashboard/API work, and ordinary integration should be completed directly with ChatGPT/tools whenever practical.

The current task-board wave deliberately reserves `CODEX_ONLY` for only:

- **T905** — one consolidated real-PC/browser/audio/provider burn-in;
- **T910** — measured parametric CAD generation/geometry validation.

Do not fragment those into smaller Codex jobs or create extra Codex-only work for convenience.

## Phase 9 — hardware engineering and CAD

Status: **blocked on real Pi validation.**

Physical work follows an explicit evidence chain:

1. validate Totem on the real Pi 5;
2. research/select inexpensive representative display, mic, speakers/amp, LEDs, cooling, power, connectors and service hardware;
3. acquire/inspect the selected prototype parts;
4. measure real parts with calipers, including PCBs, mount holes, connectors, cable exits and bend/service clearances;
5. record code-friendly interface-control data and printer fit/tolerance assumptions;
6. **only then** use Codex for code-driven parametric CAD/geometry validation;
7. print small fit/tolerance coupons first;
8. prototype modular Pi/screen/audio/LED/cooling/rear-I/O subassemblies;
9. export STEP/STL/3MF from parametric source and document assembly.

The public `totem-hardware` repository remains generic. Private Portal/franchise-specific cosmetic geometry stays in `totem-portal-hardware` and may consume generic chassis interfaces without becoming a public dependency.

## Phase 10 — physical integration

Status: **not started.**

After real Pi validation, component measurement, CAD, and wiring plans are complete:

- assemble the physical Pi device;
- integrate touchscreen/display masking and touch transforms;
- integrate microphone/speaker/amp and physical mic mute behavior;
- integrate LED controller/diffusion;
- validate external HDD/rear I/O and serviceability;
- validate cooling/thermal throttling under realistic load;
- tune STT/TTS latency, barge-in, fan/audio isolation and feedback control;
- validate LED hotspots/light bleed, cable strain/bend, fit and print tolerances;
- perform end-to-end daily-use testing;
- feed generic fixes back to public hardware, private cosmetics only to private hardware.

## Phase 11 — ecosystem / remote nodes

Status: **core software substantially complete early.**

Delivered registry metadata/signing/integrity/install/rollback primitives, concrete `totem-node` HTTP agent/client transport, capability advertisement/enforcement, deterministic workflow routing, and Totem management APIs for registry and remote nodes.

Longer-term deployment hardening, richer automations, and cross-device production burn-in remain possible follow-ups rather than blockers for the first physical Totem milestone.

## Release readiness

Status: **not complete.**

Before calling the first Totem milestone complete:

- choose and apply public software/hardware licenses;
- complete real-PC, real-Pi and physical-prototype evidence;
- ensure public/private asset boundaries are clean;
- reproduce hardware source/exports/BOM/assembly docs;
- reconcile README/roadmap/status across repositories;
- record intentional limitations;
- retire the temporary `totem-taskboard` only after no project state depends on it.
