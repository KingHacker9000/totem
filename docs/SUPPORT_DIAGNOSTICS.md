# Support diagnostics

Totem can generate a small machine-readable support bundle for remote triage without copying application logs, durable user data, provider payloads, environment values, or private Portal content.

```bash
pnpm support:diagnostics -- --output ./totem-support.json
```

The output uses schema `totem.support-diagnostics/v1`. When `--output` is supplied the file is created with owner-only mode (`0600`) on platforms that honor POSIX file modes.

## What is included

The bundle is allowlist-only. It contains:

- Totem package version, Git revision when available, and a dirty-worktree boolean;
- Node/platform/architecture plus coarse CPU and memory/resource information;
- the release configuration **shape**: declared variable names, scopes/classes, whether each declared variable is present, counts of unknown `TOTEM_*` variables and credential-like ambient variables, but never their values;
- an allowlisted `systemd` service state when available;
- a bounded `/health` probe containing only reachability, HTTP status, and the exact `status: "ok"` signal.

The bundle intentionally does **not** include logs, request/provider payloads, task history, SQLite/durable state, file contents, environment values, absolute data/model paths, backup contents, or private Portal assets. Use the dedicated backup/recovery workflow for state recovery rather than attaching state to a support report.

## Privacy contract

The generator uses three layers of protection:

1. data is assembled from an explicit allowlist rather than collecting broadly and trying to clean it afterward;
2. credential-like environment variables are represented only by aggregate counts and declared configuration uses presence booleans, never values;
3. generation fails if a known secret-valued environment variable appears in the serialized bundle or if a private-path marker is detected.

Representative credential fixtures and a deliberate leak case are exercised by `scripts/support-diagnostics.node-test.mjs`. Surfaced command errors are reduced to allowlisted status values or passed through token-shaped string redaction.

## Service endpoint

By default the health probe targets `TOTEM_BASE_URL`, or `http://127.0.0.1:<TOTEM_PORT>` when it is unset. To probe a different local endpoint without changing Totem configuration:

```bash
pnpm support:diagnostics -- --base-url http://127.0.0.1:3000 --output ./totem-support.json
```

The supplied URL itself is not written to the bundle.

## Before sharing

The generated bundle is designed to be safe to attach to a public issue, but operators should still inspect any support artifact before publishing it. Totem cannot prove that future operating-system metadata is non-sensitive; new fields must stay allowlisted and are expected to extend the privacy tests before they are added.
