# Public release bundle

Totem is released as an application/deployment source bundle, not as an npm package. The bundle is a deterministic, public-only input to the existing install/build flow: consumers install dependencies from the pinned lockfile and run `pnpm build` inside the bundle.

## Build and verify

From a clean public `KingHacker9000/totem` checkout:

```bash
pnpm install --frozen-lockfile
pnpm release:bundle:build
pnpm release:bundle:verify
```

The default output is `dist/release/totem-public`. It contains the allowlisted public source/deployment files plus `release-manifest.json`. The manifest uses schema `totem.public-release-bundle/v1`, records the exact Git revision/tree, every bundled file path, Git file mode, byte count, SHA-256 digest, and one aggregate SHA-256 digest over the ordered file set.

Identical tracked inputs at the same source revision produce identical manifest bytes and bundle file bytes. File timestamps are intentionally not part of the identity.

## Boundary policy

The builder starts from Git-tracked files only and then applies an allowlist. Public release inputs are limited to:

- `apps/` runtime/application sources;
- `packages/` shared runtime/build packages;
- `deploy/` deployment/service/readiness material, including safe `*.env.example` templates;
- `scripts/` release/runtime support tooling;
- `docs/` public operational and release documentation;
- the root package manager, workspace, Node, TypeScript and README metadata required to reproduce/install the application.

The following are not release inputs:

- `.git`, `.github`, editor metadata and caches;
- `node_modules`, `dist`, `build`, coverage output and other generated/transient directories;
- Totem local state, logs and database files;
- local `.env*` files other than explicitly safe `.example` templates;
- private keys, credential/secret files and high-confidence embedded credential patterns;
- any path containing the private `totem-portal-theme` or `totem-portal-hardware` repository names;
- any top-level or nested file outside the explicit allowlist.

Forbidden tracked secret/state/private-Portal inputs fail the build rather than being silently shipped. Non-release development metadata outside the allowlist is deterministically excluded.

## Generated build outputs

Generated `dist/` output is deliberately excluded from the public bundle. The bundle is the reproducible source/deployment artifact: `pnpm install --frozen-lockfile` followed by `pnpm build` produces platform-relevant generated output after extraction. This matches the Raspberry Pi install model and avoids treating stale local build products as release inputs.

CI proves this contract on every supported OS/Node combination by building and verifying the bundle after the repository build. The source-to-artifact provenance check then attests the completed public bundle directory itself, so T925/T914 provenance can identify the exact release artifact rather than unrelated workspace output.

## Raspberry Pi consumption

The bundle contains `deploy/pi/install.sh` and all source/build inputs it expects. After extracting the bundle, run the documented Pi installation flow from that bundle directory. The installer performs a frozen pnpm install and build before switching the active release.

The bundle does not select or imply a license. License application remains a separate owner-approved release gate.
