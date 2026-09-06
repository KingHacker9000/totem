# Extension manifest v0

This document is the normative Phase 2 contract for `totem.extension/v0`. It supersedes the Phase 1 extension stub in `DISCOVERY.md`. Implementations and the public extension SDK MUST use these semantics for v0. The serialization remains JSON for v0.

Normative words MUST, MUST NOT, SHOULD, and MAY are used in their usual requirements sense.

## Goals and security model

An extension manifest describes identity, compatibility, executable entrypoints, requested permissions, event access, and optional contribution/settings/secrets/MCP declarations. A manifest is a request, not authority: declaring a permission never grants it. Core MUST enforce the effective granted permission set at every privileged boundary and MUST fail closed for undeclared or ungranted access.

Themes are a separate package type and MUST NOT request extension permissions, capabilities, MCP registration, agent tools, shell/network/filesystem/system access, or secrets. A package needing any of those is an extension.

## Manifest shape

```ts
interface ExtensionManifestV0 {
  schema: "totem.extension/v0";
  id: string;
  name: string;
  version: string;
  compatibility: {
    totem: string;
    sdk: string;
  };
  enabledByDefault?: boolean;
  entrypoints?: {
    backend?: string;
  };
  lifecycle?: {
    start?: "on-enable" | "on-demand";
  };
  permissions?: string[];
  events?: {
    publish?: string[];
    subscribe?: string[];
  };
  contributions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  secrets?: Array<{ id: string; required?: boolean }>;
  mcp?: Array<Record<string, unknown>>;
}
```

`contributions`, `settings`, `secrets`, and `mcp` are reserved declaration surfaces. Their detailed Phase 2 shapes are owned by the dedicated contributions/settings/secrets/MCP contract. Until that contract is finalized, validators MUST preserve these fields but MUST NOT infer privileges from them. Privileged behavior still requires an explicit permission from this document.

## Identity and versioning

- `schema`, `id`, `name`, `version`, and `compatibility` are required.
- `schema` MUST equal `totem.extension/v0`.
- `id` MUST match `^[a-z0-9][a-z0-9-]*$` and is immutable package identity.
- `name` MUST be a non-empty human-readable string.
- `version` MUST be valid SemVer.
- `compatibility.totem` and `compatibility.sdk` MUST be non-empty SemVer ranges. The loader MUST reject an extension when the running Totem or SDK contract version does not satisfy its declared range.
- Duplicate extension IDs are errors; discovery MUST NOT silently choose one.

## Entrypoints and lifecycle

`entrypoints.backend`, when present, MUST be a relative package-local path. Absolute paths and paths escaping the package root are invalid. Existence/executability is checked during load. No backend entrypoint is required for declarative/UI/MCP-only extensions.

`lifecycle.start` defaults to `on-enable`. `on-enable` requests backend startup when the extension becomes enabled; `on-demand` permits the runtime to defer startup until an owned contribution/tool requires it. Disable/stop MUST revoke runtime access before or while terminating extension work; lifecycle metadata never grants a permission.

## Permission vocabulary

Permissions are exact, case-sensitive strings. Duplicates are invalid. Unknown permission names MUST fail manifest validation in v0; this prevents misspellings from becoming silently ineffective security declarations. An omitted `permissions` field is equivalent to `[]`.

Initial v0 vocabulary:

| Permission | Allows |
| --- | --- |
| `network.internet` | outbound network access beyond the local/private network |
| `network.local` | access to local/private network endpoints |
| `filesystem.read` | brokered reads outside extension-owned package/config data |
| `filesystem.write` | brokered writes outside extension-owned package/config data |
| `shell.user` | execute commands as the Totem service user |
| `system.service` | inspect/control explicitly brokered OS services |
| `system.package_install` | request package installation through a privileged broker |
| `system.root` | explicitly brokered root/administrator operations |
| `display.present` | submit display presentation requests to the display manager |
| `audio.play` | submit audio playback requests |
| `secrets.read:<id>` | receive the value of the named configured secret through the secret broker |
| `mcp.register` | register declared MCP servers/connectors with the agent broker |
| `agent.tools.register` | expose declared tools to compatible agent providers |
| `tasks.create` | create Totem tasks through the task API/broker |
| `tasks.interrupt` | request interruption of Totem tasks through the task API/broker |

Rules:

- `secrets.read:<id>` is the only parameterized v0 permission. `<id>` MUST match the extension ID token grammar (`^[a-z0-9][a-z0-9-]*$`). Wildcards such as `secrets.read:*` are forbidden.
- Permission implication is deliberately minimal. In particular `network.internet` does not imply `network.local`, filesystem read does not imply write, and `system.root` does not implicitly satisfy any other permission check. An extension requests every capability it uses.
- Core-owned data that is exposed by a documented unprivileged read API does not require a filesystem permission merely because core stores it on disk.
- Extension-owned package files and private configuration storage MAY be provided as sandbox primitives without `filesystem.*`; access outside those roots requires the relevant brokered permission.
- Requested and granted permissions MUST remain separately observable. Revocation takes effect without editing the manifest.

## Events

