# Public workflow trust boundary

Totem's public GitHub Actions workflows are treated as an executable supply-chain boundary. The `totem.workflow-trust/v1` check in `scripts/workflow-trust.mjs` scans the public repository family and fails closed on trigger/ref patterns that can move attacker-controlled pull-request or fork code into a privileged workflow context.

## Policy

Public workflows may use ordinary `push`, `pull_request`, `workflow_dispatch`, `schedule`, and similarly non-privilege-escalating events when their job permissions remain within the separate `totem.workflow-permissions/v1` policy.

The trust validator rejects `pull_request_target`, `workflow_run`, and `issue_comment` triggers. These events can execute in a base-repository or otherwise privileged context and therefore require a separately designed trust handoff rather than direct execution of public contribution code. No such exception exists in the current public Totem workflow family.

The validator also rejects `secrets: inherit` and checkout/ref expressions that directly select `github.event.pull_request.head.sha`, `github.event.pull_request.head.ref`, `github.head_ref`, or `github.event.workflow_run` head identities. Ordinary `pull_request` workflows should use the default GitHub checkout ref and the read-only token policy; fork secrets are not deliberately bridged into those jobs.

Inline `on: [...]` trigger declarations are rejected so the event boundary remains explicit and machine-auditable.

## Validation

Run the local repository check with:

```sh
pnpm release:workflow-trust:check
```

Hosted CI clones all eight public Totem repositories and passes them to the same validator alongside the immutable-action and least-privilege-permission checks. Representative unsafe trigger, ref, inherited-secret, and ambiguous-trigger fixtures live in `scripts/workflow-trust.node-test.mjs`.

Private Portal repositories are intentionally outside this generic public policy. This check does not select a project license, handle credentials, or relax the measured T909 -> T910 -> T912 physical/CAD chain.
