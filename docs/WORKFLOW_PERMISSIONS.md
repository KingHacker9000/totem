# Public workflow token permissions

Totem's public repository family uses an explicit least-privilege `GITHUB_TOKEN` policy for CI workflows.

## Policy

Every workflow under `.github/workflows/*.yml` or `.yaml` must declare a top-level permission block with exactly:

```yaml
permissions:
  contents: read
```

This grants checkout and read-only repository access while preventing a workflow from inheriting broader repository defaults. Public CI currently has no accepted write-capability exception. If a future workflow genuinely needs a write scope, that capability must be reviewed as a separate release-security change rather than silently widening this policy.

Repositories with no GitHub Actions workflows are valid and require no declaration.

## Enforcement

Run the local repository check with:

```bash
pnpm release:workflow-permissions:check
```

Totem's hosted CI also clones every repository in the public release family and runs `scripts/workflow-permissions.mjs` over all of them. The check fails on missing declarations, write access, unexpected scopes, duplicate top-level permission blocks, and unsupported permission syntax. Representative missing and broadened cases are covered by `scripts/workflow-permissions.node-test.mjs`.

This complements, rather than replaces, `scripts/workflow-actions.mjs`: T930 constrains external action identity to immutable commit SHAs, while this policy constrains the authority of the workflow token available to those actions and shell steps.

Private Portal repositories are deliberately outside this generic public-hardware/software policy.
