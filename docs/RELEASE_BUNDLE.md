# Public release bundle

Totem is released as an application/deployment source bundle, not as an npm package. The bundle is a deterministic, public-only input to the existing install/build flow: consumers install dependencies from the pinned lockfile and run `pnpm build` inside the bundle.

## Build, verify, and scan

From a clean public `KingHacker9000/totem` checkout:

```bash
pnpm install --frozen-lockfile
pnpm release:bundle:build
pnpm release:bundle:verify
pnpm release:artifact:scan
```

The default output is `dist/release/totem-public`. It contains the allowlisted public source/deployment files plus `release-manifest.json`. The manifest uses schema `totem.public-release-bundle/v1`, records the exact Git revision/tree, every bundled file path, Git file mode, byte count, SHA-256 digest, and one aggregate SHA-256 digest over the ordered file set.

Identical tracked inputs at the same source revision produce identical manifest bytes and bundle file bytes. File timestamps are intentionally not part of the identity.

`release:artifact:scan` first verifies that manifest/source integrity and then scans the actual bundle directory with schema `totem.release-artifact-content-scan/v1`. It fails closed on high-confidence credential/token material, private-key blocks, developer home/workspace paths, private Portal repository identifiers outside a narrow policy-reference allowlist, source maps/source-map references, symlinks, unsupported filesystem entries, and files above the bounded per-file scan limit. Binary files are classified by NUL bytes and still receive ASCII-compatible content checks rather than being silently skipped.

A small explicit allowlist exists only for known-safe policy/documentation references to the private Portal repository names and the existing synthetic `/home/tester` unit-test fixture. New occurrences are rejected until deliberately reviewed and added. This keeps intentional boundary documentation possible without turning the privacy gate into a broad suppression list.

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

CI proves this contract on every supported OS/Node combination by building and verifying the bundle after the repository build, scanning the resulting bundle content boundary, and then attesting the completed public bundle directory with the source-to-artifact provenance check. T925/T937/T914 can therefore identify both the exact release artifact and the content-privacy evidence rather than unrelated workspace output.

The scanner is intentionally a release-boundary guard, not a general-purpose secret-scanning product. It uses high-confidence token/key signatures plus explicit private/workspace/debug checks to avoid claiming exhaustive detection of every possible credential format. Real provider credentials remain outside the release artifact and are covered by the separate release-configuration/security controls.

## Raspberry Pi consumption

The bundle contains `deploy/pi/install.sh` and all source/build inputs it expects. After extracting the bundle, run the documented Pi installation flow from that bundle directory. The installer performs a frozen pnpm install and build before switching the active release.

The bundle does not select or imply a license. License application remains a separate owner-approved release gate.
