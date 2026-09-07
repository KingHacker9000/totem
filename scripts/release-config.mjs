#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "config", "release-config.json");
const sourceRoots = ["apps", "packages", "scripts", "deploy/pi"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh"]);
const excludedName = /(?:^|\.)(?:test|spec|node-test)\./;

export async function loadContract() {
  const parsed = JSON.parse(await readFile(contractPath, "utf8"));
  if (parsed?.schema !== "totem.release-config/v1" || !Array.isArray(parsed.variables)) {
    throw new Error("config/release-config.json must use schema totem.release-config/v1");
  }
  const names = new Set();
  for (const entry of parsed.variables) {
    if (!/^TOTEM_[A-Z0-9_]+$/.test(entry?.name ?? "")) {
      throw new Error(`invalid contract variable name: ${String(entry?.name)}`);
    }
    if (names.has(entry.name)) throw new Error(`duplicate contract variable: ${entry.name}`);
    names.add(entry.name);
    if (!entry.scope || !entry.class || typeof entry.secret !== "boolean" || !entry.validation) {
      throw new Error(`incomplete contract entry: ${entry.name}`);
    }
  }
  return parsed;
}

async function walk(relative) {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (sourceExtensions.has(path.extname(entry.name)) && !excludedName.test(entry.name)) files.push(child);
  }
  return files;
}

function referencedTotemVariables(text) {
  const found = new Set();
  const patterns = [
    /process\.env\.(TOTEM_[A-Z0-9_]+)/g,
    /\benv\.(TOTEM_[A-Z0-9_]+)/g,
    /\bdeployedEnv\.(TOTEM_[A-Z0-9_]+)/g,
    /\$\{(TOTEM_[A-Z0-9_]+)(?::[-+?=][^}]*)?\}/g,
    /\$(TOTEM_[A-Z0-9_]+)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

export async function discoverReferencedVariables() {
  const files = [];
  for (const sourceRoot of sourceRoots) files.push(...(await walk(sourceRoot)));
  const references = new Map();
  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8");
    for (const name of referencedTotemVariables(text)) {
      const paths = references.get(name) ?? [];
      paths.push(file.replaceAll("\\", "/"));
      references.set(name, paths);
    }
  }
  return references;
}

export function parseEnvFile(text) {
  const values = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error(`invalid env line ${index + 1}`);
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function validateValue(entry, value) {
  if (value === undefined || value === "") return [];
  const issues = [];
  const fail = (message) => issues.push(`${entry.name}: ${message}`);
  switch (entry.validation) {
    case "port": {
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isInteger(number) || number < 1 || number > 65535) fail("must be an integer between 1 and 65535");
      break;
    }
    case "positive-number":
      if (!Number.isFinite(Number(value)) || Number(value) <= 0) fail("must be a positive number");
      break;
    case "positive-integer":
      if (!/^\d+$/.test(value) || Number(value) <= 0) fail("must be a positive integer");
      break;
    case "unit-number":
      if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) fail("must be a number between 0 and 1");
      break;
    case "environment":
      if (!["development", "test", "production"].includes(value)) fail("must be development, test, or production");
      break;
    case "log-level":
      if (!["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(value)) fail("has an unsupported log level");
      break;
    case "stt-provider":
      if (!["none", "whisper.cpp"].includes(value)) fail("must be none or whisper.cpp");
      break;
    case "tts-provider":
      if (!["none", "piper"].includes(value)) fail("must be none or piper");
      break;
    case "package-id":
    case "provider-id":
      if (entry.validation === "provider-id" && value === "mock") break;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) fail("must be a lowercase package/provider id");
      break;
    case "json-object":
      try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("must be a JSON object");
      } catch {
        fail("must be valid JSON");
      }
      break;
    case "url":
      try { new URL(value); } catch { fail("must be a valid URL"); }
      break;
    case "hostname":
      if (value.length > 253 || /[\s/]/.test(value)) fail("must be a hostname or IP address without whitespace or slashes");
      break;
    case "nonempty-string":
      if (!value.trim()) fail("must not be empty");
      break;
    case "path":
    case "path-list":
    case "registry-trusted-keys":
      if (value.includes("\0")) fail("must not contain NUL characters");
      break;
    default:
      fail(`uses unknown validator ${entry.validation}`);
  }
  return issues;
}

export function validateEnvironment(contract, env) {
  const byName = new Map(contract.variables.map((entry) => [entry.name, entry]));
  const issues = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("TOTEM_")) continue;
    const entry = byName.get(name);
    if (!entry) {
      issues.push(`${name}: unknown TOTEM_ variable; add it to config/release-config.json before use`);
      continue;
    }
    issues.push(...validateValue(entry, String(value)));
  }
  return issues;
}

export async function checkContract() {
  const contract = await loadContract();
  const references = await discoverReferencedVariables();
  const declared = new Set(contract.variables.map((entry) => entry.name));
  const missing = [...references.keys()].filter((name) => !declared.has(name)).sort();
  if (missing.length) {
    throw new Error(`runtime/deployment configuration drift: undeclared variables: ${missing.join(", ")}`);
  }
  const example = parseEnvFile(await readFile(path.join(root, "deploy/pi/totem.env.example"), "utf8"));
  const issues = validateEnvironment(contract, example);
  if (issues.length) throw new Error(`invalid credential-free Pi environment example:\n- ${issues.join("\n- ")}`);
  return { schema: contract.schema, declared: declared.size, referenced: references.size, credential_free_example: "PASS" };
}

async function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  const contract = await loadContract();
  if (command === "check") {
    console.log(JSON.stringify(await checkContract(), null, 2));
    return;
  }
  if (command === "validate-env") {
    const fileIndex = args.indexOf("--env-file");
    const env = fileIndex >= 0 ? parseEnvFile(await readFile(path.resolve(args[fileIndex + 1]), "utf8")) : process.env;
    const issues = validateEnvironment(contract, env);
    if (issues.length) throw new Error(`invalid Totem release configuration:\n- ${issues.join("\n- ")}`);
    console.log(JSON.stringify({ schema: contract.schema, valid: true, credential_free: true }, null, 2));
    return;
  }
  throw new Error(`unknown command '${command}'; expected check or validate-env`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1]).replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
