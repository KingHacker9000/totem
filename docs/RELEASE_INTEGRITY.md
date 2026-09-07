# Release artifact integrity verification

Totem's public release bundle carries `release-manifest.json`, but a consumer should not rely only on metadata stored inside the artifact being checked. `scripts/release-integrity.mjs` therefore produces a separate deterministic checksum document that can travel alongside the bundle and be verified without a Git checkout, network access, credentials, or private Portal repositories.

## Producer flow

From a clean public Totem checkout:

```bash
pnpm release:bundle:build
node scripts/release-integrity.mjs generate
node scripts/release-integrity.mjs verify
```

The default outputs are:

- bundle: `dist/release/totem-public/`
- detached integrity document: `dist/release/totem-public.integrity.json`

The integrity document records the source revision/tree and T926 release-bundle digest from the embedded release manifest, then records SHA-256 and byte length for every regular file in the bundle, including `release-manifest.json` itself. Entries are sorted and contain only relative public paths.

## Consumer/offline verification

Keep the detached integrity document outside the extracted bundle and run the verifier from the shipped script:

```bash
node scripts/release-integrity.mjs verify \
  --bundle . \
  --manifest ../totem-public.integrity.json
```

Verification fails closed when a file is missing, added, or modified; when the manifest contains duplicate, absolute, traversal, malformed, or private-Portal paths; when a symlink/special file is present; or when detached metadata disagrees with the embedded release source/bundle identity.

## Trust boundary

This is an integrity mechanism, not a signature or identity authority. The detached JSON must itself be obtained through a channel the consumer trusts (for example, an authenticated GitHub release page). T941 does not add signing keys, key management, or a license decision. It also does not replace T925 source-to-artifact provenance, T936 clean-install execution, T937 privacy scanning, T938 SBOM generation, or T939 advisory freshness checks.

The verifier intentionally uses only Node.js built-ins so it can run offline before dependency installation. Final archive path/type/mode portability remains the separate T940 gate after T936 finalizes the archive/install boundary.
