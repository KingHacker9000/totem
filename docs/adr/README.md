# Architecture Decision Records

Accepted Phase 0 decisions:

- [0001 — Generic platform; specific identities live in themes](0001-generic-platform-specific-themes.md)
- [0002 — No on-device general-purpose LLM requirement](0002-no-on-device-general-purpose-llm.md)
- [0003 — External agents sit behind an AgentProvider abstraction](0003-agent-provider-abstraction.md)
- [0004 — Extensions add capability; themes add identity](0004-extensions-vs-themes.md)
- [0005 — MCP is a first-class extension capability](0005-mcp-first-class-extension-capability.md)
- [0006 — Display software is independent of physical panel shape](0006-display-hardware-agnostic.md)
- [0007 — Software-first, PC-first development](0007-software-first-pc-first.md)
- [0008 — Persistent agent tasks are independent of UI sessions](0008-persistent-tasks.md)
- [0009 — Privileged operations are brokered and auditable](0009-broker-privileged-operations.md)

These decisions are intended to prevent later implementation work from accidentally collapsing Totem back into a character-specific Raspberry Pi script collection.
