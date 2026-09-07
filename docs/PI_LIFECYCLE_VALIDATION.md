# Raspberry Pi readiness and lifecycle validation

The Pi service can report `active` before the Totem HTTP listener has bound. Treating the first sub-second `/health` miss as a release failure creates a startup race, so Pi install and validation use a bounded readiness contract instead.

## Readiness contract

`deploy/pi/readiness.mjs` polls `/health` with bounded exponential backoff. Defaults are deliberately conservative for a Pi:

- total readiness window: 15 seconds;
- first retry delay: 150 ms;
- maximum retry delay: 1.5 seconds;
- individual HTTP request timeout: 2 seconds.

A connection refusal, timeout, non-2xx response, or process still starting is retryable only inside that window. When the window expires, validation fails closed and reports the final observed response/error.

The defaults can be overridden for diagnostics with `TOTEM_READY_TIMEOUT_MS`, `TOTEM_READY_INITIAL_DELAY_MS`, `TOTEM_READY_MAX_DELAY_MS`, and `TOTEM_READY_REQUEST_TIMEOUT_MS`. Increasing the window should be a diagnostic choice, not a way to hide a persistently unhealthy service.

## Install behavior

`deploy/pi/install.sh` now restarts `totem.service` and runs:

```bash
node /opt/totem/current/deploy/pi/lifecycle-check.mjs --ready-only
```

The installer therefore returns success only after core reaches `/health` inside the bounded readiness window. A service that remains unhealthy still makes the install fail.

## One-command lifecycle validation

After installation, use:

```bash
sudo node /opt/totem/current/deploy/pi/lifecycle-check.mjs --restart
```

The command performs:

1. bounded core readiness;
2. durable `/api/tasks` read;
3. current `/api/operator/capabilities` probe (the canonical display/security/operator capability surface);
4. the existing detailed Pi self-test;
5. `systemctl restart totem.service`;
6. bounded readiness after restart;
7. a second durable task-store read.

Use `--json` for machine-readable evidence. Omit `--restart` for a non-mutating readiness/current-state validation. `pnpm validate:pi` invokes the same validator from a checkout.

The detailed `deploy/pi/self-test.mjs` remains useful for storage, release, service, extension/theme/provider, speech, and thermal diagnostics. The lifecycle validator supplies the startup synchronization and probes the current operator capability endpoint so old optional display/security status routes are not required to prove current management capability.

## CI coverage

The readiness algorithm is host-independent and covered by deterministic Node tests for delayed startup, bounded timeout, and transient connection refusal. Root `pnpm test` runs these deployment helper tests in addition to the normal Vitest suite.
