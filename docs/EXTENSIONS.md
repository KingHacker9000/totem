# Extensions

Extensions add **capability** to Totem. They may expose tools to the active agent, register MCP servers, contribute display/dashboard views, run background jobs, publish events, define settings, and request access to secrets or operating-system capabilities.

Themes are not extensions. A theme changes identity and presentation; it must not silently gain service or system privileges.

## Extension package responsibilities

An extension may contain:

```text
extension/
├── totem-extension.json
├── backend/
├── display/
├── dashboard/
├── assets/
├── migrations/
└── README.md
```

The normative Phase 2 manifest and permission contract is [EXTENSION_MANIFEST_V0.md](EXTENSION_MANIFEST_V0.md). The public authoring/parser/validation API is owned by `totem-extension-sdk` and must implement that contract rather than inventing a parallel schema.

## Manifest contract

Phase 1 used a deliberately smaller discovery stub documented in [DISCOVERY.md](DISCOVERY.md). Phase 2 freezes the security-relevant semantics of `totem.extension/v0`: identity/version compatibility, entrypoints/lifecycle metadata, granular requested permissions, explicit event publication/subscription, and reserved declaration surfaces for contributions, settings, secrets, and MCP.

A manifest requests capabilities; it never grants them. Core owns the effective grant set and enforces it at privileged boundaries. Requested and granted permissions must remain separately observable and revocable.

See [EXTENSION_MANIFEST_V0.md](EXTENSION_MANIFEST_V0.md) for the complete vocabulary, validation rules, valid/rejected examples, and the migration from Phase 1 `entrypoint`/`capabilities` fields.

## MCP

MCP is a first-class extension mechanism. An extension can package or configure an MCP server and ask Totem's agent broker to expose it to compatible providers. Registration requires the manifest's `mcp.register` permission and remains subject to the dedicated contribution/settings/secrets/MCP contract.

An MCP-only extension is valid and does not require a backend entrypoint merely to be considered an extension.

## UI contributions

Extensions may register named views but do not own the physical display. They request presentation from the display manager using priority/lifetime metadata. `display.present` is required for presentation requests; declaring a UI contribution alone is not authority.

## Isolation

Before v1, the project should decide the exact process/container isolation strategy. Regardless of implementation, extensions must communicate through documented APIs and must not rely on importing private core internals. Isolation is defense in depth and does not replace permission checks.

## Theme boundary

Themes remain presentation-only packages. Theme manifests must reject extension permission/capability, MCP, agent-tool, shell, network, filesystem/system, and secret-access declarations. Privilege-bearing behavior belongs to extensions.

## Bundled extensions

Clock, weather, timer, and system-status features should be implemented as normal extensions in `totem-base-extensions`, even if the default installation bundles them. This keeps the core honest and gives SDK developers real reference implementations.
