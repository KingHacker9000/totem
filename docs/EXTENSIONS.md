# Extensions

Extensions add **capability** to Totem. They may expose tools to the active agent, register MCP servers, contribute display/dashboard views, run background jobs, publish events, define settings, and request access to secrets or operating-system capabilities.

Themes are not extensions. A theme changes identity and presentation; it must not silently gain service or system privileges.

## Extension package responsibilities

An extension may contain:

```text
extension/
├── totem-extension.yaml
├── backend/
├── display/
├── dashboard/
├── assets/
├── migrations/
└── README.md
```

The exact on-disk schema is owned by `totem-extension-sdk` and may evolve before v1.

## Manifest concepts

Every extension must declare, at minimum:

- stable ID and version
- compatible Totem/SDK versions
- requested permissions
- backend entry point, if any
- contributed display/dashboard views
- tools exposed to agents
- MCP servers/connectors it registers
- event subscriptions/publications
- settings schema
- secret references it needs

## Permissions

Examples of capabilities that must be explicit:

```text
network.internet
network.local
filesystem.read
filesystem.write
shell.user
system.service
system.package_install
system.root
display.present
audio.play
secrets.read:<name>
mcp.register
```

Permission names above are architectural examples, not a frozen v1 list.

Extensions receive only the capabilities granted to them. The dashboard must show requested vs granted permissions and support revocation.

## MCP

MCP is a first-class extension mechanism. An extension can package or configure an MCP server and ask Totem's agent broker to expose it to compatible providers.

An MCP-only extension is valid. For example, a future food-delivery extension could consist mainly of:

- authentication/configuration
- an MCP connection
- display cards for restaurant/menu/order state
- dashboard settings

The core must not need to understand the external service itself.

## UI contributions

Extensions may register named views but do not own the physical display. They request presentation from the display manager using priority/lifetime metadata. This prevents unrelated extensions from fighting for the screen.

## Isolation

Before v1, the project should decide the exact process/container isolation strategy. Regardless of implementation, extensions must communicate through documented APIs and must not rely on importing private core internals.

## Bundled extensions

Clock, weather, timer, and system-status features should be implemented as normal extensions in `totem-base-extensions`, even if the default installation bundles them. This keeps the core honest and gives SDK developers real reference implementations.
