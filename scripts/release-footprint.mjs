#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "totem.release-footprint/v1";
const BUDGET_SCHEMA = "totem.release-footprint-budget/v1";
const DEFAULT_BUNDLE = "dist/release/totem-public";
const DEFAULT_BUDGET = "config/release-footprint.json";
const DEFAULT_REPORT = "dist/release/release-footprint.json";

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export function validateBudget(raw) {
  if (raw?.schema !== BUDGET_SCHEMA) throw new Error(`unsupported footprint budget schema: ${raw?.schema}`);
  const exceptions = raw.exceptions ?? [];
  if (!Array.isArray(exceptions)) throw new Error("exceptions must be an array");
  const seen = new Set();
  for (const [index, entry] of exceptions.entries()) {
    if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.includes("*") || entry.path.includes("..") || entry.path.startsWith("/")) {
      throw new Error(`exceptions[${index}].path must be one exact safe bundle-relative path`);
    }
    if (seen.has(entry.path)) throw new Error(`duplicate footprint exception path: ${entry.path}`);
    seen.add(entry.path);
    positiveInteger(entry.maxBytes, `exceptions[${index}].maxBytes`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 12) {
      throw new Error(`exceptions[${index}].reason must explain the bounded exception`);
    }
  }
  return {
    schema: raw.schema,
    maxTotalBytes: positiveInteger(raw.maxTotalBytes, "maxTotalBytes"),
    maxFileCount: positiveInteger(raw.maxFileCount, "maxFileCount"),
    maxFileBytes: positiveInteger(raw.maxFileBytes, "maxFileBytes"),
    topContributors: positiveInteger(raw.topContributors ?? 10, "topContributors"),
    exceptions,
  };
}

export function evaluateFootprint(files, budget) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("release manifest contains no files");
  const sorted = [...files].map((entry) => {
    if (typeof entry?.path !== "string" || !entry.path || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error("release manifest contains an invalid file entry");
    }
    return { path: entry.path, bytes: entry.bytes };
  }).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const totalBytes = sorted.reduce((sum, entry) => sum + entry.bytes, 0);
  const exceptionMap = new Map(budget.exceptions.map((entry) => [entry.path, entry]));
  const violations = [];
  if (totalBytes > budget.maxTotalBytes) violations.push(`total bytes ${totalBytes} exceeds budget ${budget.maxTotalBytes}`);
  if (sorted.length > budget.maxFileCount) violations.push(`file count ${sorted.length} exceeds budget ${budget.maxFileCount}`);
  for (const entry of sorted) {
    const exception = exceptionMap.get(entry.path);
    const limit = exception?.maxBytes ?? budget.maxFileBytes;
    if (entry.bytes > limit) violations.push(`${entry.path} is ${entry.bytes} bytes; limit is ${limit}`);
  }
  for (const exception of budget.exceptions) {
    if (!sorted.some((entry) => entry.path === exception.path)) {
      violations.push(`footprint exception path is stale or absent: ${exception.path}`);
    }
  }
  return {
    totalBytes,
    fileCount: sorted.length,
    largestFileBytes: sorted[0].bytes,
    largestFilePath: sorted[0].path,
    topFiles: sorted.slice(0, budget.topContributors),
    violations,
  };
}

export async function checkFootprint({ root = process.cwd(), bundle = DEFAULT_BUNDLE, budgetPath = DEFAULT_BUDGET, reportPath = DEFAULT_REPORT } = {}) {
  const budget = validateBudget(JSON.parse(await readFile(resolve(root, budgetPath), "utf8")));
  const manifestPath = resolve(root, bundle, "release-manifest.json");
  const manifestInfo = await stat(manifestPath);
  if (!manifestInfo.isFile()) throw new Error("release manifest is not a regular file");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const metrics = evaluateFootprint(manifest.files, budget);
  const report = {
    schema: SCHEMA,
    bundleSchema: manifest.schema,
    bundleDigest: manifest.digest?.value ?? null,
    budgets: {
      maxTotalBytes: budget.maxTotalBytes,
      maxFileCount: budget.maxFileCount,
      maxFileBytes: budget.maxFileBytes,
      exceptions: budget.exceptions,
    },
    metrics,
    status: metrics.violations.length === 0 ? "PASS" : "FAIL",
  };
  await writeFile(resolve(root, reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (metrics.violations.length) throw new Error(`release footprint budget failed:\n- ${metrics.violations.join("\n- ")}`);
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!["--bundle", "--budget", "--report"].includes(value)) throw new Error(`unknown argument: ${value}`);
    const next = argv[++i];
    if (!next) throw new Error(`${value} requires a path`);
    if (value === "--bundle") options.bundle = next;
    if (value === "--budget") options.budgetPath = next;
    if (value === "--report") options.reportPath = next;
  }
  return options;
}

async function main() {
  const report = await checkFootprint(parseArgs(process.argv.slice(2)));
  console.log(`${report.status} ${report.metrics.totalBytes} bytes ${report.metrics.fileCount} files; largest ${report.metrics.largestFileBytes} bytes (${report.metrics.largestFilePath})`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-footprint] ${error.message}`);
    process.exitCode = 1;
  });
}
