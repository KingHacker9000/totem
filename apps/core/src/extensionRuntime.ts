import type { DiscoveredPackageV0 } from "./discovery.js";

export type ExtensionLifecycleState =
  | "disabled"
  | "ready"
  | "running"
  | "failed";

export interface ExtensionRuntimeDiagnostic {
  code: string;
  message: string;
}

export interface ExtensionRuntimeRecord {
  id: string;
  enabled: boolean;
  state: ExtensionLifecycleState;
  requestedPermissions: string[];
  grantedPermissions: string[];
  contributions: Record<string, unknown>;
  settings: Record<string, unknown>;
  secretRefs: Array<{ id: string; required: boolean }>;
  mcp: Array<Record<string, unknown>>;
  diagnostics: ExtensionRuntimeDiagnostic[];
}

export class ExtensionPermissionError extends Error {
  constructor(
    readonly extensionId: string,
    readonly permission: string,
  ) {
    super(`Extension '${extensionId}' is not granted '${permission}'`);
    this.name = "ExtensionPermissionError";
  }
}

interface Phase2Manifest {
  id?: unknown;
  permissions?: unknown;
  contributions?: unknown;
  settings?: unknown;
  secrets?: unknown;
  mcp?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function secretRefs(value: unknown): Array<{ id: string; required: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    return [{ id: entry.id, required: entry.required === true }];
  });
}

/**
 * Security boundary for extension-owned runtime capabilities.
 *
 * A manifest only requests authority. Effective grants are supplied separately,
 * making revocation possible without rewriting package metadata. This broker is
 * deliberately independent of extension process execution so every privileged
 * core surface can share the same fail-closed permission check.
 */
export class ExtensionRuntime {
  readonly #records = new Map<string, ExtensionRuntimeRecord>();
  readonly #grants: Readonly<Record<string, readonly string[]>>;

  constructor(
    packages: readonly DiscoveredPackageV0[],
    grants: Readonly<Record<string, readonly string[]>> = {},
  ) {
    this.#grants = grants;
    for (const candidate of packages) {
      if (
        candidate.type !== "extension" ||
        candidate.id === undefined ||
        candidate.state === "invalid"
      ) {
        continue;
      }
      const manifest = (candidate.manifest ?? {}) as Phase2Manifest;
      const requested = stringList(manifest.permissions);
      const granted = new Set(grants[candidate.id] ?? []);
      const effective = requested.filter((permission) => granted.has(permission));
      this.#records.set(candidate.id, {
        id: candidate.id,
        enabled: candidate.enabled,
        state: candidate.enabled ? "ready" : "disabled",
        requestedPermissions: requested,
        grantedPermissions: effective,
        contributions: isRecord(manifest.contributions)
          ? manifest.contributions
          : {},
        settings: isRecord(manifest.settings) ? manifest.settings : {},
        secretRefs: secretRefs(manifest.secrets),
        mcp: records(manifest.mcp),
        diagnostics: [],
      });
    }
  }

  list(): ExtensionRuntimeRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  get(extensionId: string): ExtensionRuntimeRecord | undefined {
    const record = this.#records.get(extensionId);
    return record ? structuredClone(record) : undefined;
  }

  setEnabled(extensionId: string, enabled: boolean): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    record.enabled = enabled;
    record.state = enabled ? "ready" : "disabled";
    return structuredClone(record);
  }

  markRunning(extensionId: string): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    if (!record.enabled) throw new Error(`Extension '${extensionId}' is disabled`);
    record.state = "running";
    return structuredClone(record);
  }

  markFailed(extensionId: string, error: unknown): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    record.state = "failed";
    record.diagnostics.push({
      code: "extension_runtime_failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return structuredClone(record);
  }

  assertPermission(extensionId: string, permission: string): void {
    const record = this.#require(extensionId);
    if (!record.enabled || !record.grantedPermissions.includes(permission)) {
      throw new ExtensionPermissionError(extensionId, permission);
    }
  }

  canPublish(extensionId: string, eventType: string): boolean {
    const record = this.#require(extensionId);
    const manifest = this.#manifest(extensionId);
    const publish = isRecord(manifest.events)
      ? stringList(manifest.events.publish)
      : [];
    return (
      record.enabled &&
      publish.includes(eventType) &&
      eventType.startsWith(`extension.${extensionId}.`)
    );
  }

  publicSnapshot(): ExtensionRuntimeRecord[] {
    // Runtime records contain references/IDs only. Secret values are never held
    // here, so this snapshot is safe for normal management/status APIs.
    return this.list();
  }

  #manifest(extensionId: string): Record<string, unknown> {
    const record = this.#records.get(extensionId);
    if (!record) return {};
    // Reconstruct only the declaration needed by runtime checks. Event
    // declarations are attached lazily by fromDiscovery below.
    return (record as ExtensionRuntimeRecord & {
      __manifest?: Record<string, unknown>;
    }).__manifest ?? {};
  }

  #require(extensionId: string): ExtensionRuntimeRecord {
    const record = this.#records.get(extensionId);
    if (!record) throw new Error(`Unknown extension '${extensionId}'`);
    return record;
  }

  static fromDiscovery(
    packages: readonly DiscoveredPackageV0[],
    grants: Readonly<Record<string, readonly string[]>> = {},
  ): ExtensionRuntime {
    const runtime = new ExtensionRuntime(packages, grants);
    for (const candidate of packages) {
      if (!candidate.id || !candidate.manifest) continue;
      const record = runtime.#records.get(candidate.id) as
        | (ExtensionRuntimeRecord & { __manifest?: Record<string, unknown> })
        | undefined;
      if (record) record.__manifest = candidate.manifest as unknown as Record<string, unknown>;
    }
    return runtime;
  }
}
