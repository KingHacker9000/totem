import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

export interface TotemConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  environment: "development" | "test" | "production";
  paths: TotemDataPaths;
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

export function loadConfig(options: LoadConfigOptions = {}): TotemConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const issues: string[] = [];

  if (homeDir.trim() === "") issues.push("home directory must not be empty");

  const root = parseDataDir(env.TOTEM_DATA_DIR, env, platform, homeDir, issues);

  const config: TotemConfig = {
    host: parseHost(env.TOTEM_HOST, issues),
    port: parsePort(env.TOTEM_PORT, issues),
    logLevel: parseLogLevel(env.TOTEM_LOG_LEVEL, issues),
    environment: parseEnvironment(env.TOTEM_ENV ?? env.NODE_ENV, issues),
    paths: {
      root,
      state: join(root, "state"),
      extensions: join(root, "extensions"),
      themes: join(root, "themes"),
      logs: join(root, "logs"),
    },
  };

  if (issues.length > 0) throw new ConfigError(issues);
  return config;
}
