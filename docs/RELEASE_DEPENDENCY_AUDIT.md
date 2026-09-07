# Release dependency advisory audit

Totem treats known vulnerabilities in shipped/runtime JavaScript dependencies as a release gate rather than an ad-hoc local check.

## Command

```bash
pnpm release:dependencies:audit
```

The command invokes `pnpm audit --prod --json`, so the audited dependency graph is the production dependency closure rather than development-only tooling. This is intentionally aligned with the runtime/shipped candidate boundary used by the third-party release manifest. Private Portal repositories and operator-supplied external CLIs/models are outside this package-manager audit boundary.

The hosted CI runs the live advisory check once on Linux with Node 22.20.0. Unit tests exercise policy behavior from fixed synthetic audit JSON so pass/fail semantics do not depend on a vulnerability happening to exist at test time.

## Severity policy

`release/dependency-advisory-policy.json` is machine validated. The current release threshold is `high`: high and critical advisories fail the release audit by default. Lower-severity findings remain visible to the package-manager advisory source but do not fail this gate.

## Exceptions

Exceptions are deliberately narrow. Each entry must identify all of:

- exact advisory ID;
- exact package name;
- rationale;
- compensating control;
- ISO `YYYY-MM-DD` expiry/review date.

An exception applies only to the exact advisory/package pair. Expired exceptions fail closed. Blanket package, severity, or wildcard exceptions are unsupported.

Example shape:

```json
{
  "advisoryId": "GHSA-xxxx-yyyy-zzzz",
  "package": "example-package",
  "rationale": "Why immediate remediation is temporarily impractical.",
  "compensatingControl": "Concrete control that bounds exposure until remediation.",
  "expiresOn": "2026-10-01"
}
```

Do not add an exception merely to make CI green. Prefer upgrading/removing the affected dependency. Any temporary exception should be reviewed before its expiry and deleted when the advisory is remediated.

## Freshness and network limitations

The live audit depends on the package registry/advisory service being reachable and reflects the advisory data available at execution time. A network or registry failure is not treated as a clean result; malformed or missing audit JSON fails the check. This means a green historical CI run is evidence for that run, not a permanent statement that no future advisory will apply.

The package-manager audit does not cover vulnerabilities in operator-supplied binaries, OS packages, firmware, models, or private Portal assets. Those remain separate operational/supply-chain concerns.

## Remediation workflow

When CI reports an actionable advisory, identify the affected production path, upgrade or remove the dependency where possible, regenerate/verify the third-party manifest and release artifact, and rerun CI. If a temporary exception is unavoidable, document the exact advisory/package pair, bounded rationale, compensating control, and expiry date in the policy file.
