# Release footprint guard

Totem treats public release size as a deployment constraint rather than an incidental property. The deterministic source/deployment bundle produced by `pnpm release:bundle:build` is checked by `pnpm release:footprint:check` against `config/release-footprint.json`.

The guard records a machine-readable `totem.release-footprint/v1` report at `dist/release/release-footprint.json` with total bytes, file count, largest file, top contributors, bundle digest linkage, configured budgets, and pass/fail status.

Current reviewable limits are:

- total bundle payload: 2,000,000 bytes;
- release-manifest file count: 500 files;
- default per-file limit: 256,000 bytes.

The limits intentionally have headroom over the current source bundle while remaining small enough to catch accidental generated assets, vendored binaries, archives, recordings, models, or other payloads that would materially affect Raspberry Pi install/update storage behavior. T915 remains the installed-release/low-disk safeguard; this guard constrains what is shipped before installation.

## Exceptions

Do not raise global limits to accommodate one legitimate large file. Add an exact path entry to `exceptions` with its own `maxBytes` and a meaningful reason. Wildcards, traversal paths, duplicate paths, and short/unexplained reasons are rejected. An exception also fails when its path disappears, forcing obsolete allowances to be removed instead of accumulating silently.

## Updating budgets

1. Build and verify the release bundle.
2. Run the footprint check and inspect `metrics.topFiles` in the generated report.
3. Determine whether growth is intentional and required for the supported runtime.
4. Prefer removing generated/unneeded content or a path-specific bounded exception over increasing a global limit.
5. If a global limit must change, update `config/release-footprint.json` in review with the concrete deployment rationale and keep meaningful regression headroom.

Typical validation:

```sh
pnpm release:bundle:build
pnpm release:bundle:verify
pnpm release:footprint:check
```

Hosted CI runs this sequence on the public release artifact. Physical prototype validation, licensing approval, and measured CAD remain separate gates.
