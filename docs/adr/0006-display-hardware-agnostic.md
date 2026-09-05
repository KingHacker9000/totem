# ADR 0006: Display software is independent of physical panel shape

**Status:** Accepted

## Context

A true circular touchscreen is unnecessary and may be more expensive than a standard rectangular/square panel hidden behind a circular bezel.

## Decision

Totem renders to a configurable logical safe area and never assumes the physical panel itself is circular. Device profiles describe panel resolution, visible mask, and touch capability.

## Consequences

- Cheap standard panels are usable.
- The PC simulator can emulate the eventual enclosure.
- Themes/extensions must respect safe-area/layout APIs rather than raw panel edges.
