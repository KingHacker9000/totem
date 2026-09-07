#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const POLICY_SCHEMA = "totem.release-dependency-advisory-policy/v1";
const SEVERITY = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["medium", 2],
  ["high", 3],
  ["critical", 4],
]);

function severityRank(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (!SEVERITY.has(normalized)) {
    throw new Error(`Unknown advisory severity: ${value}`);
  }
  return SEVERITY.get(normalized);
}

function isoDay(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be an ISO date (YYYY-MM-DD).`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} is not a valid date.`);
  }
  return parsed;
}

export function validatePolicy(policy) {
  if (!policy || policy.schema !== POLICY_SCHEMA) {
    throw new Error(`Expected policy schema ${POLICY_SCHEMA}.`);
  }
  severityRank(policy.minimumSeverity);
  if (!Array.isArray(policy.exceptions)) {
    throw new Error("Policy exceptions must be an array.");
  }

  const seen = new Set();
  for (const entry of policy.exceptions) {
    for (const field of [
      "advisoryId",
      "package",
      "rationale",
      "compensatingControl",
      "expiresOn",
    ]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        throw new Error(`Exception ${field} must be a non-empty string.`);
      }
    }
    isoDay(entry.expiresOn, `Exception ${entry.advisoryId} expiresOn`);
    const key = `${entry.advisoryId}\u0000${entry.package}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate advisory exception: ${entry.advisoryId} for ${entry.package}.`,
      );
    }
    seen.add(key);
  }
  return policy;
}

function advisoryId(value) {
  const url = String(value?.url ?? "");
  const ghsa = url.match(/GHSA-[0-9A-Za-z-]+/i)?.[0];
  if (ghsa) return ghsa.toUpperCase();
  if (value?.source !== undefined && value?.source !== null) {
    return String(value.source);
  }
  if (value?.id !== undefined && value?.id !== null) return String(value.id);
  return url || String(value?.title ?? "unknown-advisory");
}

export function normalizeAudit(raw) {
  const advisories = [];

  if (raw?.vulnerabilities && typeof raw.vulnerabilities === "object") {
    for (const [packageName, vulnerability] of Object.entries(
      raw.vulnerabilities,
    )) {
      const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
      const concrete = via.filter(
        (entry) => entry && typeof entry === "object",
      );
      if (concrete.length === 0 && vulnerability?.severity) {
        advisories.push({
          advisoryId: `package:${packageName}`,
          package: packageName,
          severity: String(vulnerability.severity).toLowerCase(),
          title: "Package vulnerability",
          url: null,
        });
      }
      for (const entry of concrete) {
        advisories.push({
          advisoryId: advisoryId(entry),
          package: packageName,
          severity: String(
            entry.severity ?? vulnerability.severity ?? "",
          ).toLowerCase(),
          title: String(entry.title ?? "Package vulnerability"),
          url: typeof entry.url === "string" ? entry.url : null,
        });
      }
    }
  } else if (raw?.advisories && typeof raw.advisories === "object") {
    for (const [key, entry] of Object.entries(raw.advisories)) {
      advisories.push({
        advisoryId: String(entry?.github_advisory_id ?? entry?.id ?? key),
        package: String(entry?.module_name ?? entry?.moduleName ?? "unknown"),
        severity: String(entry?.severity ?? "").toLowerCase(),
        title: String(entry?.title ?? "Package vulnerability"),
        url: typeof entry?.url === "string" ? entry.url : null,
      });
    }
  }

  const unique = new Map();
  for (const item of advisories) {
    severityRank(item.severity);
    unique.set(`${item.advisoryId}\u0000${item.package}`, item);
  }
  return [...unique.values()].sort((a, b) =>
    `${a.advisoryId}\u0000${a.package}`.localeCompare(
      `${b.advisoryId}\u0000${b.package}`,
    ),
  );
}

export function evaluateAudit({ audit, policy, now = new Date() }) {
  validatePolicy(policy);
  const threshold = severityRank(policy.minimumSeverity);
  const currentDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const relevant = normalizeAudit(audit).filter(
    (item) => severityRank(item.severity) >= threshold,
  );
  const accepted = [];
  const actionable = [];

  for (const item of relevant) {
    const exception = policy.exceptions.find(
      (candidate) =>
        candidate.advisoryId === item.advisoryId &&
        candidate.package === item.package,
    );
    if (!exception) {
      actionable.push({ ...item, reason: "no-exception" });
      continue;
    }
    if (
      isoDay(
        exception.expiresOn,
        `Exception ${exception.advisoryId} expiresOn`,
      ) < currentDay
    ) {
      actionable.push({
        ...item,
        reason: `exception-expired:${exception.expiresOn}`,
      });
      continue;
    }
    accepted.push({ ...item, exception });
  }

  return { relevant, accepted, actionable };
}

function runLiveAudit(rootDir) {
  const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error(
      `pnpm audit produced no JSON output${result.stderr ? `: ${result.stderr.trim()}` : "."}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Unable to parse pnpm audit JSON: ${error.message}`);
  }
  if (result.status !== 0 && normalizeAudit(parsed).length === 0) {
    throw new Error(
      `pnpm audit failed without parseable advisories${result.stderr ? `: ${result.stderr.trim()}` : "."}`,
    );
  }
  return parsed;
}

function parseArgs(argv) {
  let policyPath = "release/dependency-advisory-policy.json";
  let auditJsonPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--policy") policyPath = argv[++index];
    else if (arg === "--audit-json") auditJsonPath = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { policyPath, auditJsonPath };
}

async function main() {
  const rootDir = process.cwd();
  const { policyPath, auditJsonPath } = parseArgs(process.argv.slice(2));
  const policy = JSON.parse(
    await readFile(resolve(rootDir, policyPath), "utf8"),
  );
  const audit = auditJsonPath
    ? JSON.parse(await readFile(resolve(rootDir, auditJsonPath), "utf8"))
    : runLiveAudit(rootDir);
  const result = evaluateAudit({ audit, policy });

  console.log(
    JSON.stringify(
      {
        schema: "totem.release-dependency-advisory-audit/v1",
        scope: "pnpm production dependency graph (--prod)",
        minimumSeverity: policy.minimumSeverity,
        relevantCount: result.relevant.length,
        acceptedExceptionCount: result.accepted.length,
        actionableCount: result.actionable.length,
        actionable: result.actionable,
      },
      null,
      2,
    ),
  );

  if (result.actionable.length > 0) process.exitCode = 1;
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
