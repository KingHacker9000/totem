# Phase 1 completion record

Phase 1 — **core software platform + PC simulator** — completed on **2026-09-06**.

## Release gate

The technical release gate was task-board T118. Its clean-checkout regression pass was integrated to `totem` `main` by PR #21 as squash commit `f5bd841`.

Validated environment:

- fresh repository clones
- Node 24.18.0 / pnpm 10.28.0, with hosted CI also covering Node 22.20.0
- Windows and Linux hosted CI
- sibling `totem-base-extensions` and `totem-base-themes` fixture repositories

The clean setup completed `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, and `pnpm dev` successfully. Hosted PR CI passed the full Windows/Linux × Node 22.20/24.18 matrix.

## Exit criterion evidence

Phase 1 required a developer to start Totem locally, see the dashboard and simulated device, inspect system state, and run a mocked task end to end. The regression pass verified:

- core, dashboard, and display launch together on the documented PC path;
- extension discovery finds the base `clock` fixture and theme discovery finds the active `default` theme fixture;
- mock tasks exercise success, failure, waiting, interruption, cancellation, and ordered persisted event history;
- the dashboard can submit tasks, inspect history/detail state, receive live updates, and interrupt a running task;
- the display simulator follows core-driven task state and virtual LED/scene state;
- browser/core reconnects recover authoritative state;
- task history survives full-stack restart;
- repeated core restarts can start new tasks against the same SQLite store without session-id collisions;
- no browser console errors were observed during the release-gate browser pass.

The final automated task suite contained 50 passing tests after the restart-collision regression was added.

## Release-gate fixes

The fresh-clone pass found and fixed three integration issues before Phase 1 was declared complete:

1. Core/provider session identifiers could collide after a core restart. Core now persists its own durable `sess_<uuid>` id while retaining the provider session reference separately.
2. The Windows development launcher emitted Node DEP0190 due to `shell: true`; it now invokes `pnpm` through `cmd.exe` explicitly while retaining process-tree cleanup.
3. The benign pnpm `Ignored build scripts: better-sqlite3` message is now documented. The pinned package supplies the prebuilt binary used by the supported environments, so the validated flow does not require enabling the install script.

## Known limitations / deferred work

These are not Phase 1 regressions; they belong to later roadmap phases:

- Extension discovery and base fixtures prove the seam, but full extension lifecycle, permissions, contribution APIs, settings/secrets, MCP registration, and SDK validation are Phase 2 work.
- Theme discovery proves the theme boundary, but full theme lifecycle/hot switching and richer visual/persona/voice contracts are Phase 3 work.
- The deterministic mock provider is the Phase 1 provider. Real Codex CLI and Claude Code CLI adapters are Phase 4 work.
- Local speech (wake word/PTT, VAD, STT, TTS, playback, barge-in) is Phase 5 work.
- Dashboard management surfaces beyond the Phase 1 status/task shell are Phase 6 work.
- Automated browser E2E coverage is still lighter than the release-gate manual/browser regression pass and should be expanded as those surfaces mature.
- A real interactive terminal Ctrl+C check is still worthwhile. The launcher process-tree cleanup mechanism itself was verified directly with `taskkill /T` and left no orphan Node processes.
- Terminal mock success/failure intentionally leaves the derived LED showing the outcome rather than immediately returning to idle; revisit this behavior with real providers.
- Historical rows created before the durable-session-id fix can retain old `mock-session-N` identifiers; they are harmless and require no migration.

## Hardware gate

Phase 1 completion does **not** unblock hardware/CAD. The roadmap remains software-first: Raspberry Pi deployment is Phase 8 and hardware engineering/CAD is Phase 9, after the intervening software contracts and representative physical requirements are known.

## Next phase

Phase 2 — **extension platform** — is the active phase. Its task-board work starts from the validated Phase 1 contracts rather than reopening Phase 1 implementation.
