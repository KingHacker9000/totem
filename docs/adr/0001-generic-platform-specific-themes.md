# ADR 0001: Generic platform; specific identities live in themes

**Status:** Accepted

## Context

The original device concept used a specific fictional aesthetic and voice. The project is intended to be open source and broadly reusable.

## Decision

Totem core is generic. Character/franchise identity belongs in themes and, when necessary, private/local repositories. Public core behavior must not depend on proprietary assets or character-specific assumptions.

## Consequences

- Public repositories remain reusable and easier to redistribute.
- A private theme can still radically transform the assistant.
- Core UI, prompts, sounds, and assets must use generic defaults.
