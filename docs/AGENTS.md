# Agent providers

Totem delegates general-purpose agentic reasoning to external agent runtimes. The first-class target providers are **Codex CLI** and **Claude Code CLI**.

Totem itself does not require a general-purpose LLM to run on the device.

## AgentProvider contract

The provider interface should normalize at least:

```text
probeCapabilities()
startSession(options)
resumeSession(sessionId)
sendMessage(sessionId, content)
streamEvents(sessionId)
interrupt(sessionId)
terminate(sessionId)
attachWorkspace(sessionId, workspace)
registerMcpServers(sessionId, servers)
```

Names are illustrative until implementation.

## Provider events

Providers should translate native CLI/runtime events into a common stream such as:

```text
agent.session.started
agent.text.delta
agent.tool.started
agent.tool.completed
agent.permission.requested
agent.input.requested
agent.task.progress
agent.error
agent.session.completed
```

The dashboard may expose provider-native detail for debugging, but core features should depend only on normalized events.

## Workspaces

Agent sessions must have an explicit working directory/workspace policy. Totem should never silently point a provider at the entire host filesystem.

A task may request broader host capabilities through the Totem permission broker when explicitly allowed.

## MCP registration

Extensions may contribute MCP servers. The agent broker resolves enabled servers for a session and passes them to providers that support MCP.

Provider adapters must report unsupported MCP features clearly rather than emulating them invisibly.

## Permissions and sudo

Totem may eventually perform privileged actions, including operations requiring sudo, but providers should not be handed unrestricted root access by default. Privileged operations should flow through explicit capabilities/policies so that they can be logged and revoked.

## Agent selection

Users should be able to choose a default provider and later override it per task/automation. The core must not assume Codex- or Claude-specific semantics.

## Mock provider

`totem-agent-providers` should include a deterministic mock provider early. It enables end-to-end testing of UI, streaming, task persistence, cancellation, permission prompts, and MCP registration without consuming an external agent session.
