import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  permissions?: unknown;
  events?: unknown;
  contributions?: unknown;
  settings?: unknown;
  secrets?: unknown;
  mcp?: unknown;
}

interface RuntimeSource {
  candidate: DiscoveredPackageV0;
  manifest: Record<string, unknown>;
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

async function readPhase2Manifest(
  candidate: DiscoveredPackageV0,
): Promise<Record<string, unknown>> {
  const raw = await readFile(resolve(candidate.path, "totem-extension.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

/**
 * Security boundary for extension-owned runtime capabilities.
 *
 * A manifest only requests authority. Effective grants are supplied separately,
 * making revocation possible without rewriting package metadata. Secret values
 * are intentionally absent from this runtime: it stores references only.
 */
export class ExtensionRuntime {
  readonly #records = new Map<
    string,
    ExtensionRuntimeRecord & { manifest: Record<string, unknown> }
  >();

  constructor(
    packages: readonly DiscoveredPackageV0[],
    grants: Readonly<Record<string, readonly string[]>> = {},
    manifests: Readonly<Record<string, Record<string, unknown>>> = {},
  ) {
    for (const candidate of packages) {
      if (
        candidate.type !== "extension" ||
        candidate.id === undefined ||
        candidate.state === "invalid"
      ) {
        continue;
      }
      const manifest = (manifests[candidate.id] ??
        candidate.manifest ?? {}) as unknown as Phase2Manifest;
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
        manifest: (manifests[candidate.id] ??
          candidate.manifest ?? {}) as unknown as Record<string, unknown>,
      });
    }
  }

  /**
   * Phase 1 discovery normalizes manifests to its old stub shape. Until T207
   * removes that compatibility layer, reload the package-local JSON here so the
   * Phase 2 security/runtime declarations are not silently discarded.
   */
  static async fromDiscovery(
    packages: readonly DiscoveredPackageV0[],
    grants: Readonly<Record<string, readonly string[]>> = {},
  ): Promise<ExtensionRuntime> {
    const sources = await Promise.all(
      packages
        .filter(
          (candidate) =>
            candidate.type === "extension" &&
            candidate.id !== undefined &&
            candidate.state !== "invalid",
        )
        .map(async (candidate): Promise<RuntimeSource | undefined> => {
          try {
            return { candidate, manifest: await readPhase2Manifest(candidate) };
          } catch {
            return undefined;
          }
        }),
    );
    const manifests: Record<string, Record<string, unknown>> = {};
    for (const source of sources) {
      if (source?.candidate.id) manifests[source.candidate.id] = source.manifest;
    }
    return new ExtensionRuntime(packages, grants, manifests);
  }

  list(): ExtensionRuntimeRecord[] {
    return [...this.#records.values()].map((record) => this.#public(record));
  }

  get(extensionId: string): ExtensionRuntimeRecord | undefined {
    const record = this.#records.get(extensionId);
    return record ? this.#public(record) : undefined;
  }

  setEnabled(extensionId: string, enabled: boolean): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    record.enabled = enabled;
    record.state = enabled ? "ready" : "disabled";
    return this.#public(record);
  }

  markRunning(extensionId: string): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    if (!record.enabled) throw new Error(`Extension '${extensionId}' is disabled`);
    record.state = "running";
    return this.#public(record);
  }

  markFailed(extensionId: string, error: unknown): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    record.state = "failed";
    record.diagnostics.push({
      code: "extension_runtime_failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return this.#public(record);
  }

  assertPermission(extensionId: string, permission: string): void {
    const record = this.#require(extensionId);
    if (!record.enabled || !record.grantedPermissions.includes(permission)) {
      throw new ExtensionPermissionError(extensionId, permission);
    }
  }

  canPublish(extensionId: string, eventType: string): boolean {
    const record = this.#require(extensionId);
    const manifest = record.manifest as Phase2Manifest;
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
    return this.list();
  }

  #public(
    record: ExtensionRuntimeRecord & { manifest: Record<string, unknown> },
  ): ExtensionRuntimeRecord {
    return structuredClone({
      id: record.id,
      enabled: record.enabled,
      state: record.state,
      requestedPermissions: record.requestedPermissions,
      grantedPermissions: record.grantedPermissions,
      contributions: record.contributions,
      settings: record.settings,
      secretRefs: record.secretRefs,
      mcp: record.mcp,
      diagnostics: record.diagnostics,
    });
  }

  #require(
    extensionId: string,
  ): ExtensionRuntimeRecord & { manifest: Record<string, unknown> } {
    const record = this.#records.get(extensionId);
    if (!record) throw new Error(`Unknown extension '${extensionId}'`);
    return record;
  }
}
