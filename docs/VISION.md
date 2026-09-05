# Vision

Totem is a generic platform for building a persistent physical AI companion without binding the software to a single character, franchise, enclosure, screen shape, or agent vendor.

The public project should be useful even when it is running as a normal desktop simulator with the default theme. A private user can then transform that same installation into a themed physical object by installing a theme, a set of extensions, and hardware-specific drivers.

## Product goal

A Totem installation should eventually support this interaction loop:

1. The user speaks, types, or touches the device.
2. Local input handling performs wake-word/VAD/STT or direct deterministic commands.
3. The core routes general agentic work through a selected agent provider, initially Codex CLI or Claude Code CLI.
4. Installed extensions expose capabilities, MCP tools/connectors, background events, display views, and settings.
5. Totem streams task state and responses back to the display/dashboard.
6. Local TTS speaks responses while themes determine presentation and voice configuration.
7. Long-running tasks continue independently of the current display or conversation view.

## What Totem is

- A physical-assistant runtime.
- An extension host.
- A theme host.
- An agent-runtime broker.
- A local speech and display system.
- A dashboard for configuration, permissions, tasks, extensions, themes, and logs.
- A hardware abstraction layer that can later run on Raspberry Pi 5.

## What Totem is not

- A bundled fictional character.
- A local LLM project.
- A single-purpose smart speaker.
- A monolithic collection of hard-coded integrations.
- A Raspberry-Pi-only application.
- A requirement to use a circular touchscreen.

## Open-source boundary

Totem's public repositories must stay generic and redistributable. Character-specific copyrighted art, dialogue, game assets, trained voice models based on restricted material, and proprietary private configuration belong in private/local repositories or user data directories.

The architecture must make private themes first-class without requiring the public core to know or care what they contain.
