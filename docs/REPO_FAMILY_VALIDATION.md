# Public repository family validation

Totem's release closeout uses `release/repo-family-validation.json` as the machine-readable declaration of the public repository family and each repository's credential-free clean-checkout validation entrypoints.

The declaration intentionally includes the generic public hardware repository and intentionally excludes the private Portal theme/hardware repositories.

## Modes

From a Totem checkout:

```bash
pnpm release:repos:check
```

Validates the local manifest shape and checks that its public repository set exactly matches `release/public-repositories.json`.

```bash
pnpm release:repos:check:remote
```

Also verifies that declared metadata paths exist on each repository's default release ref and that Node repositories still expose the declared Node engine floor and package scripts. This mode is credential-free and is suitable for hosted CI drift detection.

```bash
pnpm release:repos:validate
```

Creates fresh shallow clones in a temporary directory and runs the declared install/check/build sequence for every public repository. This is the release-closeout clean-checkout gate used by T914. Add `-- --keep` when diagnosing a failed repository to preserve the temporary checkout root.

The full execution intentionally follows each repository's current authoritative toolchain rather than pretending all repositories are Node packages. `totem-hardware` runs the synthetic measurement/CAD validation path only; it does not assert measured fit or physical success. `totem-base-themes` is content-only on `main`, so its clean-checkout gate is repository/path presence plus Totem integration validation rather than an invented package-manager step.

## Updating the contract

When a public repository, runtime floor, package script, or validation entrypoint changes, update `release/repo-family-validation.json` in the same change. The local manifest gate rejects disagreement with `release/public-repositories.json`; the remote gate rejects missing declared paths and Node script/runtime drift.

Do not add private Portal repositories to either public manifest. Do not weaken the measured hardware chain: this validation only proves that generic hardware tooling can execute from a clean public checkout, not that real components fit or that T909/T910/T912 are complete.
