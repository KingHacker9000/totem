# ADR 0009: Privileged operations are brokered and auditable

**Status:** Accepted

## Context

Totem is intended to perform real system administration and may eventually need sudo/root privileges, but handing unrestricted root access to every agent/extension creates an unnecessary security boundary failure.

## Decision

Privileged host operations flow through explicit permissions/policies and an auditable broker where practical. Agent providers and extensions run with narrower defaults and request elevated operations intentionally.

## Consequences

- Root-capable workflows remain possible.
- Permissions can be logged, reviewed, and revoked.
- Some direct shell workflows may require a controlled escape hatch for trusted users, but the default path remains brokered.
