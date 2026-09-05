# Phase 1 extension and theme discovery contract

This document defines the **minimal Phase 1 discovery and validation seam** for Totem extensions and themes. It is intentionally smaller than the eventual public SDK/registry contracts.

The goal is to let the Phase 1 core prove that packages can be discovered, validated, enabled/disabled, and surfaced to the dashboard without prematurely freezing manifest v1.

## Non-goals

Phase 1 does **not** freeze:

- the final extension manifest schema;
- the final theme manifest schema;
- the complete permission vocabulary;
- marketplace/registry publishing rules;
- signatures/trust chains;
- dependency resolution between third-party packages;
- automatic remote installation/update behavior;
- stable public SDK compatibility guarantees.

The public SDK repositories remain authoritative for those future contracts once they reach v1.

## Discovery roots

The core accepts configurable local discovery roots for extensions and themes.

Recommended development defaults are directories under the configured Totem data directory:

```text
<dataDir>/extensions/
<dataDir>/themes/
```

A deployment may point those roots elsewhere. Pi/HDD paths must be configuration choices, never hard-coded assumptions.

The Phase 1 scanner treats each immediate child directory of a discovery root as one candidate package. Recursive nested package discovery is out of scope.

Example:

```text
<dataDir>/extensions/
├── clock/
│   └── totem-extension.json
├── weather/
│   └── totem-extension.json
└── broken-example/
    └── totem-extension.json

<dataDir>/themes/
├── default/
│   └── totem-theme.json
└── minimal/
    └── totem-theme.json
```

JSON is the Phase 1 stub serialization because it is simple to validate without committing the final SDK to JSON. The eventual SDK may introduce generated schemas, richer tooling, or another authoring format while preserving equivalent semantics.

## Package identity

Both package types require only these common fields in Phase 1:

```ts
interface PackageIdentityV0 {
  schema: string;
  id: string;
  name: string;
  version: string;
}
```

Rules:

- `id` is the stable machine identifier and must be unique within its package type.
- `id` should use lowercase ASCII letters, digits, and hyphens (`^[a-z0-9][a-z0-9-]*$`).
- `name` is human-readable and may change without changing identity.
- `version` must be a valid semantic-version string.
- Duplicate ids are validation errors; the core must not silently choose one candidate.

## Extension stub manifest

Phase 1 extension candidates use:

```json
{
  "schema": "totem.extension/v0",
  "id": "clock",
  "name": "Clock",
  "version": "0.1.0",
  "enabledByDefault": true,
  "entrypoint": "./backend/index.js",
  "capabilities": ["display", "background-jobs"]
}
```

Minimum contract:

```ts
interface ExtensionManifestV0 extends PackageIdentityV0 {
  schema: "totem.extension/v0";
  enabledByDefault?: boolean;
  entrypoint?: string;
  capabilities?: string[];
}
```

### Extension capability declarations

`capabilities` is intentionally a **coarse declaration list**, not the final permission system. It tells Phase 1 tooling what broad kinds of behavior an extension intends to contribute.

Examples may include:

```text
display
dashboard
agent-tools
mcp
background-jobs
network
secrets
system
```

The list is informative/validation-oriented in Phase 1. It must not be treated as blanket authorization. Later permission work will define granular requested/granted capabilities.

Unknown capability strings should be retained for diagnostics but marked unsupported rather than crashing discovery.

## Theme stub manifest

Phase 1 theme candidates use:

```json
{
  "schema": "totem.theme/v0",
  "id": "default",
  "name": "Totem Default",
  "version": "0.1.0",
  "enabledByDefault": true,
  "assetsRoot": "./assets"
}
```

Minimum contract:

```ts
interface ThemeManifestV0 extends PackageIdentityV0 {
  schema: "totem.theme/v0";
  enabledByDefault?: boolean;
  assetsRoot?: string;
}
```

### Hard security boundary

A Phase 1 theme manifest **must not contain capability/permission requests**.

Fields such as the following are invalid on a theme stub and must cause that candidate to fail validation:

