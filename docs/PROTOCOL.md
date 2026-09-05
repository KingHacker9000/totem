# Protocol and durable-task contract v0

This document is the implementation source of truth for Totem Phase 1 normalized events, durable tasks, sessions, reconnect behavior, and provider-event normalization.

The v0 contract is intentionally small. It defines semantics that multiple components must agree on without freezing the eventual public SDK/protocol v1.

## Design rules

1. **Core is authoritative.** Browser clients, display surfaces, providers, extensions, and speech components observe or request changes; they do not own durable task state.
2. **Serialized events are normalized.** Provider-native event objects never cross the core protocol boundary directly.
3. **Event ownership is explicit.** Third-party extensions cannot emit event types that look like core events.
4. **Task history is durable and append-oriented.** A current-state snapshot may be cached, but state-changing history must remain reconstructable/auditable.
5. **Reconnect starts from authoritative state.** Clients must not assume their browser memory is current after reconnect.
6. **Cancellation is a request before it is a fact.** A task is not `cancelled` merely because a client asked for cancellation.
7. **Transport is not the domain model.** HTTP + SSE is the Phase 1 transport, but task/event semantics are defined independently of Fastify, React, or SSE implementation details.

## Normalized event envelope

Every event that crosses a Totem component boundary uses the following logical envelope:

```ts
interface TotemEvent<T = unknown> {
  schema: "totem.event/v0";
  id: string;                 // globally unique event id (UUID/ULID-style)
  type: string;               // validated event type / namespace
  occurredAt: string;         // UTC ISO-8601 timestamp
  source: {
    kind: "core" | "client" | "extension" | "provider" | "speech" | "device";
    id: string;               // stable logical source id
  };
  taskId?: string;
  sessionId?: string;
  correlationId?: string;     // groups one user/request flow
  causationId?: string;       // id of event/command that directly caused this event
  payload: T;                 // JSON-serializable, validated for known core events
}
```

### Envelope invariants

- `schema` is exactly `totem.event/v0` during Phase 1.
- `id` is immutable and unique. Re-delivery/replay uses the same id; consumers may deduplicate by id.
- `occurredAt` records when the event became true in Totem, not when a browser received it.
- `payload` must be JSON-serializable. Do not serialize raw `Error`, subprocess, SDK, transport, or provider objects.
- `taskId` is present for task-scoped lifecycle/progress events.
- `sessionId` is present when the event is associated with a durable provider/conversation session.
- `correlationId` is propagated through a user action/task flow when available.
- `causationId` points to the immediately preceding command/event when known and must not be invented when unknown.
- Unknown extra fields at the envelope level are rejected in v0 rather than silently accepted.

The implementation may attach transport-only metadata such as an SSE cursor or in-process sequence number outside the durable envelope. Such metadata is not part of event identity or domain semantics.

## Event namespace ownership

Core-owned prefixes are reserved:

```text
input.*
speech.*
agent.*
task.*
extension.*
theme.*
display.*
audio.*
system.*
notification.*
```

Only Totem core/runtime components may publish serialized events under these prefixes.

Third-party extension-defined events use:

```text
ext.<extension-id>.<event-name>
```

Examples:

```text
ext.spotify.playback_changed
ext.home-assistant.entity_changed
```

Rules:

- `<extension-id>` must equal the validated installed extension id that owns the publisher.
- Extensions cannot publish `task.*`, `agent.*`, `system.*`, `extension.*`, or any other core-owned prefix.
- The extension host/runtime stamps and validates the source; extension code cannot claim `source.kind = "core"`.
- Core may emit `extension.*` events *about* an extension, such as `extension.discovered` or `extension.disabled`.
- Themes do not gain a generic privileged event namespace in v0. Core may emit `theme.*` lifecycle/presentation events.

### Provider events

Provider adapters may receive arbitrary native events from Codex CLI, Claude Code CLI, a mock provider, or a future provider. Native provider event names/objects are adapter-private.

Before an event reaches the core bus/UI/durable task history, the adapter/broker must map it to one of:

- a normalized `agent.*` event;
- a normalized `task.*` lifecycle/progress event;
- a provider-neutral typed result/error object used to create one of those events.

Provider-specific metadata that is useful for debugging may appear only inside an explicitly optional `providerMeta` object in an approved normalized payload. Core behavior must never branch on undocumented raw provider fields.

## Minimum core event set for Phase 1

Phase 1 implementations may add events when needed, but the following semantics are reserved:

