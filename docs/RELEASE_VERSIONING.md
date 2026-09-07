# Release versioning and repository identity

Totem's public repository family uses **independent semantic versioning**. Packages do not need to share a version number merely because they participate in one Totem application release.

While a public package is below `1.0.0`, incompatible public API changes increment the minor version, compatible features increment the minor version, and fixes increment the patch version. The root `totem` application package is private and may remain `0.0.0` until the first tagged application release is cut.

The aggregate application release-note source is the root `CHANGELOG.md`. Independently released SDKs may additionally maintain repository-local changelogs. Git tags/releases should correspond to the repository/package being released rather than implying lockstep releases across the family.

`release/public-repositories.json` is the machine-readable release identity contract. It records the public repository set, current package identities/versions, publishability, supported Node floor, and the private Portal exclusions. Run `pnpm release:metadata:check` for local contract validation and `pnpm release:metadata:check:remote` to compare package metadata on the public repositories' default branches.

The public contract intentionally excludes `totem-portal-theme` and `totem-portal-hardware`. Their names, assets, versions, and release policy are not part of the generic public Totem release contract.

## Current inventory

| Repository | Package | Version | Publishable | Node |
| --- | --- | --- | --- | --- |
| `totem` | `totem` | `0.0.0` | no (private app) | `>=22.20.0` |
| `totem-extension-sdk` | `@totem/extension-sdk` | `0.2.0` | yes | `>=22.20.0` |
| `totem-theme-sdk` | `@totem/theme-sdk` | `0.1.0` | yes | `>=22.20.0` |
| `totem-base-extensions` | `@totem/base-extensions` | `0.2.0` | no | `>=22.20.0` |
| `totem-base-themes` | theme assets only | — | no package | — |
| `totem-agent-providers` | `@totem/agent-providers` | `0.1.0` | no | `>=22.20.0` |
| `totem-registry` | `@totem/registry` | `0.1.0` | no | `>=22.20.0` |

The inventory is descriptive of the current repository family, not a license decision. Licensing remains governed by the separate owner-approval gate.
