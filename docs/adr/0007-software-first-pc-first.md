# ADR 0007: Software-first, PC-first development

**Status:** Accepted

## Context

The target Pi currently lacks the final speaker/microphone hardware, while almost all product contracts can be designed and tested on a normal PC.

## Decision

Build the complete software stack on the development PC first: core, simulator, extensions, themes, agent providers, dashboard, and local speech. Raspberry Pi deployment follows once software behavior is stable. Detailed enclosure/CAD work follows after software requirements and representative components are known.

## Consequences

- Faster iteration and less hardware blockage.
- Pi-specific behavior must remain behind platform drivers.
- Hardware requirements will be informed by actual software usage rather than speculation.
