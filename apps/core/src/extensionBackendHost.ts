import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DiscoveredPackageV0 } from "./discovery.js";
import {
  ExtensionPermissionError,
  type ExtensionRuntime,
} from "./extensionRuntime.js";

interface BackendManifest {
  entrypoints?: { backend?: unknown };
  lifecycle?: { start?: unknown };
}

interface BackendInstance {
  start?: () => unknown | Promise<unknown>;
  stop?: () => unknown | Promise<unknown>;
}

type BackendFactory = (context: {
  settings: Record<string, unknown>;
  secrets: { get(secretId: string): Promise<string> };
}) => unknown | Promise<unknown>;

interface LoadedBackend {
  extensionId: string;
  instance: BackendInstance;
}

export interface ExtensionBackendHostDiagnostic {
  extensionId: string;
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackendInstance(value: unknown): value is BackendInstance {
  if (!isRecord(value)) return false;
  return (
    (value.start === undefined || typeof value.start === "function") &&
    (value.stop === undefined || typeof value.stop === "function")
  );
}

function selectFactory(
  module: Record<string, unknown>,
): BackendFactory | undefined {
  if (typeof module.default === "function")
    return module.default as BackendFactory;
  if (typeof module.createExtension === "function") {
    return module.createExtension as BackendFactory;
  }
  const factories = Object.entries(module).filter(
    ([name, value]) =>
      /^create[A-Z].*Extension$/.test(name) && typeof value === "function",
  );
  return factories.length === 1
    ? (factories[0]?.[1] as BackendFactory)
    : undefined;
}

async function loadManifest(
  candidate: DiscoveredPackageV0,
): Promise<BackendManifest> {
  const raw = await readFile(
    resolve(candidate.path, "totem-extension.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? (parsed as BackendManifest) : {};
}

function resolveBackendPath(
  candidate: DiscoveredPackageV0,
  entrypoint: string,
): string {
  if (isAbsolute(entrypoint))
    throw new Error("Backend entrypoint must be package-local");
  const absolute = resolve(candidate.path, entrypoint);
  const rel = relative(candidate.path, absolute);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  ) {
    throw new Error("Backend entrypoint escapes the extension package root");
  }
  return absolute;
}

/**
 * Loads extension backends behind the runtime's grant/lifecycle boundary.
 * A backend is never imported until every permission it requested is granted.
 * Failures are isolated to the extension and recorded through ExtensionRuntime.
 */
export class ExtensionBackendHost {
  readonly #runtime: ExtensionRuntime;
  readonly #candidates = new Map<string, DiscoveredPackageV0>();
  readonly #loaded = new Map<string, LoadedBackend>();
  readonly #diagnostics: ExtensionBackendHostDiagnostic[] = [];

  constructor(
    runtime: ExtensionRuntime,
    packages: readonly DiscoveredPackageV0[],
  ) {
    this.#runtime = runtime;
    for (const candidate of packages) {
      if (
        candidate.type === "extension" &&
        candidate.id &&
        candidate.state !== "invalid"
      ) {
        this.#candidates.set(candidate.id, candidate);
      }
    }
  }

  diagnostics(): ExtensionBackendHostDiagnostic[] {
    return structuredClone(this.#diagnostics);
  }

  async startEnabled(): Promise<void> {
    for (const extensionId of this.#candidates.keys()) {
      const record = this.#runtime.get(extensionId);
      if (!record?.enabled) continue;
      const manifest = await loadManifest(this.#requireCandidate(extensionId));
      if (manifest.lifecycle?.start === "on-demand") continue;
      await this.start(extensionId);
    }
  }

  async start(extensionId: string): Promise<void> {
    const record = this.#runtime.get(extensionId);
    if (!record) throw new Error(`Unknown extension '${extensionId}'`);
    if (!record.enabled)
      throw new Error(`Extension '${extensionId}' is disabled`);
    if (this.#loaded.has(extensionId)) return;

    try {
      for (const permission of record.requestedPermissions) {
        this.#runtime.assertPermission(extensionId, permission);
      }
      const candidate = this.#requireCandidate(extensionId);
      const manifest = await loadManifest(candidate);
      const entrypoint = manifest.entrypoints?.backend;
      if (entrypoint === undefined) {
        this.#runtime.markRunning(extensionId);
        return;
      }
      if (typeof entrypoint !== "string" || entrypoint.trim() === "") {
        throw new Error("Backend entrypoint must be a non-empty string");
      }
      const backendPath = resolveBackendPath(candidate, entrypoint);
      const imported: unknown = await import(pathToFileURL(backendPath).href);
      if (!isRecord(imported))
        throw new Error("Backend module did not export an object");
      const factory = selectFactory(imported);
      if (!factory) {
        throw new Error(
          "Backend module must export default/createExtension or one create*Extension factory",
        );
      }
      const created = await factory({
        settings: await this.#runtime.getSettings(extensionId),
        secrets: {
          get: (secretId) => this.#runtime.resolveSecret(extensionId, secretId),
        },
      });
      if (!isBackendInstance(created)) {
        throw new Error(
          "Backend factory must return an object with optional start/stop methods",
        );
      }
      await created.start?.();
      this.#loaded.set(extensionId, { extensionId, instance: created });
      this.#runtime.markRunning(extensionId);
    } catch (error) {
      this.#runtime.markFailed(extensionId, error);
      this.#diagnostics.push({
        extensionId,
        code:
          error instanceof ExtensionPermissionError
            ? "extension_permission_denied"
            : "extension_backend_start_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(extensionId: string): Promise<void> {
    const loaded = this.#loaded.get(extensionId);
    if (!loaded) return;
    this.#loaded.delete(extensionId);
    try {
      await loaded.instance.stop?.();
      if (this.#runtime.get(extensionId)?.enabled)
        this.#runtime.markReady(extensionId);
    } catch (error) {
      this.#runtime.markFailed(extensionId, error);
      this.#diagnostics.push({
        extensionId,
        code: "extension_backend_stop_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<void> {
    if (!enabled) {
      this.#runtime.setEnabled(extensionId, false);
      await this.stop(extensionId);
      return;
    }
    this.#runtime.setEnabled(extensionId, true);
    const manifest = await loadManifest(this.#requireCandidate(extensionId));
    if (manifest.lifecycle?.start !== "on-demand")
      await this.start(extensionId);
  }

  async stopAll(): Promise<void> {
    for (const extensionId of [...this.#loaded.keys()])
      await this.stop(extensionId);
  }

  #requireCandidate(extensionId: string): DiscoveredPackageV0 {
    const candidate = this.#candidates.get(extensionId);
    if (!candidate) throw new Error(`Unknown extension '${extensionId}'`);
    return candidate;
  }
}
