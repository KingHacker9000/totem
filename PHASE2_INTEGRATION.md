# Phase 2 integration validation (T207)

Core discovery now validates extension manifests with the public SDK pinned to
`916607a23a7a5905e0d675a1f451402b495ec3e1`. It preserves the validated declarations
for runtime and backend loading, rather than re-reading and trusting unvalidated
files. Invalid permissions, incompatible versions, and escaping entrypoints fail
per package. Backend error details are withheld from public diagnostics because
extension exceptions may contain resolved secrets.

The reference extension pack at `00a5b98e18f024740da417d573ea0c3c02bc355a` fixes
clock settings consumption, timer shutdown cancellation, and completion-event
serialization. The SDK is zero-dependency JavaScript with declarations; it and
the base extension pack have `npm run check` gates and no compilation/build step.

## Reproduce

Use Node 24.18.0 and pnpm 10.28.0 (the CI matrix also covers Node 22.20.0).
Clone the SDK and base extension repositories into sibling directories and
checkout the exact commits above. In the SDK run `npm run check`; in the base
extensions run `npm install` then `npm run check`. From core's repository:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm --filter @totem/core exec tsx scripts/phase2-integration.ts /absolute/path/to/totem-base-extensions /absolute/path/to/totem-extension-sdk
```

The integration script copies five real public packages into an isolated temporary
root, discovers them through the SDK-backed core loader, starts their backends,
and verifies disable/re-enable/restart, settings persistence, grant denial, MCP
registration access, and failure isolation without exposing a fixture secret.
Temporary files and backend instances are cleaned up on exit. CI runs the same
script against pinned external commits on Windows and Linux.

The checks use offline weather and fixture secrets; they do not validate live
weather providers or an external MCP process. Backend loading is in-process and
is not an OS sandbox for untrusted JavaScript. Display contributions are metadata
with permission-gated access; this gate does not add UI rendering or new product
surfaces.
