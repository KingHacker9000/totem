# Release readiness audit

Status: license-independent preparation for T920. This document does **not** select or grant a Totem license. License application remains gated on the explicit owner decision tracked by T913.

## Public repository matrix

| Repository | Release/publish posture | Current metadata/build state | Release-prep action |
| --- | --- | --- | --- |
| `totem` | Application/workspace; not an npm package | root `package.json` is `private: true`, pins pnpm 10.28.0 and Node >=22.20.0, and exposes `check`/`build`; Windows/Linux CI and Pi lifecycle validation exist | Keep private package flag. Release artifacts should be application/deployment bundles, not npm publication. |
| `totem-extension-sdk` | Public SDK intended for package consumption | `@totem/extension-sdk` 0.2.0 exposes `src` + examples and Node >=22; an accidental `license: MIT` contradicted the unresolved project license | Remove premature MIT metadata now. Before first package publication add repository/homepage/bugs metadata and the owner-selected SPDX license in T913. |
| `totem-theme-sdk` | Public SDK intended for package consumption | `@totem/theme-sdk` 0.1.0 is `private: false`, publishes `dist` + README, builds/tests with TypeScript, Node >=22.20.0 | Before first package publication add description, repository/homepage/bugs metadata, package-manager/publish policy as desired, and the owner-selected SPDX license in T913. |
| `totem-base-extensions` | Public source/first-party extension pack; aggregate npm package is not intended for publication | `@totem/base-extensions` 0.2.0 is `private: true`, validates all first-party backends and pins the public extension SDK by commit; an accidental `license: MIT` contradicted the unresolved project license | Remove premature MIT metadata now. Keep aggregate package private unless release architecture explicitly changes. Individual extension distribution should flow through the Totem registry/package format. |
| `totem-base-themes` | Public source/reference theme pack | No root npm package; repository contains `default`, `minimal`, and `retro-terminal` theme packages/manifests plus README | No npm metadata required today. Registry/distribution metadata should be generated from theme manifests when registry release packaging is frozen. |
| `totem-agent-providers` | Public source/provider implementation; aggregate npm publication disabled | `@totem/agent-providers` 0.1.0 is `private: true`, compiles/tests with TypeScript/Vitest, Node >=22.20.0 | Keep private unless provider packages become independently published. Add repository metadata if later published. |
| `totem-registry` | Public source/runtime component; aggregate npm publication disabled | `@totem/registry` 0.1.0 is `private: true`, Node >=22.20.0, check/test scripts cover registry/node protocol | Keep private unless a separately published JS library is intentionally introduced. Release as service/runtime source rather than accidental npm package. |
| `totem-hardware` | Public generic hardware/CAD source | No npm package. CAD toolchain is Python with pinned `cadquery==2.5.2` and `pytest==8.3.5`; measured-data gate is documented and CI exercises synthetic geometry | Hardware license remains T913. Generated CAD exports must retain provenance to parametric source + measured input records and must not absorb private Portal geometry. |

## Third-party notice / attribution inventory

This is an **inventory of candidates to review for redistribution notices**, not a legal conclusion that every dependency requires a notice. T913/release packaging must preserve upstream notices and include license text where the shipped form requires it.

### Totem application/workspace

Direct shipped/runtime candidates visible in package manifests include:

- Fastify (`fastify`) in the core HTTP service;
- React and React DOM (`react`, `react-dom`) in dashboard/display frontends;
- SQLite binding (`better-sqlite3`) and Kysely (`kysely`) in durable storage;
- the public Totem extension SDK when fetched by commit from GitHub.

Build/development-only candidates include TypeScript, Vitest, Biome, Vite, the React Vite plugin, TSX, and `@types/*`. These normally are not part of a production runtime artifact but remain relevant to source-distribution/build documentation.

Totem also integrates **external executables/models that are not bundled by default** and therefore must not be represented as Totem-owned assets: Codex CLI, Claude Code CLI, `whisper.cpp`/`whisper-cli`, Piper, and user-supplied speech models/voices. If future packaging starts redistributing any of these binaries/models, their exact upstream license/model terms must be added to the shipped notice inventory at that time.

