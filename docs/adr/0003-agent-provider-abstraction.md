# ADR 0003: External agents sit behind an AgentProvider abstraction

**Status:** Accepted

## Context

Totem should support Codex CLI, Claude Code CLI, and future runtimes without coupling the product to one vendor's session or event semantics.

## Decision

All external agent runtimes implement a shared `AgentProvider` contract for session lifecycle, messages, streaming events, cancellation, workspaces, and MCP registration.

## Consequences

- Provider adapters can evolve independently.
- Core UI/tasks depend on normalized events rather than CLI-specific output.
- Provider-specific features may still be surfaced as optional capabilities.
