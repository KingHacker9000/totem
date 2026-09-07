# Release toolchain contract

Totem's supported public release path is governed by `config/release-toolchain.json` (`totem.release-toolchain/v1`). The contract deliberately separates the broad package engine floor from the exact Node versions exercised by hosted release CI.

Current contract:

- default Node for `.node-version` and `.nvmrc`: `24.18.0`;
- hosted release CI Node versions: `22.20.0` and `24.18.0`;
- package Node engine floor: `>=22.20.0`;
- pinned package manager: `pnpm@10.28.0`;
- package pnpm engine: `>=10 <11`.

Run `pnpm release:toolchain:check` to validate repository metadata and CI declarations against the contract. Hosted CI additionally runs `pnpm release:toolchain:runtime` after installation, which proves the effective Node version is one of the exact tested release versions and the executing pnpm version is the pinned version.

Source-to-artifact provenance records the effective Node/pnpm identity together with the SHA-256 identity of the toolchain contract. Verification fails if the contract or effective toolchain changes underneath an existing provenance document.

## Updating the toolchain

A toolchain update is one coordinated release change. Update `config/release-toolchain.json`, `package.json` engines/packageManager as appropriate, `.node-version`, `.nvmrc`, and the CI Node matrix together. Run the metadata validator, tests, build, release bundle checks, and provenance generation/verification before merging. Do not broaden the release CI set implicitly by changing only an engine range.

The exact CI versions are the versions for which Totem makes the hosted release-path claim. Other Node versions may satisfy the package engine expression, but they are not automatically treated as release-validated until they are added to the contract and CI matrix.

This contract is independent of physical hardware/CAD validation and does not select or imply a software or hardware license. Private Portal theme/hardware repositories are outside this public application toolchain contract.
