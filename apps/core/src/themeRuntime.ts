import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { discoverPackages, type DiscoveredPackageV0 } from "./discovery.js";

export interface ThemeManifestV0 {
  schema: "totem.theme/v0";
  id: string;
  name: string;
  version: string;
  compatibility?: { totem?: string };
  enabledByDefault?: boolean;
  presentation?: {
    tokens?: Record<string, string | number | boolean>;
    assets?: Record<string, string>;
    fonts?: Record<string, string>;
    scenes?: Record<string, unknown>;
    ambient?: Record<string, unknown>;
    sounds?: Record<string, string>;
    led?: Record<string, unknown>;
  };
  persona?: {
    name?: string;
    instructions?: string[];
    wakeWord?: { phrase?: string; acknowledgement?: string };
  };
  voice?: {
    provider?: string;
    model?: string;
    voice?: string;
    rate?: number;
    pitch?: number;
  };
}

export interface ThemeRuntimeSnapshot {
  activeThemeId: string | null;
  previousThemeId?: string;
  source: "persisted" | "configured" | "default" | "fallback";
  manifest: ThemeManifestV0 | null;
  packagePath: string | null;
}

export class ThemeRuntimeError extends Error {
  constructor(
    readonly code: "theme_not_found" | "theme_invalid" | "theme_state_invalid",
    message: string,
  ) {
    super(message);
    this.name = "ThemeRuntimeError";
  }
}

interface ThemeStateFile {
  activeThemeId: string;
  previousThemeId?: string;
}

export interface ThemeRuntimeOptions {
  themeRoots: string[];
  stateFile: string;
  configuredThemeId?: string;
}

const FORBIDDEN_KEYS = new Set([
  "permissions",
  "capabilities",
  "mcp",
  "tools",
  "network",
  "filesystem",
  "shell",
  "secrets",
  "root",
  "services",
  "agentTools",
  "system",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbidden);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbidden(child),
  );
}

function isThemeManifest(
  value: unknown,
  expectedId: string,
): value is ThemeManifestV0 {
  if (!isRecord(value) || containsForbidden(value)) return false;
  return (
    value.schema === "totem.theme/v0" &&
    value.id === expectedId &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.version === "string"
  );
}

export class ThemeRuntime {
  constructor(private readonly options: ThemeRuntimeOptions) {}

  async snapshot(): Promise<ThemeRuntimeSnapshot> {
    const { packages, state } = await this.loadStateAndPackages();
    const persisted = state?.activeThemeId
      ? packages.find((candidate) => candidate.id === state.activeThemeId)
      : undefined;
    if (persisted) {
      return this.hydrate(persisted, "persisted", state?.previousThemeId);
    }

    const configured = this.options.configuredThemeId
      ? packages.find(
          (candidate) => candidate.id === this.options.configuredThemeId,
        )
      : undefined;
    if (configured) return this.hydrate(configured, "configured");

    const fallback = packages.find((candidate) => candidate.id === "default");
    if (fallback) return this.hydrate(fallback, "default");
    return {
      activeThemeId: null,
      source: "fallback",
      manifest: null,
      packagePath: null,
    };
  }

  async list(): Promise<
    Array<{ id: string; name: string; version: string; active: boolean }>
  > {
    const current = await this.snapshot();
    const { packages } = await this.loadStateAndPackages();
    const result = [];
    for (const candidate of packages) {
      const manifest = await this.readManifest(candidate);
      result.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        active: manifest.id === current.activeThemeId,
      });
    }
    return result;
  }

  async activate(themeId: string): Promise<ThemeRuntimeSnapshot> {
    const { packages } = await this.loadStateAndPackages();
    const target = packages.find((candidate) => candidate.id === themeId);
    if (!target) {
      throw new ThemeRuntimeError(
        "theme_not_found",
        `Theme '${themeId}' is not installed and valid.`,
      );
    }
    await this.readManifest(target);
    const current = await this.snapshot();
    await this.writeState({
      activeThemeId: themeId,
      ...(current.activeThemeId && current.activeThemeId !== themeId
        ? { previousThemeId: current.activeThemeId }
        : current.previousThemeId
          ? { previousThemeId: current.previousThemeId }
          : {}),
    });
    return this.snapshot();
  }

  async rollback(): Promise<ThemeRuntimeSnapshot> {
    const { packages, state } = await this.loadStateAndPackages();
    if (!state?.previousThemeId) return this.snapshot();
    const target = packages.find(
      (candidate) => candidate.id === state.previousThemeId,
    );
    if (!target) return this.snapshot();
    await this.readManifest(target);
    await this.writeState({
      activeThemeId: state.previousThemeId,
      previousThemeId: state.activeThemeId,
    });
    return this.snapshot();
  }

  private async loadStateAndPackages(): Promise<{
    packages: DiscoveredPackageV0[];
    state?: ThemeStateFile;
  }> {
    const [discovery, state] = await Promise.all([
      discoverPackages({
        extensionRoots: [],
        themeRoots: this.options.themeRoots,
      }),
      this.readState(),
    ]);
    return {
      packages: discovery.themes.filter(
        (candidate) =>
          candidate.state !== "invalid" && candidate.id !== undefined,
      ),
      ...(state ? { state } : {}),
    };
  }

  private async hydrate(
    candidate: DiscoveredPackageV0,
    source: ThemeRuntimeSnapshot["source"],
    previousThemeId?: string,
  ): Promise<ThemeRuntimeSnapshot> {
    const manifest = await this.readManifest(candidate);
    return {
      activeThemeId: manifest.id,
      ...(previousThemeId ? { previousThemeId } : {}),
      source,
      manifest,
      packagePath: candidate.path,
    };
  }

  private async readManifest(
    candidate: DiscoveredPackageV0,
  ): Promise<ThemeManifestV0> {
    if (!candidate.id) {
      throw new ThemeRuntimeError(
        "theme_invalid",
        "Theme candidate has no id.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(join(candidate.path, "totem-theme.json"), "utf8"),
      );
    } catch (error) {
      throw new ThemeRuntimeError(
        "theme_invalid",
        `Unable to read theme '${candidate.id}': ${(error as Error).message}`,
      );
    }
    if (!isThemeManifest(parsed, candidate.id)) {
      throw new ThemeRuntimeError(
        "theme_invalid",
        `Theme '${candidate.id}' failed the full v0 privilege/identity contract.`,
      );
    }
    return parsed;
  }

  private async readState(): Promise<ThemeStateFile | undefined> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.options.stateFile, "utf8"),
      );
      if (
        !isRecord(parsed) ||
        typeof parsed.activeThemeId !== "string" ||
        (parsed.previousThemeId !== undefined &&
          typeof parsed.previousThemeId !== "string")
      ) {
        throw new Error("invalid theme state shape");
      }
      return {
        activeThemeId: parsed.activeThemeId,
        ...(typeof parsed.previousThemeId === "string"
          ? { previousThemeId: parsed.previousThemeId }
          : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new ThemeRuntimeError(
        "theme_state_invalid",
        `Unable to load persisted theme state: ${(error as Error).message}`,
      );
    }
  }

  private async writeState(state: ThemeStateFile): Promise<void> {
    await mkdir(dirname(this.options.stateFile), { recursive: true });
    const temporary = `${this.options.stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.options.stateFile);
  }
}