### Extension/theme/provider repositories

- `totem-base-extensions` depends on `@totem/extension-sdk` by an exact Git commit. That relationship is first-party but must remain reproducible and be updated deliberately when the SDK contract advances.
- `totem-theme-sdk` and `totem-agent-providers` use TypeScript/test tooling only in the currently audited package manifests.
- Public reference themes currently contain project-authored manifest/configuration material; no vendored franchise/Portal assets were found in the public repository search.

### Hardware/CAD

- CAD tooling pins CadQuery 2.5.2 and pytest 8.3.5. They are toolchain dependencies, not Totem hardware design content; source/release instructions should preserve the pins and upstream attribution requirements where applicable.
- Vendor hardware names, datasheet links, BOM references, and interface documentation are factual integration references. Do not copy vendor artwork, CAD, firmware, or copyrighted documentation into Totem releases unless its redistribution terms are recorded.

## Public/private boundary audit

A repository-wide search for `Portal` in the public family found references whose purpose is architectural boundary documentation, release policy, tests, or explicit statements that Portal/franchise assets stay private. No public package manifest or dependency was found that imports `totem-portal-theme` or `totem-portal-hardware` as a runtime/package dependency.

The private boundary remains:

- generic extension/theme/device contracts and generic hardware chassis interfaces may be public;
- `totem-portal-theme` and `totem-portal-hardware` remain private/proprietary unless separately licensed;
- public docs may name those repositories to document the boundary, but public release artifacts must not embed their assets or geometry.

## Reproducibility and versioning findings

1. `totem` is intentionally version `0.0.0`/private as a workspace. A first public release needs one explicit application release/version source rather than assuming npm workspace versions are product versions.
2. Public SDK versions currently differ (`extension-sdk` 0.2.0, `theme-sdk` 0.1.0). This is acceptable pre-1.0; release notes must state contract versions independently rather than imply lockstep SemVer.
3. `totem-base-extensions` pins `totem-extension-sdk` to commit `916607a23a7a5905e0d675a1f451402b495ec3e1`, which is reproducible but intentionally not a registry/npm semver dependency yet.
4. Several public source repositories are `private: true` at the npm-package level. This is a useful guardrail against accidental npm publication and should not be changed merely because the GitHub repository is public.
5. `totem-base-themes` and `totem-hardware` correctly have no synthetic npm metadata. Their release format is manifest/CAD/source oriented.

## First-release checklist independent of license choice

- [x] Audit all eight public product repositories for package/publish posture.
- [x] Identify and remove premature Totem license metadata that contradicts the unresolved owner decision.
- [x] Inventory direct runtime/build/CAD dependencies that may require notice review when artifacts are bundled.
- [x] Confirm public Portal references describe/test the boundary rather than create a public runtime dependency.
- [x] Record versioning/publish inconsistencies and intended release posture.
- [x] Generate an artifact-specific third-party manifest from the exact production source-release boundary rather than treating the entire development lockfile as runtime content. See `docs/THIRD_PARTY_RELEASE_MANIFEST.md`.
- [ ] At packaging time, verify upstream license text/attribution obligations for every actually redistributed dependency/binary/model/asset.
- [ ] After explicit owner approval in T913, add the selected `LICENSE`/SPDX package metadata and any required project-level `NOTICE` artifacts consistently.
- [x] Keep private Portal repositories outside public release/license automation unless their owner explicitly chooses otherwise; the manifest generator rejects direct private-Portal package references.

## T913 handoff

After this audit, license-choice-dependent work is intentionally narrow:

1. obtain explicit owner selection between the documented license-policy options;
2. regenerate/verify `totem.third-party-release-manifest/v1` from the final release source revision;
3. inspect upstream license text/attribution obligations for every actually redistributed dependency/binary/model/asset represented by that artifact;
4. apply LICENSE/SPDX/NOTICE metadata consistently to public repos and publishable packages;
5. reconcile permanent release-license issue #7.

The generated manifest deliberately records `licenseSelection: UNRESOLVED_T913`; do not infer the owner's choice from historical `license` fields that were introduced before the licensing decision was made.
