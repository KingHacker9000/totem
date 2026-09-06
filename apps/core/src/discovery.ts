import type { Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export type PackageType = "extension" | "theme";
export type PackageLoadState = "invalid" | "enabled" | "disabled";

export interface PackageDiagnostic {
  code: string;
  message: string;
  field?: string;
}

export interface ExtensionManifestV0 {
  schema: "totem.extension/v0";
  id: string;
  name: string;
  version: string;
  enabledByDefault?: boolean;
  entrypoint?: string;
  capabilities?: string[];
}

export interface ThemeManifestV0 {
  schema: "totem.theme/v0";
  id: string;
  name: string;
  version: string;
  enabledByDefault?: boolean;
  assetsRoot?: string;
}

export type PackageManifestV0 = ExtensionManifestV0 | ThemeManifestV0;

export interface DiscoveredPackageV0 {
  type: PackageType;
  id?: string;
  path: string;
  state: PackageLoadState;
  enabled: boolean;
  manifest?: PackageManifestV0;
  errors: PackageDiagnostic[];
  unsupportedCapabilities?: string[];
}

export interface DiscoveryRootDiagnostic extends PackageDiagnostic {
  type: PackageType;
  path: string;
}

export interface ThemeSelection {
  source: "configured" | "default" | "fallback";
  id: string | null;
  packagePath: string | null;
}

export interface DiscoverySnapshot {
  extensions: DiscoveredPackageV0[];
  themes: DiscoveredPackageV0[];
  rootDiagnostics: DiscoveryRootDiagnostic[];
  activeTheme: ThemeSelection;
}

export interface DiscoverPackagesOptions {
  extensionRoots: string[];
  themeRoots: string[];
  activeThemeId?: string;
  enablement?: Readonly<Record<string, boolean>>;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const THEME_PRIVILEGE_FIELDS = [
  "permissions",
  "capabilities",
  "mcp",
  "agentTools",
  "shell",
  "network",
  "secrets",
  "system",
] as const;
const SUPPORTED_EXTENSION_CAPABILITIES = new Set([
  "display",
  "dashboard",
  "agent-tools",
  "mcp",
  "background-jobs",
  "network",
  "secrets",
  "system",
]);

function packageKey(type: PackageType, id: string): string {
  return `${type}:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
  errors: PackageDiagnostic[],
): string | undefined {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({
      code: `${field}_invalid`,
      field,
      message: `${field} must be a non-empty string`,
    });
    return undefined;
  }
  return candidate;
}

function booleanField(
  value: Record<string, unknown>,
  field: string,
  errors: PackageDiagnostic[],
): boolean | undefined {
  const candidate = value[field];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "boolean") {
    errors.push({
      code: `${field}_invalid`,
      field,
      message: `${field} must be a boolean when present`,
    });
    return undefined;
  }
  return candidate;
}

function validateIdentity(
  value: Record<string, unknown>,
  expectedSchema: string,
  errors: PackageDiagnostic[],
): { id?: string; name?: string; version?: string } {
  const schema = stringField(value, "schema", errors);
  const id = stringField(value, "id", errors);
  const name = stringField(value, "name", errors);
  const version = stringField(value, "version", errors);

  if (schema !== undefined && schema !== expectedSchema) {
    errors.push({
      code: "schema_unsupported",
      field: "schema",
      message: `Expected schema ${expectedSchema}, received ${schema}`,
    });
  }
  if (id !== undefined && !ID_PATTERN.test(id)) {
    errors.push({
      code: "id_invalid",
      field: "id",
      message: "id must match ^[a-z0-9][a-z0-9-]*$",
    });
  }
  if (version !== undefined && !SEMVER_PATTERN.test(version)) {
    errors.push({
      code: "version_invalid",
      field: "version",
      message: "version must be valid semantic version syntax",
    });
  }

  return { id, name, version };
}

async function validateExtension(
  value: Record<string, unknown>,
  packagePath: string,
  errors: PackageDiagnostic[],
): Promise<ExtensionManifestV0 | undefined> {
  const identity = validateIdentity(value, "totem.extension/v0", errors);
  const enabledByDefault = booleanField(value, "enabledByDefault", errors);
  let entrypoint: string | undefined;
  let capabilities: string[] | undefined;

  if (value.entrypoint !== undefined) {
    if (
      typeof value.entrypoint !== "string" ||
      value.entrypoint.trim() === ""
    ) {
      errors.push({
        code: "entrypoint_invalid",
        field: "entrypoint",
        message: "entrypoint must be a non-empty string when present",
      });
    } else {
      entrypoint = value.entrypoint;
      try {
        await access(resolve(packagePath, entrypoint));
      } catch {
        errors.push({
          code: "entrypoint_missing",
          field: "entrypoint",
          message: `Entrypoint does not exist: ${entrypoint}`,
        });
      }
    }
  }

  if (value.capabilities !== undefined) {
    if (
      !Array.isArray(value.capabilities) ||
      value.capabilities.some((capability) => typeof capability !== "string")
    ) {
      errors.push({
        code: "capabilities_invalid",
        field: "capabilities",
        message: "capabilities must be an array of strings when present",
      });
    } else {
      capabilities = [...value.capabilities];
    }
  }

  if (
    errors.length > 0 ||
    identity.id === undefined ||
    identity.name === undefined ||
    identity.version === undefined
  ) {
    return undefined;
  }

  return {
    schema: "totem.extension/v0",
    id: identity.id,
    name: identity.name,
    version: identity.version,
    ...(enabledByDefault === undefined ? {} : { enabledByDefault }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

function validateTheme(
  value: Record<string, unknown>,
  errors: PackageDiagnostic[],
): ThemeManifestV0 | undefined {
  const identity = validateIdentity(value, "totem.theme/v0", errors);
  const enabledByDefault = booleanField(value, "enabledByDefault", errors);
  let assetsRoot: string | undefined;

  for (const field of THEME_PRIVILEGE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      errors.push({
        code: "theme_privilege_field_forbidden",
        field,
        message: `Theme manifests cannot request privileged field ${field}`,
      });
    }
  }

  if (value.assetsRoot !== undefined) {
    if (
      typeof value.assetsRoot !== "string" ||
      value.assetsRoot.trim() === ""
    ) {
      errors.push({
        code: "assetsRoot_invalid",
        field: "assetsRoot",
        message: "assetsRoot must be a non-empty string when present",
      });
    } else {
      assetsRoot = value.assetsRoot;
    }
  }

  if (
    errors.length > 0 ||
    identity.id === undefined ||
    identity.name === undefined ||
    identity.version === undefined
  ) {
    return undefined;
  }

  return {
    schema: "totem.theme/v0",
    id: identity.id,
    name: identity.name,
    version: identity.version,
    ...(enabledByDefault === undefined ? {} : { enabledByDefault }),
    ...(assetsRoot === undefined ? {} : { assetsRoot }),
  };
}

async function scanCandidate(
  type: PackageType,
  packagePath: string,
  enablement: Readonly<Record<string, boolean>>,
): Promise<DiscoveredPackageV0> {
  const filename =
    type === "extension" ? "totem-extension.json" : "totem-theme.json";
  const manifestPath = resolve(packagePath, filename);
  const errors: PackageDiagnostic[] = [];
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    errors.push({
      code: code === "ENOENT" ? "manifest_missing" : "manifest_unreadable",
      message:
        code === "ENOENT"
          ? `Missing ${filename}`
          : `Unable to read ${filename}: ${(error as Error).message}`,
    });
    return {
      type,
      path: packagePath,
      state: "invalid",
      enabled: false,
      errors,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    errors.push({
      code: "manifest_json_invalid",
      message: `Invalid JSON in ${filename}: ${(error as Error).message}`,
    });
    return {
      type,
      path: packagePath,
      state: "invalid",
      enabled: false,
      errors,
    };
  }

  if (!isRecord(parsed)) {
    errors.push({
      code: "manifest_invalid",
      message: `${filename} must contain a JSON object`,
    });
    return {
      type,
      path: packagePath,
      state: "invalid",
      enabled: false,
      errors,
    };
  }

  const id = typeof parsed.id === "string" ? parsed.id : undefined;
  const manifest =
    type === "extension"
      ? await validateExtension(parsed, packagePath, errors)
      : validateTheme(parsed, errors);

  if (manifest === undefined || errors.length > 0) {
    return {
      type,
      id,
      path: packagePath,
      state: "invalid",
      enabled: false,
      errors,
    };
  }

  const explicitEnabled = enablement[packageKey(type, manifest.id)];
  const enabled = explicitEnabled ?? manifest.enabledByDefault ?? false;
  const unsupportedCapabilities =
    type === "extension"
      ? (manifest as ExtensionManifestV0).capabilities?.filter(
          (capability) => !SUPPORTED_EXTENSION_CAPABILITIES.has(capability),
        )
      : undefined;

  return {
    type,
    id: manifest.id,
    path: packagePath,
    state: enabled ? "enabled" : "disabled",
    enabled,
    manifest,
    errors,
    ...(unsupportedCapabilities?.length ? { unsupportedCapabilities } : {}),
  };
}

async function scanRoots(
  type: PackageType,
  roots: string[],
  enablement: Readonly<Record<string, boolean>>,
): Promise<{
  packages: DiscoveredPackageV0[];
  rootDiagnostics: DiscoveryRootDiagnostic[];
}> {
  const packages: DiscoveredPackageV0[] = [];
  const rootDiagnostics: DiscoveryRootDiagnostic[] = [];

  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        rootDiagnostics.push({
          type,
          path: root,
          code: "discovery_root_unreadable",
          message: `Unable to scan discovery root: ${(error as Error).message}`,
        });
      }
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      packages.push(
        await scanCandidate(type, resolve(root, entry.name), enablement),
      );
    }
  }

  const byId = new Map<string, DiscoveredPackageV0[]>();
  for (const candidate of packages) {
    if (candidate.id === undefined) continue;
    const matches = byId.get(candidate.id) ?? [];
    matches.push(candidate);
    byId.set(candidate.id, matches);
  }

  for (const [id, matches] of byId) {
    if (matches.length < 2) continue;
    for (const candidate of matches) {
      candidate.state = "invalid";
      candidate.enabled = false;
      candidate.errors.push({
        code: "id_duplicate",
        field: "id",
        message: `Duplicate ${type} id: ${id}`,
      });
    }
  }

  return { packages, rootDiagnostics };
}

function selectTheme(
  themes: DiscoveredPackageV0[],
  activeThemeId?: string,
): ThemeSelection {
  const enabledThemes = themes.filter(
    (candidate) => candidate.state === "enabled" && candidate.id !== undefined,
  );

  if (activeThemeId !== undefined) {
    const configured = enabledThemes.find(
      (candidate) => candidate.id === activeThemeId,
    );
    if (configured !== undefined) {
      return {
        source: "configured",
        id: configured.id ?? null,
        packagePath: configured.path,
      };
    }
  }

  const defaultTheme = enabledThemes.find(
    (candidate) => candidate.id === "default",
  );
  if (defaultTheme !== undefined) {
    return {
      source: "default",
      id: defaultTheme.id ?? null,
      packagePath: defaultTheme.path,
    };
  }

  return { source: "fallback", id: null, packagePath: null };
}

export async function discoverPackages(
  options: DiscoverPackagesOptions,
): Promise<DiscoverySnapshot> {
  const enablement = options.enablement ?? {};
  const [extensions, themes] = await Promise.all([
    scanRoots("extension", options.extensionRoots, enablement),
    scanRoots("theme", options.themeRoots, enablement),
  ]);

  return {
    extensions: extensions.packages,
    themes: themes.packages,
    rootDiagnostics: [...extensions.rootDiagnostics, ...themes.rootDiagnostics],
    activeTheme: selectTheme(themes.packages, options.activeThemeId),
  };
}
