# ADR 0002: No on-device general-purpose LLM requirement

**Status:** Accepted

## Context

The target Pi 5 should stay lightweight and reliable. General-purpose reasoning can be delegated to external coding/agent runtimes.

## Decision

Totem does not require a local LLM. Local compute handles wake word/VAD/STT/TTS, UI, orchestration, deterministic commands, extension hosting, and device drivers. General agentic work is delegated to provider adapters such as Codex CLI or Claude Code CLI.

## Consequences

- Lower Pi compute/storage requirements.
- Better access to stronger agent runtimes.
- Offline behavior is limited to local deterministic/speech/device features unless a future provider adds offline reasoning.
- Core architecture must tolerate provider/network unavailability gracefully.
