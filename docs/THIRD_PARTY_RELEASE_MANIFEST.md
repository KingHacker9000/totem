# Artifact-specific third-party release manifest

Totem release packaging generates a machine-readable third-party inventory from the exact public application source snapshot and installed pnpm dependency graph. This is intentionally separate from project-license selection: T913 still owns the Totem license decision and any final LICENSE/NOTICE application.

## What the manifest represents

`totem.third-party-release-manifest/v1` is tied to the Raspberry Pi source-release boundary implemented by `deploy/pi/install.sh`: the public Totem source tree copied into a release directory, excluding `.git`, `node_modules`, and `dist`, followed by a frozen pnpm install and build.

The manifest records:

- the exact Git source revision;
- a deterministic SHA-256 digest over the copied source snapshot;
- the pinned package manager and `pnpm-lock.yaml` SHA-256;
- third-party packages reachable from production app dependency graphs;
- packages present only in the broader development/build dependency graph;
- external executables and models that Totem integrates with but does not bundle by default;
- the explicit public/private Portal repository boundary.

The dependency sets are redistribution **candidates**, not legal conclusions. A later release step must still inspect upstream licenses/notices for what the concrete release actually redistributes.

## Generate and verify

After `pnpm install --frozen-lockfile`:

```bash
pnpm release:third-party:generate
pnpm release:third-party:verify
```

The default output is `release/third-party-manifest.json`. For CI or packaging pipelines, an alternate path can be supplied:

```bash
node scripts/third-party-manifest.mjs generate --output /tmp/totem-third-party-manifest.json
node scripts/third-party-manifest.mjs verify --output /tmp/totem-third-party-manifest.json
```

Verification recomputes the current source snapshot and dependency graph. It fails if the recorded source revision, source digest, lockfile identity, dependency classification, external-supply declarations, or release boundary differ from the current checkout.

When Git metadata is unavailable, packaging may provide the immutable source revision explicitly:

```bash
node scripts/third-party-manifest.mjs generate \
  --source-revision <full-commit-sha> \
  --output /path/to/third-party-manifest.json
```

## Runtime versus build/development classification

Runtime/bundled candidates are derived from the installed production dependency graph of the application workspaces under `apps/*`, including transitive packages and external first-party packages such as a pinned SDK checkout.

Build/development-only candidates are packages visible in the complete workspace graph that are absent from that production app graph. This avoids treating the whole development lockfile as shipped runtime content.

Workspace-internal `@totem/*` packages are not emitted as third-party dependencies. External packages remain listed even if they are published by the Totem project, because a separately sourced package can still have an independent release/attribution identity.

## External executables and models

The manifest explicitly marks the following as externally supplied and `bundled: false` unless future packaging changes that fact:

- Codex CLI;
- Claude Code CLI;
- `whisper.cpp` / `whisper-cli`;
- Piper;
- operator-supplied speech models and voices.

If a future release starts redistributing any such binary/model, this manifest contract and its packaging inputs must be updated before release so the item moves into the actual redistribution review.

## Public/private boundary

The public manifest excludes `KingHacker9000/totem-portal-theme` and `KingHacker9000/totem-portal-hardware`. Generation fails if any public workspace package manifest directly references those private repositories/packages. Private Portal packaging, if ever introduced, must use a separate private release process rather than silently entering this public manifest.

## T913/T914 handoff

T913 consumes the generated artifact inventory only after the owner selects the project license. It then applies the chosen project LICENSE/SPDX/NOTICE policy and verifies upstream obligations for actually redistributed dependencies.

T914 should regenerate and verify this manifest from the final clean source revision as part of closeout. Passing verification demonstrates source/dependency identity consistency; it does **not** replace the owner license decision or upstream legal review.