```text
task.created
task.started
task.progress
task.waiting_for_input
task.resumed
task.cancel_requested
task.cancelling
task.cancelled
task.succeeded
task.failed
agent.session_created
agent.session_resumed
agent.message
agent.progress
agent.interrupted
system.ready
system.stopping
```

`task.progress` is informational and does not itself change task lifecycle state.

Example:

```json
{
  "schema": "totem.event/v0",
  "id": "01JEXAMPLEEVENT000000000001",
  "type": "task.progress",
  "occurredAt": "2026-09-05T22:45:00.000Z",
  "source": { "kind": "provider", "id": "mock" },
  "taskId": "task_01JEXAMPLE",
  "sessionId": "session_01JEXAMPLE",
  "correlationId": "corr_01JEXAMPLE",
  "payload": {
    "message": "Running validation",
    "progress": 0.6
  }
}
```

`progress` is optional and, when present, is a number from `0` to `1`. Clients must not infer completion from `progress === 1`; only a terminal lifecycle transition completes a task.

## Durable task model

A task is a durable unit of work owned by Totem core.

Minimum v0 persisted shape:

```ts
type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

interface TaskRecord {
  id: string;
  kind: string;
  status: TaskStatus;
  title?: string;
  sessionId?: string;
  providerId?: string;
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  result?: unknown;
}
```

`result` and `failure` must be JSON-serializable and bounded by implementation limits; large files/artifacts should be referenced rather than embedded directly.

### State machine

Allowed lifecycle transitions are:

```text
queued
  ├─> running
  ├─> cancelled
  └─> failed

running
  ├─> waiting_for_input
  ├─> cancelling
  ├─> succeeded
  └─> failed

waiting_for_input
  ├─> running
  ├─> cancelling
  └─> failed

cancelling
  ├─> cancelled
  └─> failed

succeeded   (terminal)
failed      (terminal)
cancelled   (terminal)
```

No transition out of a terminal state is permitted. Retrying creates a new task (which may reference the previous task through metadata later) rather than resurrecting a completed record.

### Transition semantics

- Creating a task persists `queued` and emits `task.created` atomically with/after successful persistence.
- Provider execution changes `queued -> running` and emits `task.started`.
- If provider/user input is required, `running -> waiting_for_input` emits `task.waiting_for_input`.
- Supplying accepted input changes `waiting_for_input -> running` and emits `task.resumed`.
- A successful result changes `running -> succeeded`, stores the normalized result, sets `completedAt`, and emits `task.succeeded`.
- A non-cancellation execution error changes `queued|running|waiting_for_input|cancelling -> failed`, stores a normalized failure, sets `completedAt`, and emits `task.failed`.
- Confirmed cancellation ends in `cancelled`, sets `completedAt`, and emits `task.cancelled`.

## Cancellation and interruption

Cancellation and interruption are distinct.

### Task cancellation

A client requests cancellation through a core command/API. The request itself does **not** write `status = cancelled`.

For a `queued` task that has not started, core may cancel synchronously:

```text
queued -> cancelled
```

For an active task:

```text
running|waiting_for_input
  -> cancelling
  -> cancelled | failed
```

Required behavior:

1. Persist/emit `task.cancel_requested`.
2. Transition to `cancelling` and emit `task.cancelling` when active provider work must be stopped.
3. Ask the provider abstraction to stop/cancel/interrupt the active operation using provider-neutral semantics.
4. Mark `cancelled` only after Totem knows the work is no longer active.
5. If cancellation itself fails or times out in a way that prevents Totem from knowing the work stopped, mark `failed` with a normalized cancellation-related error rather than pretending cancellation succeeded.

Repeated cancellation requests are idempotent. A request against a terminal task returns the existing terminal state and does not create a new lifecycle transition.

### Interruption

An interruption asks an active provider/speech/output operation to stop its *current activity* but is not inherently a terminal task cancellation. For example, voice barge-in may interrupt TTS while the underlying task/session remains valid.

The provider broker may emit `agent.interrupted`; task lifecycle changes only when normalized provider/core behavior actually moves the task to another defined state.

## Durable task history

Each task has an append-only ordered history of normalized task-relevant events.

Implementation requirements:

- Every lifecycle transition is persisted in task history.
- Persisted events have a monotonically increasing sequence **within that task** (for example `taskSequence` in storage), independent of wall-clock timestamps.
- Current task snapshot and history update must be transactional enough that a restart cannot expose a terminal snapshot without its terminal history event, or vice versa.
- `task.progress` may be persisted in Phase 1 and is required for the mocked end-to-end scenario. A later retention policy may compact extremely high-volume progress while preserving lifecycle history.
- History is never owned solely by the dashboard/display/browser.
- State timestamps are derived/set by core during accepted transitions, not trusted from clients/providers.

