# Architecture

Totem is split into a small generic core plus replaceable providers, extensions, themes, and hardware drivers.

## High-level flow

```text
Input
  ├─ keyboard/touch
  └─ microphone -> wake word/VAD -> local STT
                         |
                         v
                    Totem Core
                         |
          +--------------+---------------+
          |              |               |
          v              v               v
   deterministic      task engine    agent broker
     commands                            |
                                        v
                               AgentProvider API
                                  |           |
                                  v           v
                              Codex CLI   Claude Code
                                  \           /
                                   \         /
                                    v       v
                                  extensions
                               / MCP / tools /
                                      |
                                      v
                               events + results
                                  /         \
                                 v           v
                             local TTS     display
                                              |
                                           theme
```

## Core responsibilities

The core owns only generic infrastructure:

- lifecycle and configuration
- event bus
- task/session persistence
- extension discovery and lifecycle
- theme discovery and lifecycle
- permission evaluation
- secret references and brokered access
- agent-provider routing
- display scene arbitration
- speech orchestration
- device-driver interfaces
- audit/activity log
- dashboard API

The core must not embed service-specific code for Spotify, DoorDash, GitHub, Home Assistant, or similar integrations.

## Runtime boundaries

### Core process

Authoritative source of state. It exposes a local API/event stream to the dashboard, display client, extension host, and speech service.

### Display client

A full-screen/kiosk-capable UI. During development it runs as a desktop/browser simulator. It must render from a configurable visible safe area rather than assuming that the physical panel itself is circular.

### Dashboard

A browser UI for configuration, extension/theme management, task inspection, permissions, providers, speech settings, storage, logs, and developer tools.

### Speech service

Owns local wake word, VAD, STT, TTS, playback interruption, and later echo-cancellation integration. It does not perform general-purpose reasoning.

### Agent broker

Normalizes external agent runtimes behind the `AgentProvider` contract. It manages sessions, cancellation, workspaces, streaming events, MCP registration, and task association.

### Extension host

Runs extension code outside the core where practical. Extensions request capabilities through declared permissions and communicate over a stable protocol rather than importing private core internals.

## Required abstractions

The first implementation should define interfaces before device-specific code:

```text
AgentProvider
DisplayDriver
TouchInput
AudioInput
AudioOutput
LightingDriver
StorageProvider
SecretProvider
ExtensionRuntime
ThemeRuntime
```

## Task model

Agentic work is represented as persistent tasks with IDs and lifecycle states such as:

```text
queued -> running -> waiting_for_input -> succeeded
                       |                 -> failed
                       -> cancelled
```

A task survives navigation away from the display, dashboard disconnects, and recoverable service restarts. Conversation/session state may reference tasks, but must not own their lifetime.

## Event model

Components communicate through typed events. Example categories:

```text
input.*
speech.*
agent.*
task.*
extension.*
theme.*
display.*
audio.*
system.*
notification.*
```

Extensions may publish namespaced events but cannot impersonate core event namespaces.

## Display arbitration

Multiple features may want the device screen simultaneously. Views therefore request presentation with metadata such as priority, timeout, interruptibility, and restoration behavior. The display manager chooses the active scene and returns to the previous ambient scene when temporary views finish.

## Hardware boundary

Phase 1 is PC-first. Raspberry Pi integration must be implemented by swapping drivers, not by rewriting the application.

The eventual enclosure, speaker, microphone array, LEDs, touchscreen, cooling, and external-HDD routing belong to `totem-hardware`; physical measurements are intentionally deferred until the software tells us what the device actually needs.