`events.publish` and `events.subscribe` contain normalized event type strings. Each value MUST match `^[a-z0-9][a-z0-9_.-]*$`, be unique within its list, and be declared before use.

An extension owns the namespace `extension.<extension-id>.*` and MAY publish types in that namespace when listed in `events.publish`. Publishing core-owned namespaces such as `task.*`, `agent.*`, `display.*`, `core.*`, or another extension's namespace is forbidden unless a future contract explicitly delegates that authority.

Subscriptions are allowlists, not permissions. A subscription declaration does not bypass authorization or data-redaction rules on an event. `*` and other wildcard subscriptions are forbidden in v0; every subscribed type is explicit.

## Validation and forward compatibility

Validation is fail-soft per package: an invalid extension MUST NOT prevent core from discovering or running other valid packages.

For v0:

- unknown top-level fields SHOULD be preserved for diagnostics/round-tripping and SHOULD produce an `unknown_field` warning, not a fatal error;
- unknown fields inside security-sensitive structures (`compatibility`, `entrypoints`, `lifecycle`, `events`, permission strings) MUST be rejected;
- unknown permission strings are fatal;
- malformed reserved declaration surfaces are fatal once their dedicated Phase 2 contract defines their shapes;
- unsupported schema IDs are fatal for that candidate;
- the runtime MUST never interpret an unknown field as authority.

This policy allows additive metadata without weakening the security boundary. A future breaking contract uses a new schema identifier rather than silently changing v0 semantics.

Recommended stable diagnostic codes include `schema_unsupported`, `id_invalid`, `version_invalid`, `compatibility_invalid`, `compatibility_unsatisfied`, `entrypoint_invalid`, `permission_unknown`, `permission_duplicate`, `event_type_invalid`, `event_namespace_forbidden`, and `unknown_field`.

## Valid example

```json
{
  "schema": "totem.extension/v0",
  "id": "weather",
  "name": "Weather",
  "version": "0.2.0",
  "compatibility": {
    "totem": ">=0.2.0 <0.3.0",
    "sdk": ">=0.2.0 <0.3.0"
  },
  "enabledByDefault": true,
  "entrypoints": { "backend": "./backend/index.js" },
  "lifecycle": { "start": "on-enable" },
  "permissions": ["network.internet", "display.present"],
  "events": {
    "publish": ["extension.weather.updated"],
    "subscribe": ["core.status"]
  }
}
```

## Rejected examples

Unknown or blanket permission:

```json
{
  "schema": "totem.extension/v0",
  "id": "bad-weather",
  "name": "Bad Weather",
  "version": "0.2.0",
  "compatibility": { "totem": ">=0.2.0 <0.3.0", "sdk": ">=0.2.0 <0.3.0" },
  "permissions": ["network", "secrets.read:*"]
}
```

The manifest is rejected because neither `network` nor wildcard secret access is a valid v0 permission.

Package-root escape:

```json
{
  "schema": "totem.extension/v0",
  "id": "escape",
  "name": "Escape",
  "version": "0.2.0",
  "compatibility": { "totem": ">=0.2.0 <0.3.0", "sdk": ">=0.2.0 <0.3.0" },
  "entrypoints": { "backend": "../../outside.js" }
}
```

The backend path escapes the package root and is invalid.

Forged core event:

```json
{
  "schema": "totem.extension/v0",
  "id": "spoof",
  "name": "Spoof",
  "version": "0.2.0",
  "compatibility": { "totem": ">=0.2.0 <0.3.0", "sdk": ">=0.2.0 <0.3.0" },
  "events": { "publish": ["task.succeeded"] }
}
```

The extension does not own the `task.*` namespace and the manifest is rejected.

## Phase 1 migration

Phase 1 manifests already use the `totem.extension/v0` schema identifier but were explicitly a discovery stub. Phase 2 therefore performs a one-time semantic tightening:

1. Keep `schema`, `id`, `name`, `version`, and `enabledByDefault`.
2. Replace string `entrypoint` with `entrypoints.backend`.
3. Add required `compatibility.totem` and `compatibility.sdk` ranges.
4. Remove coarse `capabilities`. Map actual behavior to the least-privilege `permissions` above; do not mechanically map broad labels such as `network` or `system`.
5. Add explicit event publish/subscribe declarations when the extension uses the event bus.
6. Move contribution/settings/secrets/MCP metadata into their reserved Phase 2 declaration surfaces as those contracts are finalized.

The Phase 2 loader/SDK SHOULD emit a targeted `phase1_stub_manifest` migration diagnostic when it sees the old `entrypoint` or `capabilities` fields. It MUST NOT treat Phase 1 `capabilities` as authorization.

The Phase 1 `clock` fixture can migrate without privileged permissions unless its eventual UI implementation submits display presentation requests, in which case it requests `display.present`.

## Relationship to themes

`totem.theme/v0` remains a presentation-only package contract. Theme validation MUST reject `permissions`, `capabilities`, `mcp`, `agentTools`, `shell`, `network`, `secrets`, `system`, or equivalent privilege-bearing fields. Extension permission vocabulary MUST never be accepted by the theme loader.
