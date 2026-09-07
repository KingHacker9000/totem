#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadContract } from "./release-config.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");

const secretKeyPattern =
  /(token|secret|password|passwd|api[_-]?key|private[_-]?key|authorization|cookie|session|credential)/i;
const privatePathPattern =
  /(?:^|[\\/])(?:\.ssh|\.gnupg|\.aws|\.config[\\/](?:gcloud|gh)|portal(?:-theme|-hardware)?)(?:[\\/]|$)/i;

export function redactString(value) {
  if (typeof value !== "string") return value;
  let result = value;
  result = result.replace(
    /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi,
    "[REDACTED]",
  );
  result = result.replace(
    /(?:sk|pk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{12,}/gi,
    "[REDACTED]",
  );
  result = result.replace(
    /([?&](?:token|key|secret|password)=)[^&\s]+/gi,
    "$1[REDACTED]",
  );
  return result;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}

function configShape(contract, env) {
  const declared = [...contract.variables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      scope: entry.scope,
      class: entry.class,
      secret: entry.secret,
      present:
        Object.hasOwn(env, entry.name) && String(env[entry.name] ?? "") !== "",
    }));
  const declaredNames = new Set(declared.map((entry) => entry.name));
  const unknownTotem = Object.keys(env).filter(
    (name) => name.startsWith("TOTEM_") && !declaredNames.has(name),
  );
  const ambientSensitive = Object.keys(env).filter((name) =>
    secretKeyPattern.test(name),
  );
  return {
    schema: contract.schema,
    declared,
    unknown_totem_variable_count: unknownTotem.length,
    ambient_sensitive_variable_count: ambientSensitive.length,
    values_included: false,
  };
}

async function gitIdentity() {
  const result = { revision: null, dirty: null };
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
    });
    const revision = stdout.trim();
    result.revision = /^[0-9a-f]{40}$/i.test(revision) ? revision : null;
  } catch {}
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: root,
    });
    result.dirty = stdout.trim().length > 0;
  } catch {}
  return result;
}

async function serviceStatus() {
  if (process.platform !== "linux") {
    return { manager: "systemd", available: false, active: null };
  }
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "is-active",
      "totem.service",
    ]);
    const status = stdout.trim();
    const allowed = [
      "active",
      "inactive",
      "failed",
      "activating",
      "deactivating",
    ];
    return {
      manager: "systemd",
      available: true,
      active: status === "active",
      status: allowed.includes(status) ? status : "unknown",
    };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const allowed = [
      "active",
      "inactive",
      "failed",
      "activating",
      "deactivating",
    ];
    const status = allowed.includes(stdout) ? stdout : "unknown";
    return {
      manager: "systemd",
      available: stdout.length > 0,
      active: false,
      status,
    };
  }
}

async function healthProbe(baseUrl) {
  try {
    const response = await fetch(new URL("/health", baseUrl), {
      signal: AbortSignal.timeout(2000),
    });
    let status = null;
    try {
      const body = await response.json();
      if (body?.status === "ok") status = "ok";
    } catch {}
    return {
      attempted: true,
      reachable: true,
      http_status: response.status,
      status,
    };
  } catch {
    return {
      attempted: true,
      reachable: false,
      http_status: null,
      status: null,
    };
  }
}

function assertNoPrivatePaths(bundle) {
  const serialized = JSON.stringify(bundle);
  if (privatePathPattern.test(serialized)) {
    throw new Error("support diagnostics contained a private-path marker");
  }
}

export function assertNoKnownSecretValues(bundle, env) {
  const serialized = JSON.stringify(bundle);
  const leaked = [];
  for (const [name, raw] of Object.entries(env)) {
    const value = String(raw ?? "");
    if (!value || value.length < 4 || !secretKeyPattern.test(name)) continue;
    if (serialized.includes(value)) leaked.push(name);
  }
  if (leaked.length) {
    throw new Error(
      `support diagnostics leaked sensitive environment values: ${leaked.join(", ")}`,
    );
  }
}

export async function buildSupportBundle({ env = process.env, baseUrl } = {}) {
  const [contract, pkg, git, service] = await Promise.all([
    loadContract(),
    readFile(packagePath, "utf8").then(JSON.parse),
    gitIdentity(),
    serviceStatus(),
  ]);
  const configuredBase =
    baseUrl ??
    env.TOTEM_BASE_URL ??
    `http://127.0.0.1:${env.TOTEM_PORT ?? "3000"}`;
  const bundle = sortObject({
    schema: "totem.support-diagnostics/v1",
    privacy: {
      policy: "allowlist-only",
      environment_values_included: false,
      logs_included: false,
      durable_user_state_included: false,
      private_portal_content_included: false,
    },
    release: {
      package: pkg.name,
      version: pkg.version,
      git,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      total_memory_mib: Math.round(os.totalmem() / 1024 / 1024),
      free_memory_mib: Math.round(os.freemem() / 1024 / 1024),
      load_average:
        process.platform === "win32"
          ? []
          : os.loadavg().map((value) => Number(value.toFixed(2))),
    },
    configuration: configShape(contract, env),
    service,
    health: await healthProbe(configuredBase),
  });
  assertNoPrivatePaths(bundle);
  assertNoKnownSecretValues(bundle, env);
  return bundle;
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const baseIndex = args.indexOf("--base-url");
  const baseUrl = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  if (outputIndex >= 0 && !output) {
    throw new Error("--output requires a path");
  }
  if (baseIndex >= 0 && !baseUrl) {
    throw new Error("--base-url requires a URL");
  }
  const bundle = await buildSupportBundle({ baseUrl });
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (output) {
    await writeFile(path.resolve(output), text, { mode: 0o600 });
  } else {
    process.stdout.write(text);
  }
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${path.resolve(process.argv[1]).replaceAll("\\", "/")}`)
      .href
) {
  main().catch((error) => {
    console.error(
      redactString(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  });
}