A persistence implementation may use tables conceptually equivalent to:

```text
tasks
  id, status, timestamps, session_id, provider_id, normalized result/failure...

task_events
  task_id, task_sequence, event_id, event_type, occurred_at, envelope_json
```

The exact SQL schema belongs to T106.

## Durable agent/session model

A provider session is distinct from a task. One session may be associated with multiple tasks over time.

Minimum v0 persisted session shape:

```ts
type SessionStatus = "active" | "closed" | "failed";

interface AgentSessionRecord {
  id: string;
  providerId: string;
  providerSessionRef?: string; // opaque provider reference; never interpreted by core
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}
```

Rules:

- `providerSessionRef` is opaque and adapter-owned.
- UI surfaces reference a Totem `sessionId`, never a provider-native id as the primary identity.
- Losing an ephemeral provider process does not delete the Totem session record or its completed task history.
- Provider resume support is capability-dependent. If a provider cannot resume, core may keep historical session metadata but must not claim that provider execution resumed.

## Reconnect and resume behavior

Dashboard/display clients are observers of authoritative state.

On initial connection or reconnect:

1. Fetch a current core/system snapshot over HTTP.
2. Fetch/query durable tasks/sessions needed by the view.
3. Establish the SSE event stream.
4. Apply newer events idempotently by event id.
5. If the stream reports a cursor/replay gap or the core restart invalidates the live cursor, fetch authoritative snapshots/history again rather than guessing missing state.

A browser refresh, route change, dropped SSE connection, or display restart must not cancel or orphan a task.

For task detail views, durable ordered task history is the source of truth for historical progress. Live SSE improves freshness but is not the only copy of task state.

## Commands versus events

Commands request change; events report accepted facts.

Examples:

```text
POST /tasks                 command: create work
POST /tasks/:id/cancel      command: request cancellation
POST /tasks/:id/input       command: provide requested input

SSE task.created            fact: task now exists
SSE task.cancelling         fact: cancellation is in progress
SSE task.cancelled          fact: task has stopped and is terminal
```

Clients must not optimistically manufacture domain events. They may show temporary local UI state while awaiting command results, but authoritative state comes from core.

## Provider normalization examples

A provider might natively emit something like:

```json
{ "kind": "command_execution", "phase": "finished", "command": "pnpm test" }
```

or:

```json
{ "event": "tool_result", "name": "shell", "status": "ok" }
```

Neither object is forwarded directly. The adapter may normalize either to:

```json
{
  "schema": "totem.event/v0",
  "id": "01JEXAMPLENORMALIZED0000001",
  "type": "agent.progress",
  "occurredAt": "2026-09-05T22:46:00.000Z",
  "source": { "kind": "provider", "id": "codex" },
  "taskId": "task_01JEXAMPLE",
  "sessionId": "session_01JEXAMPLE",
  "payload": {
    "kind": "tool",
    "label": "Ran project tests",
    "status": "succeeded"
  }
}
```

The normalized contract may evolve before 1.0, but core/dashboard/display code must consume the normalized shape rather than provider-native schemas.

## Error normalization

Failures crossing the protocol boundary use stable machine-readable codes plus human-readable messages:

```ts
interface NormalizedFailure {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}
```

Do not expose secrets, environment variables, access tokens, raw subprocess objects, or arbitrary provider SDK exceptions in `details`.

## Implementation responsibilities by package

The Phase 1 workspace should split responsibility as follows:

- `packages/protocol`: event envelope schemas, known event payload schemas, namespace validation, serialized command/response contracts.
- `packages/events`: in-process publish/subscribe primitives that carry validated normalized events.
- `packages/tasks`: task/session types and lifecycle transition rules.
- `packages/storage`: persistence/migrations and transactional task snapshot/history storage.
- `packages/agent-provider-api`: provider-neutral session/execution/cancel/stream interfaces and normalized provider event/result types.
- `apps/core`: authoritative orchestration, HTTP commands/snapshots, SSE publishing, and composition of the packages above.
- `apps/dashboard` and `apps/display`: observers/command clients only; neither may write durable task state directly.

## Phase 1 non-goals

This v0 document does not freeze:

- public extension/theme SDK v1 schemas;
- cross-device/network federation;
- multi-user authorization;
- a durable global event-sourcing architecture for every Totem subsystem;
- final Codex/Claude provider payload mappings;
- marketplace/registry events;
- long-term event retention/compaction policy.

Those may evolve while preserving the central rule: durable task semantics and core event ownership must remain provider- and UI-independent.
