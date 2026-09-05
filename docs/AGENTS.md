# Agent providers

Totem delegates general-purpose agentic reasoning to external agent runtimes. The first-class target providers are **Codex CLI** and **Claude Code CLI**.

Totem itself does not require a general-purpose LLM to run on the device.

## AgentProvider v0 contract

Phase 1 implements the provider-neutral contract in `packages/agents`. The core/broker must depend on this abstraction rather than Codex- or Claude-specific output formats.

The v0 interface normalizes:

```text
probeCapabilities()
getStatus()
startSession(options)
resumeSession(sessionId)
sendMessage(sessionId, request)
streamEvents(sessionId)
interrupt(sessionId)
terminate(sessionId)
attachWorkspace(sessionId, workspace)
registerMcpServers(sessionId, servers)
```

A session has a Totem-visible provider/session identity, lifecycle status, optional explicit workspace metadata, and configured MCP servers. Provider capabilities explicitly report streaming, resume, interruption, workspace, and MCP support.

`sendMessage` associates work with a Totem `taskId` and optional `correlationId`; provider sessions do **not** own durable task lifetime or persistence.

## Normalized provider events

Provider adapters must not expose native CLI/runtime event objects as core semantics.

`packages/agents` uses an injected `AgentEventFactory<TEvent>`. A provider emits provider-neutral semantic drafts such as:

```text
agent.session_created
agent.session_resumed
agent.message
agent.progress
agent.error
agent.interrupted
task.started
task.progress
task.cancelling
task.cancelled
task.succeeded
task.failed
```

The Totem broker/composition layer turns those drafts into validated `totem.event/v0` events using `@totem/protocol`. This dependency direction is deliberate: provider adapters do not own the serialized core protocol, while the core can reject an adapter emission that violates the normalized event contract.

Provider-native diagnostic detail may eventually appear only inside an approved optional normalized metadata field. Core behavior must not branch on undocumented native provider output.

## Streaming

`streamEvents(sessionId)` returns an asynchronous stream. Provider adapters may internally consume subprocess stdout, SDK callbacks, or another source, but the yielded values are normalized through the injected event factory before Totem observes them.

The Phase 1 mock provider uses an in-memory async queue so dashboard/task/simulator integration can be exercised without credentials or external model usage.

## Workspaces

Agent sessions must have an explicit working directory/workspace policy. Totem should never silently point a provider at the entire host filesystem.

The v0 workspace descriptor records a path plus `read-only` or `read-write` intent. It is metadata/policy input, not a substitute for OS sandboxing or Totem's later permission broker.

A task may request broader host capabilities through the Totem permission broker when explicitly allowed.

## MCP registration

Extensions may contribute MCP servers. The agent broker resolves enabled servers for a session and passes them to providers that report MCP support.

Provider adapters must report unsupported MCP features clearly rather than emulating them invisibly. MCP server registration does not by itself grant host/network/secrets permissions.

## Permissions and sudo

Totem may eventually perform privileged actions, including operations requiring sudo, but providers should not be handed unrestricted root access by default. Privileged operations should flow through explicit capabilities/policies so that they can be logged and revoked.

## Agent selection and registry

`AgentProviderRegistry` registers providers by stable provider ID, rejects duplicates, and lets the broker resolve/list implementations without hard-coding provider names.

Users should be able to choose a default provider and later override it per task/automation. Selection policy belongs to core/broker configuration, not individual provider adapters.

## Mock provider

Phase 1 includes a deterministic `MockAgentProvider` in `packages/agents`.

It supports scripted scenarios:

- `success` — normalized progress followed by assistant output and `task.succeeded`;
- `failure` — normalized `agent.error` and `task.failed`;
- `wait` — remains pending until interruption, allowing deterministic `agent.interrupted` → `task.cancelling` → `task.cancelled` testing.

The mock also supports session start/resume/termination, explicit workspace metadata, and MCP registration. Tests inject a protocol-backed event factory so every emitted event is validated by the same `totem.event/v0` implementation used elsewhere in Phase 1.

Real Codex CLI and Claude Code CLI adapters are intentionally outside T107. They belong in `totem-agent-providers` once this provider-neutral seam has been exercised by the core and simulator.
