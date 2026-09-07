# Release configuration contract

Totem's public release configuration is governed by `config/release-config.json` (`totem.release-config/v1`). The JSON file is the machine-readable inventory for every `TOTEM_*` variable referenced by public runtime, deployment, readiness, and validation code.

## Credential-free baseline

Core startup does not require provider credentials, service tokens, private Portal data, hardware measurements, or a selected public license. The default application baseline is loopback-only, uses the mock task provider, keeps STT/TTS disabled, and stores data in the platform user-data directory. The Pi example in `deploy/pi/totem.env.example` is likewise credential-free and uses safe/headless hardware-driver defaults.

CI proves this in two ways:

```sh
pnpm release:config:check
pnpm build
pnpm release:config:smoke
```

`release:config:check` verifies the contract schema, scans production source/deployment files for `TOTEM_*` environment references, rejects undeclared variables, and validates the Pi example. `release:config:smoke` removes `TOTEM_*` variables and credential-like ambient variables from its child environment, supplies only non-secret local runtime overrides (temporary data directory, loopback host, ephemeral port, production mode), starts the built core, waits for `/health`, then shuts it down.

## Variable classes

The contract classifies each variable as one of:

- `optional`: behavior tuning with a documented safe default;
- `local-state`: machine-local paths/workspaces/state locations;
- `security-policy`: explicit authority/trust configuration such as extension grants or registry trusted keys;
- `security-metadata`: declarations that are diagnostic metadata rather than authentication;
- deployment/validation settings retain the same classes while being scoped outside normal core configuration.

No contract entry is a required secret. Provider/service credentials remain opt-in external environment variables chosen by the provider or live-validation service specification. Totem does not enumerate, log, or embed their values in the public release contract.

## Validation behavior

Validate the current process environment:

```sh
pnpm release:config:validate
```

Validate an env file without sourcing it:

```sh
node scripts/release-config.mjs validate-env --env-file deploy/pi/totem.env.example
```

Validation fails non-zero for unknown `TOTEM_*` variables and malformed values covered by the contract (for example invalid ports, environments, log levels, provider selectors, thresholds, URLs, or positive-number settings). Core retains its own stricter startup parsing for runtime settings, so malformed core configuration also fails with `system.config_invalid` rather than silently coercing a release deployment.

The Pi systemd unit runs `scripts/release-config.mjs validate-env` in `ExecStartPre`, so an installed service will not start with an undocumented `TOTEM_*` knob. The installer-created `totem.env` starts from the checked credential-free example.

## Drift rule

A new public runtime/deployment `TOTEM_*` variable is not complete until it is added to `config/release-config.json` with scope, class, default, secret classification, and validation. CI scans source references and fails if code introduces a variable without the contract entry.

Ambient platform inputs (`NODE_ENV`, `LOCALAPPDATA`, and `XDG_DATA_HOME`) are recorded separately in the contract because Totem consumes them only as standard platform compatibility inputs, not as Totem release knobs.
