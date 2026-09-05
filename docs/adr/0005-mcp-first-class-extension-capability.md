# ADR 0005: MCP is a first-class extension capability

**Status:** Accepted

## Context

Many future integrations are better expressed through existing or dedicated MCP servers than through hard-coded service logic in Totem.

## Decision

Extensions may register MCP servers/connectors with the agent broker. Compatible agent providers receive the enabled MCP set for a session. MCP-only extensions are valid.

## Consequences

- Totem can gain broad service integration without bloating core.
- MCP authentication/configuration remains extension-owned.
- Provider adapters need capability detection and explicit unsupported-feature behavior.
