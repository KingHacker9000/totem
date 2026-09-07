# Release provenance

Totem's public release provenance gate records an exact source revision and deterministic artifact digests without choosing or implying a license policy. It is intended for final T914 release closeout and for any public deployment artifact produced from `KingHacker9000/totem`.

## What is attested

The `totem.release-provenance/v1` document records:

- the canonical public repository slug and normalized `origin` URL;
- exact Git `HEAD` revision and tree object;
- root package identity, package manager and engine constraints;
- SHA-256 identities for `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`;
- the declared build profile and command;
- deterministic SHA-256 records for one or more file/directory artifacts;
- the explicit exclusion of the private Portal theme and hardware repositories.

Directory digests are based on a sorted list of relative file paths, byte sizes, and per-file SHA-256 values. Symlinks are rejected so an artifact cannot escape the public checkout through filesystem indirection.

## Generate and verify

Run from a clean public Totem checkout after producing the release artifact:

```bash
pnpm release:provenance:generate -- \
  --output .release/totem-provenance.json \
  --artifact apps/core/dist \
  --artifact apps/dashboard/dist \
  --build-command "pnpm build" \
  --profile production

pnpm release:provenance:verify -- \
  --output .release/totem-provenance.json
```

The output path must remain inside the public Totem repository. The generator refuses dirty tracked/staged source and unexpected non-ignored untracked inputs. Build outputs that are intentionally ignored by Git remain valid artifact inputs.

Verification fails if the checkout revision/tree changes, workspace or lockfile identity changes, an artifact changes, the public repository identity changes, the boundary declaration is stale, or any recorded artifact no longer matches its digest.

## Public/private boundary

Public provenance is deliberately scoped to `KingHacker9000/totem`. Artifact paths containing `totem-portal-theme` or `totem-portal-hardware` are rejected, and artifact realpaths must remain inside this checkout. Private Portal releases require a separate private pipeline and must never be folded into the public attestation document.

## T914 closeout handoff

For the final readiness gate:

1. start from the exact public source revision intended for release;
2. install with the frozen lockfile and run the documented production build;
3. generate the final application/deployment artifact (T926 may provide the canonical deterministic bundle);
4. generate provenance against that artifact;
5. run provenance verification in the same clean checkout;
6. archive the provenance JSON next to the release artifact and T924 third-party manifest;
7. record the source revision and artifact/provenance digests in the final release evidence.

T925 does not select a software or hardware license. T913 remains the sole owner-decision gate for that policy.