```text
permissions
capabilities
mcp
agentTools
shell
network
secrets
system
```

Themes may describe identity/presentation assets later, but they cannot use the theme loader as a privilege channel. Capability-bearing behavior belongs to extensions.

## Enabled/disabled state

Discovery state and user enablement are separate concepts.

The core should expose each candidate with a state similar to:

```ts
type PackageLoadState =
  | "discovered"
  | "invalid"
  | "enabled"
  | "disabled";

interface DiscoveredPackageV0 {
  type: "extension" | "theme";
  id?: string;
  path: string;
  state: PackageLoadState;
  manifest?: unknown;
  errors: Array<{
    code: string;
    message: string;
    field?: string;
  }>;
}
```

Rules:

- A package may be discovered but disabled.
- `enabledByDefault` applies only when there is no persisted explicit user choice.
- An explicit user enable/disable choice wins over `enabledByDefault` on later boots.
- Invalid candidates can never become enabled.
- Disabling a package does not delete it.
- Phase 1 may persist package enablement using the same data directory/config persistence layer as other core settings.

## Validation and failure isolation

Package discovery must be fail-soft.

A malformed package must **not** prevent Totem core from starting and must not stop other valid packages from being discovered.

For every candidate, the scanner should independently report errors such as:

```text
manifest_missing
manifest_unreadable
manifest_json_invalid
schema_unsupported
id_invalid
id_duplicate
version_invalid
entrypoint_missing
theme_privilege_field_forbidden
```

Error messages should be useful enough for dashboard/developer tooling to show the candidate path and reason.

Unexpected I/O errors at one candidate should be captured as candidate errors where possible. Failure of the entire discovery root itself (for example, permission denied) should be surfaced as a core health/degraded-state diagnostic rather than crashing without context.

## Default and fallback theme

Totem must always have a safe presentation path when a display is present.

Phase 1 rules:

1. The core has a built-in, generic **fallback presentation** that does not depend on any external theme package.
2. If a configured active theme is valid and enabled, it is selected.
3. Otherwise, if an enabled discovered theme with id `default` exists and validates, select it.
4. Otherwise, use the built-in fallback presentation.
5. A malformed/missing third-party theme never prevents core boot.

The built-in fallback is intentionally minimal and copyright-clean. It exists for recovery/safe-mode behavior and is not a substitute for `totem-base-themes` as the normal public theme collection.

## Query surface

Phase 1 core should make discovery status queryable without exposing loader internals. A later task may use an HTTP shape equivalent to:

```text
GET /api/extensions
GET /api/themes
```

Each response should include stable identity where available, path/source, enabled state, validation state, and diagnostics. Dashboard clients observe this state; they do not own package lifetime.

Mutation endpoints for enable/disable may be added by the implementation task, but remote installation/registry operations are out of scope for Phase 1.

## Source precedence

If multiple discovery roots are configured, they are scanned in explicit configuration order, but duplicate ids remain an error in Phase 1. The loader must not silently shadow one package with another because that would make behavior depend on filesystem ordering.

Bundled/reference packages may be materialized into or registered as an explicit configured discovery source later. The discovery contract should not special-case service names such as clock/weather/Spotify.

## Implementation guidance for T114

T114 should implement only enough machinery to prove this contract:

- configurable local roots;
- immediate-child directory scanning;
- `totem-extension.json` / `totem-theme.json` parsing;
- identity/version/schema validation;
- forbidden privilege fields on themes;
- fail-soft diagnostics;
- enabled/disabled state;
- built-in theme fallback selection;
- queryable discovered-package snapshots.

Do **not** expand T114 into the full extension SDK, theme SDK, registry, permission broker, process isolation, or hot-reload system.

## Versioning

These schema identifiers are explicitly pre-v1:

```text
totem.extension/v0
totem.theme/v0
```

Breaking changes are permitted while Phase 1 is under development. The public SDK v1 will supersede this stub contract and must document migration from any persisted v0 package state that still matters.
