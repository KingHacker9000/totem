# ADR 0004: Extensions add capability; themes add identity

**Status:** Accepted

## Context

Totem needs both service integrations and highly specific assistant personalities/visuals without mixing security boundaries.

## Decision

Extensions add capabilities, tools, MCP servers, jobs, settings, events, and UI contributions. Themes change presentation, persona, sounds, LEDs, and speech configuration. Themes do not grant new system/service capabilities.

## Consequences

- Security review is clearer.
- Private copyrighted themes stay isolated from public functionality.
- UI components need theme tokens so extension content can inherit the active identity.
