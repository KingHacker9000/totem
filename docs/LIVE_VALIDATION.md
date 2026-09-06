# Live validation harness

`pnpm validate:live` is the credential-optional bridge between deterministic CI and the consolidated real-machine burn-in. It talks to a running Totem core, probes registered real providers, starts durable provider tasks, polls their stored task state, and can optionally exercise interruption and external service credentials.

Deterministic CI remains credential-free. The live harness is intentionally **not** part of `pnpm check` because Codex/Claude authentication, local executables, network access, and third-party credentials are machine-specific.

## Prerequisites

1. Install dependencies and start Totem normally.
2. Install/authenticate whichever real provider CLIs you want to exercise. Totem currently registers Codex CLI and Claude Code CLI adapters.
3. Optionally point `TOTEM_LIVE_WORKSPACE` at a safe workspace. The harness requests read-only access by default.
4. Keep service tokens in environment variables. Never place credentials in command-line arguments or committed files.

Check the core/provider diagnostics first:

```bash
curl -s http://127.0.0.1:3000/api/providers
```

Unavailable CLIs are reported as `SKIP`; an available provider that fails its live task is `FAIL`.

## Provider smoke

Run every registered real provider:

```bash
pnpm validate:live
```

Run one provider and use a specific read-only workspace:

```bash
pnpm validate:live -- --provider codex --workspace /path/to/workspace
```

The normal smoke starts a real durable task through `/api/provider-tasks`, waits on `/api/tasks/:taskId`, and records the resulting task/session IDs in the machine-readable result. Provider resume capability is reported from the provider contract; the destructive multi-turn resume/burn-in remains in the consolidated local validation gate.

Interruption is opt-in because it deliberately cancels a live provider turn:

```bash
pnpm validate:live -- --provider codex --exercise-interrupt
```

## Opt-in service checks

External services use this format:

```text
--service 'id|https://service.example/api/me|TOKEN_ENV_NAME'
```

The harness reads the token from `TOKEN_ENV_NAME` at runtime and sends it as a Bearer token. The token value is never printed in the result. If the environment variable is absent, the capability is `SKIP`, not `FAIL`.

Example:

```bash
export GH_TOKEN='...'
pnpm validate:live -- --service 'github|https://api.github.com/user|GH_TOKEN'
```

A service endpoint that needs no authorization can omit the third field:

```bash
pnpm validate:live -- --service 'weather|https://example.test/health'
```

This generic hook is suitable for GitHub, Spotify, weather, or extension-specific health endpoints without teaching core about those services or persisting their credentials.

## Result contract

The command writes one JSON document to stdout:

```json
{
  "schema": "totem.live-validation/v1",
  "generatedAt": "2026-09-06T19:30:00.000Z",
  "counts": { "PASS": 3, "SKIP": 2, "FAIL": 0 },
  "ok": true,
  "results": [
    {
      "capability": "provider:codex:availability",
      "status": "PASS",
      "detail": "CLI available"
    }
  ]
}
```

Exit code is non-zero only when at least one capability is `FAIL` or argument parsing fails. Missing optional providers, credentials, or services are explicit `SKIP`s.

## Browser/API checklist for the consolidated burn-in

After the harness passes, the real-machine gate should also verify the human-facing integration once on the same candidate build:

- dashboard loads and reconnects after a core restart;
- display simulator renders the active scene and extension contributions;
- provider tasks stream visible progress and durable history;
- interruption is reflected in both API state and dashboard state;
- speech push-to-talk/STT/TTS paths are exercised when local models/audio hardware are configured;
- configured live extension/service credentials are smoke-tested and unconfigured ones are recorded as skipped;
- backup/log/operator surfaces are checked once their corresponding task-board lane is integrated.

Record machine/runtime versions and preserve the JSON summary with the burn-in evidence rather than converting skipped capabilities into artificial failures.
