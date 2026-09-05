# Security model

Totem is intentionally agentic and may eventually control shells, services, repositories, other devices, and privileged host operations. Security therefore has to be part of the architecture rather than added after the fact.

## Principles

1. **Least privilege by default.** Extensions and agent sessions receive only declared/granted capabilities.
2. **Separate identity from capability.** Themes cannot gain system or service permissions.
3. **Broker secrets.** Extensions reference named secrets instead of reading arbitrary credential files.
4. **Audit meaningful actions.** Privileged or externally visible actions should appear in a human-readable activity log.
5. **Explicit destructive actions.** High-risk operations require stronger policy/confirmation than low-risk reads.
6. **Contain agent workspaces.** External agent CLIs start in explicit workspaces, not unrestricted host roots.
7. **Revocation must work.** Permissions, extensions, providers, and credentials must be disableable without reinstalling Totem.

## Capability examples

A future permission model may distinguish:

```text
network.internet
network.local
filesystem.workspace.read
filesystem.workspace.write
filesystem.host.read
filesystem.host.write
shell.user
system.service
system.package_install
system.root
secrets.read:<id>
display.present
audio.play
mcp.register
remote_device.control
```

The exact vocabulary will be finalized with the SDK.

## Risk tiers

Totem should support policy tiers approximately like:

- **ambient/read-only**: weather, time, system readings
- **normal action**: play/pause music, create a timer
- **system mutation**: restart a service, modify files outside a workspace
- **privileged/destructive**: package install, root changes, deletion, security configuration

The user may customize trust policy per extension/provider, but dangerous defaults should remain conservative.

## Sudo

Totem may support sudo/root operations because the intended assistant must be capable of real system administration. The architecture should expose privileged operations through an auditable broker/policy layer instead of simply launching every agent process as root.

## Prompt injection

Any extension that ingests untrusted external content must treat that content as data, not authority. Tool permissions are enforced outside the model so a malicious webpage, message, MCP response, or document cannot grant itself extra privileges by instruction text alone.

## Dashboard access

During development the dashboard may bind to localhost. Remote/LAN access must later require authentication and should support secure transport/Tailscale-style private networking rather than assuming a trusted flat LAN.

## Recovery

The eventual Pi deployment should support starting the core with third-party extensions disabled so one bad extension cannot permanently brick the appliance.
