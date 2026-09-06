# Totem public licensing proposal

Status: **proposal only — no license has been selected yet.**

This document records the recommended public licensing policy for Totem so the final decision can be made once, then applied consistently across the public repository family. It does not itself license any repository or file.

## Recommendation

### Public software repositories: Apache License 2.0

Recommended for:

- `KingHacker9000/totem`
- `KingHacker9000/totem-extension-sdk`
- `KingHacker9000/totem-theme-sdk`
- `KingHacker9000/totem-base-extensions`
- `KingHacker9000/totem-base-themes`
- `KingHacker9000/totem-agent-providers`
- `KingHacker9000/totem-registry`

Why it fits Totem:

- permissive use, modification, distribution, and commercial use;
- an explicit contributor patent grant and patent-termination protection;
- friendly to SDK/plugin ecosystems where third-party proprietary and open-source integrations may coexist;
- widely recognized and easy to identify through SPDX as `Apache-2.0`;
- compatible with the project's goal of keeping the public core generic while allowing private/proprietary themes and integrations to remain separate works.

Main tradeoff: downstream users can make closed-source modifications and are not required to publish improvements.

### Public hardware/CAD repository: CERN-OHL-P-2.0

Recommended for `KingHacker9000/totem-hardware`.

Why it fits Totem:

- it is written specifically for hardware/design source and products made from that source;
- the permissive variant supports use, modification, manufacture, distribution, and commercial reuse without forcing downstream design changes to be published;
- it keeps the generic chassis genuinely reusable by hobbyists, integrators, and commercial builders;
- SPDX identifier: `CERN-OHL-P-2.0`.

Main tradeoff: downstream hardware improvements can remain private.

## Stronger reciprocal alternatives

If keeping improvements open is more important than maximum adoption, the closest alternatives are:

- **Software:** MPL-2.0. Its copyleft is file-level: modifications to MPL-covered files remain MPL when distributed, while larger proprietary works can still combine with them. This is substantially less restrictive than GPL-family whole-work copyleft.
- **Hardware:** CERN-OHL-W-2.0. The weakly reciprocal variant requires covered hardware design modifications to remain available under the reciprocal terms while providing a narrower boundary than the strongly reciprocal CERN-OHL-S variant.

These alternatives are reasonable, but they add obligations for downstream distributors and make the public/private integration story more complex. The default recommendation therefore remains Apache-2.0 + CERN-OHL-P-2.0.

## Private Portal repositories

The following are deliberately **not** covered by the proposed public policy:

- `KingHacker9000/totem-portal-theme`
- `KingHacker9000/totem-portal-hardware`

They may contain private/proprietary cosmetic material and must not inherit a public license merely because they consume generic Totem interfaces. Public repositories must not redistribute franchise or third-party assets that the project does not own or have permission to sublicense.

## Third-party dependency and asset policy

After a license is selected:

1. Keep dependency license obligations separate from Totem's own license. A package being depended on does not become relicensed under Totem's license.
2. Do not copy third-party source, fonts, icons, sounds, models, datasets, CAD, or other assets into a public repository unless redistribution rights and required notices are known.
3. Maintain a `THIRD_PARTY_NOTICES.md` (or equivalent generated notice artifact) whenever releases bundle or redistribute material whose license requires attribution or accompanying terms.
4. Preserve upstream copyright/license notices for vendored or modified third-party files.
5. Prefer SPDX identifiers in package metadata and, where useful, concise source headers rather than large repeated license blocks.
6. CI/release tooling should eventually flag dependencies or bundled assets with missing, unknown, or policy-incompatible licenses; it should not pretend that lockfile presence alone proves redistribution compliance.
7. Secrets, user credentials, model files downloaded under separate terms, and private Portal assets are not release artifacts unless their own terms explicitly permit redistribution.

## Contribution policy recommendation

For the initial project, use an **inbound = outbound** contribution policy: contributions are accepted under the same license that governs the repository. Avoid introducing a Contributor License Agreement unless there is a concrete later need for copyright assignment, relicensing flexibility, or institutional contributor requirements.

A lightweight Developer Certificate of Origin (`Signed-off-by`) process can be added later if provenance assurance becomes important, but it is not required merely to apply Apache-2.0 or CERN-OHL-P-2.0.

## Application plan after explicit approval

Do not perform these steps until the owner explicitly chooses the licenses.

### Software repositories

- add the exact Apache License 2.0 text as root `LICENSE`;
- set package/repository metadata to SPDX `Apache-2.0` where applicable;
- add a concise README license section/badge;
- add `NOTICE` only when there are project or bundled third-party notices that belong there;
- use short SPDX/source notices where appropriate rather than mechanically modifying every generated/configuration file;
- audit vendored/bundled material and create `THIRD_PARTY_NOTICES.md` where needed.

### Hardware repository

- add the unmodified CERN-OHL-P-2.0 text as root `LICENSE`;
- mark CAD/source documents with SPDX `CERN-OHL-P-2.0` or an appropriate concise notice where the format permits;
- state clearly which design-source directories are covered and which generated exports merely reproduce that source;
- keep third-party component CAD/data under its original license and clearly separated;
- state that private Portal cosmetic geometry is not part of the public hardware license.

## Decision requested

Recommended default:

- **Software:** Apache-2.0
- **Generic public hardware/CAD:** CERN-OHL-P-2.0
- **Private Portal repositories:** remain private/proprietary unless separately licensed later

Alternative if reciprocal sharing is preferred:

- **Software:** MPL-2.0
- **Generic public hardware/CAD:** CERN-OHL-W-2.0

This is a project policy recommendation, not legal advice. For a commercial launch or a situation involving employer/institution ownership, patents, or substantial third-party assets, legal review is appropriate.
