# Release artifact smoke validation

Totem's deterministic public bundle is validated as a deployment artifact, not only as a directory produced inside a developer checkout.

## What the smoke proves

After `pnpm release:bundle:build`, run:

```bash
node scripts/release-artifact-smoke.mjs --bundle dist/release/totem-public
```

The harness first verifies the bundle manifest without consulting Git metadata or the source checkout. It checks the manifest schema, source revision/tree shape, exact file set, per-file byte counts and SHA-256 digests, and the aggregate bundle digest.

It then copies the verified bundle into a newly created temporary directory outside the checkout, verifies it again, confirms `.git` metadata is absent, performs `pnpm install --frozen-lockfile`, builds the workspace, and runs the existing credential-free startup readiness smoke from that isolated artifact. `TOTEM_*` and credential-like ambient environment variables are removed before subprocess execution.

A passing result emits `totem.release-artifact-smoke/v1` evidence and demonstrates that the public release source/deployment bundle contains the tracked material needed for a clean frozen install, production build, and credential-free core startup without depending on ignored files, local state, the original checkout's `node_modules`, or private Portal repositories.

## Relationship to provenance

This smoke is intentionally complementary to `scripts/release-provenance.mjs`. Release provenance binds the generated artifact to the exact clean public Git revision/tree and workspace inputs while the source checkout is available. The portable artifact smoke then verifies the manifest and hashes from the artifact itself before executing it in isolation.

For release closeout, run both paths against the same freshly generated bundle:

```bash
pnpm release:bundle:build
pnpm release:bundle:verify
node scripts/release-provenance.mjs generate \
  --output totem-provenance.json \
  --artifact dist/release/totem-public \
  --build-command "pnpm build && pnpm release:bundle:build" \
  --profile production
node scripts/release-provenance.mjs verify --output totem-provenance.json
node scripts/release-artifact-smoke.mjs --bundle dist/release/totem-public
```

## Deliberate limits

The hosted smoke does not replace the completed real-PC or real-Pi validation gates, does not exercise provider credentials, and does not claim physical display/audio/LED/CAD behavior. Physical prototype validation remains on the measured T909 -> T910 -> T912 chain. Private Portal cosmetics are not part of this public artifact.