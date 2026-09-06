import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface TotemDataPaths {
  root: string;
  state: string;
  extensions: string;
  themes: string;
  logs: string;
}

export interface TotemDiscoveryConfig {
  extensionRoots: string[];
  themeRoots: string[];
  activeThemeId?: string;
}

export interface TotemConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  environment: "development" | "test" | "production";
  paths: TotemDataPaths;
  discovery: TotemDiscoveryConfig;
  /** Effective extension permission grants. Omitted means deny all. */
  extensionGrants?: Readonly<Record<string, readonly string[]>>;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Totem configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function defaultDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDir: string,
): string {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    return localAppData
      ? join(localAppData, "Totem")
      : join(homeDir, "AppData", "Local", "Totem");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return xdgDataHome
    ? join(xdgDataHome, "totem")
    : join(homeDir, ".local", "share", "totem");
}

function parsePort(raw: string | undefined, issues: string[]): number {
  if (raw === undefined || raw.trim() === "") return 3000;
  if (!/^\d+$/.test(raw.trim())) {
    issues.push("TOTEM_PORT must be an integer between 1 and 65535");
    return 3000;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    issues.push("TOTEM_PORT must be an integer between 1 and 65535");
    return 3000;
  }
  return value;
}

function parseLogLevel(raw: string | undefined, issues: string[]): LogLevel {
  const value = (raw?.trim().toLowerCase() || "info") as LogLevel;
  if (!LOG_LEVELS.includes(value)) {
    issues.push(`TOTEM_LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}`);
    return "info";
  }
  return value;
}

function parseEnvironment(
  raw: string | undefined,
  issues: string[],
): TotemConfig["environment"] {
  const value = raw?.trim().toLowerCase() || "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    issues.push("TOTEM_ENV must be development, test, or production");
    return "development";
  }
  return value;
}

function parseHost(raw: string | undefined, issues: string[]): string {
  const value = raw?.trim() || "127.0.0.1";
  if (value.length > 253 || /[\s/]/.test(value)) {
    issues.push(
      "TOTEM_HOST must be a hostname or IP address without whitespace or slashes",
    );
    return "127.0.0.1";
  }
  return value;
}

function parseDataDir(
  raw: string | undefined,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDir: string,
  issues: string[],
): string {
  const configured = raw?.trim();
  const candidate = configured || defaultDataDir(env, platform, homeDir);
  if (candidate.includes("\0")) {
    issues.push("TOTEM_DATA_DIR must not contain NUL characters");
    return resolve(defaultDataDir(env, platform, homeDir));
  }
  return resolve(candidate);
}

function parseDiscoveryRoots(
  raw: string | undefined,
  fallback: string,
  field: string,
  issues: string[],
): string[] {
  if (raw === undefined || raw.trim() === "") return [fallback];

  const roots = raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));

  if (roots.length === 0) {
    issues.push(`${field} must contain at least one path`);
    return [fallback];
  }
  if (roots.some((entry) => entry.includes("\0"))) {
    issues.push(`${field} must not contain NUL characters`);
    return [fallback];
  }
  return roots;
}

function parseActiveThemeId(
  raw: string | undefined,
  issues: string[],
): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!PACKAGE_ID_PATTERN.test(value)) {
    issues.push("TOTEM_ACTIVE_THEME must be a valid package id");
    return undefined;
  }
  return value;
}

function parseExtensionGrants(
  raw: string | undefined,
  issues: string[],
): Readonly<Record<string, readonly string[]>> | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    issues.push("TOTEM_EXTENSION_GRANTS must be a JSON object");
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    issues.push("TOTEM_EXTENSION_GRANTS must be a JSON object");
    return undefined;
  }

  const grants: Record<string, readonly string[]> = {};
  for (const [extensionId, permissions] of Object.entries(parsed)) {
    if (!PACKAGE_ID_PATTERN.test(extensionId)) {
      issues.push(
        `TOTEM_EXTENSION_GRANTS has invalid extension id '${extensionId}'`,
      );
      continue;
    }
    if (
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== "string")
    ) {
      issues.push(
        `TOTEM_EXTENSION_GRANTS['${extensionId}'] must be a string array`,
      );
      continue;
    }
    grants[extensionId] = [...new Set(permissions)];
  }
  return grants;
}

export function loadConfig(options: LoadConfigOptions = {}): TotemConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const issues: string[] = [];

  if (homeDir.trim() === "") issues.push("home directory must not be empty");

  const root = parseDataDir(env.TOTEM_DATA_DIR, env, platform, homeDir, issues);
  const paths: TotemDataPaths = {
    root,
    state: join(root, "state"),
    extensions: join(root, "extensions"),
    themes: join(root, "themes"),
    logs: join(root, "logs"),
  };
  const activeThemeId = parseActiveThemeId(env.TOTEM_ACTIVE_THEME, issues);
  const extensionGrants = parseExtensionGrants(
    env.TOTEM_EXTENSION_GRANTS,
    issues,
  );

  const config: TotemConfig = {
    host: parseHost(env.TOTEM_HOST, issues),
    port: parsePort(env.TOTEM_PORT, issues),
    logLevel: parseLogLevel(env.TOTEM_LOG_LEVEL, issues),
    environment: parseEnvironment(env.TOTEM_ENV ?? env.NODE_ENV, issues),
    paths,
    discovery: {
      extensionRoots: parseDiscoveryRoots(
        env.TOTEM_EXTENSION_ROOTS,
        paths.extensions,
        "TOTEM_EXTENSION_ROOTS",
        issues,
      ),
      themeRoots: parseDiscoveryRoots(
        env.TOTEM_THEME_ROOTS,
        paths.themes,
        "TOTEM_THEME_ROOTS",
        issues,
      ),
      ...(activeThemeId === undefined ? {} : { activeThemeId }),
    },
    ...(extensionGrants === undefined ? {} : { extensionGrants }),
  };

  if (issues.length > 0) throw new ConfigError(issues);
  return config;
}
