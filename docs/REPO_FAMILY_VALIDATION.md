# Public repository family validation

Totem's release closeout uses `release/repo-family-validation.json` as the machine-readable declaration of the public repository family and each repository's credential-free clean-checkout validation entrypoints.

The declaration intentionally includes the generic public hardware repository and intentionally excludes the private Portal theme/hardware repositories. Every sibling public repository also carries an exact 40-character commit `revision`; exact-head validation consumes those revisions rather than whatever `main` happens to contain when CI is rerun.

## Modes

From a Totem checkout:

```bash
pnpm release:repos:check
```

Validates the local manifest shape and checks that its public repository set exactly matches `release/public-repositories.json`. Every sibling entry must declare a full immutable commit revision.

```bash
pnpm release:repos:check:remote
```

Verifies the declared metadata and Node contract at the pinned sibling revisions, then separately compares each sibling's current default-ref head with the declared revision. A newer or otherwise different `main` is reported as remote drift; it is never silently substituted into the bytes covered by exact-head evidence. This mode is credential-free and is suitable for hosted CI drift detection.

```bash
pnpm release:repos:validate
```

Creates fresh temporary checkouts and runs the declared install/check/build sequence for every public repository. Sibling repositories are fetched by their exact declared commit and `HEAD` is verified before commands run. The Totem repository itself is re-fetched at the current checkout's exact commit, so pull-request validation does not accidentally test the default branch instead of the PR source revision. This is the release-closeout clean-checkout gate used by T914. Add `-- --keep` when diagnosing a failed repository to preserve the temporary checkout root.

The full execution intentionally follows each repository's current authoritative toolchain rather than pretending all repositories are Node packages. `totem-hardware` runs the synthetic measurement/CAD validation path only; it does not assert measured fit or physical success. `totem-base-themes` is content-only on `main`, so its clean-checkout gate is repository/path presence plus Totem integration validation rather than an invented package-manager step.

## Updating the contract

When a public sibling repository changes in a way that the release/CI validation should consume, update its `revision` in `release/repo-family-validation.json` deliberately in the same integration change. Do not repoint exact-head checks implicitly to a mutable branch. The remote drift gate is the signal that a sibling has moved; review that change first, then advance the declared revision intentionally.

When a public repository, runtime floor, package script, or validation entrypoint changes, update `release/repo-family-validation.json` in the same change. The local manifest gate rejects disagreement with `release/public-repositories.json`; the exact validation rejects missing/unresolvable revisions and checkout identity mismatches.

Do not add private Portal repositories to either public manifest. Do not weaken the measured hardware chain: this validation only proves that generic hardware tooling can execute from a clean public checkout, not that real components fit or that T909/T910/T912 are complete.
