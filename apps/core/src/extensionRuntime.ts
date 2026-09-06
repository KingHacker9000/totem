import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DiscoveredPackageV0 } from "./discovery.js";
import type {
  ExtensionSecretProvider,
  ExtensionSettingsStore,
} from "./extensionServices.js";

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

export interface ExtensionRuntimeServices {
  settings?: ExtensionSettingsStore;
  secrets?: ExtensionSecretProvider;
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

export class ExtensionSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionSettingsError";
  }
}

export class ExtensionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionSecretError";
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

function settingDefinitions(
  value: unknown,
): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return {};
  const definitions: Record<string, Record<string, unknown>> = {};
  for (const [key, definition] of Object.entries(value)) {
    if (isRecord(definition)) definitions[key] = definition;
  }
  return definitions;
}

function validateSettingValue(
  extensionId: string,
  key: string,
  definition: Record<string, unknown>,
  value: unknown,
): void {
  const type = definition.type;
  const valid =
    (type === "string" && typeof value === "string") ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "integer" && typeof value === "number" && Number.isInteger(value));
  if (!valid) {
    throw new ExtensionSettingsError(
      `Setting '${extensionId}.${key}' must be of type '${String(type)}'`,
    );
  }
  if (Array.isArray(definition.enum) && !definition.enum.includes(value)) {
    throw new ExtensionSettingsError(
      `Setting '${extensionId}.${key}' is not one of its allowed values`,
    );
  }
}

async function readPhase2Manifest(
  candidate: DiscoveredPackageV0,
): Promise<Record<string, unknown>> {
  const raw = await readFile(
    resolve(candidate.path, "totem-extension.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

/**
 * Security boundary for extension-owned runtime capabilities.
 *
 * A manifest only requests authority. Effective grants are supplied separately,
 * making revocation possible without rewriting package metadata. Secret values
 * are intentionally absent from snapshots and are resolved only through the
 * permission-gated secret broker.
 */
export class ExtensionRuntime {
  readonly #records = new Map<
    string,
    ExtensionRuntimeRecord & { manifest: Record<string, unknown> }
  >();
  readonly #services: ExtensionRuntimeServices;

  constructor(
    packages: readonly DiscoveredPackageV0[],
    grants: Readonly<Record<string, readonly string[]>> = {},
    manifests: Readonly<Record<string, Record<string, unknown>>> = {},
    services: ExtensionRuntimeServices = {},
  ) {
    this.#services = services;
    for (const candidate of packages) {
      if (
        candidate.type !== "extension" ||
        candidate.id === undefined ||
        candidate.state === "invalid"
      ) {
        continue;
      }
      const manifest = (manifests[candidate.id] ??
        candidate.manifest ??
        {}) as unknown as Phase2Manifest;
      const requested = stringList(manifest.permissions);
      const granted = new Set(grants[candidate.id] ?? []);
      const effective = requested.filter((permission) =>
        granted.has(permission),
      );
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
          candidate.manifest ??
          {}) as unknown as Record<string, unknown>,
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
    services: ExtensionRuntimeServices = {},
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
    return new ExtensionRuntime(packages, grants, manifests, services);
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

  markReady(extensionId: string): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    if (!record.enabled) {
      throw new Error(`Extension '${extensionId}' is disabled`);
    }
    record.state = "ready";
    return this.#public(record);
  }

  markRunning(extensionId: string): ExtensionRuntimeRecord {
    const record = this.#require(extensionId);
    if (!record.enabled) {
      throw new Error(`Extension '${extensionId}' is disabled`);
    }
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

  async getSettings(extensionId: string): Promise<Record<string, unknown>> {
    const record = this.#require(extensionId);
    const definitions = settingDefinitions(record.settings);
    const values = this.#services.settings
      ? await this.#services.settings.get(extensionId)
      : {};
    const resolved: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(definitions)) {
      if (Object.hasOwn(values, key)) {
        validateSettingValue(extensionId, key, definition, values[key]);
        resolved[key] = structuredClone(values[key]);
      } else if (Object.hasOwn(definition, "default")) {
        validateSettingValue(extensionId, key, definition, definition.default);
        resolved[key] = structuredClone(definition.default);
      }
    }
    return resolved;
  }

  async setSetting(
    extensionId: string,
    key: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    const record = this.#require(extensionId);
    const definitions = settingDefinitions(record.settings);
    const definition = definitions[key];
    if (!definition) {
      throw new ExtensionSettingsError(
        `Extension '${extensionId}' does not declare setting '${key}'`,
      );
    }
    validateSettingValue(extensionId, key, definition, value);
    if (!this.#services.settings) {
      throw new ExtensionSettingsError("Extension settings storage is unavailable");
    }
    await this.#services.settings.set(extensionId, key, value);
    return this.getSettings(extensionId);
  }

  async resolveSecret(extensionId: string, secretId: string): Promise<string> {
    const record = this.#require(extensionId);
    if (!record.secretRefs.some((secret) => secret.id === secretId)) {
      throw new ExtensionSecretError(
        `Extension '${extensionId}' does not declare secret '${secretId}'`,
      );
    }
    this.assertPermission(extensionId, `secrets.read:${secretId}`);
    const value = await this.#services.secrets?.get(extensionId, secretId);
    if (value === undefined) {
      throw new ExtensionSecretError(
        `Secret '${secretId}' is not configured for extension '${extensionId}'`,
      );
    }
    return value;
  }

  displayContributions(extensionId: string): Array<Record<string, unknown>> {
    this.assertPermission(extensionId, "display.present");
    const record = this.#require(extensionId);
    return records(record.contributions.display).map((entry) =>
      structuredClone(entry),
    );
  }

  mcpRegistrations(extensionId: string): Array<Record<string, unknown>> {
    this.assertPermission(extensionId, "mcp.register");
    return this.#require(extensionId).mcp.map((entry) => structuredClone(entry));
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
