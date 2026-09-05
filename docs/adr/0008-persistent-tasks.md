# ADR 0008: Persistent agent tasks are independent of UI sessions

**Status:** Accepted

## Context

Agentic work may take minutes or hours and must continue while the display changes, the dashboard disconnects, or the user leaves the conversation view.

## Decision

Long-running work is modeled as durable tasks with IDs, lifecycle state, progress/events, associated provider sessions, and resumable user interaction. UI surfaces observe tasks but do not own them.

## Consequences

- Display/dashboard can come and go without cancelling work.
- Task state needs durable local storage.
- Providers must expose cancellation/resume capabilities where possible.
