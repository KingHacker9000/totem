#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "totem.release-toolchain/v1";
export const DEFAULT_CONTRACT = "config/release-toolchain.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertVersion(value, label) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? "")) {
    throw new Error(`${label} must be an exact x.y.z version; got ${value}`);
  }
}

function parseWorkflowNodeMatrix(workflow) {
  const match = workflow.match(/^\s*node:\s*\[([^\]]+)\]\s*$/m);
  if (!match) {
    throw new Error("CI workflow must declare an inline node matrix");
  }
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function loadToolchainContract(root) {
  const path = resolve(root, DEFAULT_CONTRACT);
  const bytes = await readFile(path);
  const contract = JSON.parse(bytes.toString("utf8"));
  if (contract.schema !== SCHEMA) {
    throw new Error(`unsupported release toolchain schema: ${contract.schema}`);
  }
  assertVersion(contract.node?.default, "node.default");
  if (!Array.isArray(contract.node?.ci) || contract.node.ci.length === 0) {
    throw new Error("node.ci must contain at least one exact CI version");
  }
  for (const version of contract.node.ci)
    assertVersion(version, "node.ci entry");
  if (!contract.node.ci.includes(contract.node.default)) {
    throw new Error("node.default must be included in node.ci");
  }
  assertVersion(contract.pnpm?.pinned, "pnpm.pinned");
  if (!contract.node?.engine || !contract.pnpm?.engine) {
    throw new Error("release toolchain engine ranges are required");
  }
  if (contract.workflow !== ".github/workflows/ci.yml") {
    throw new Error(
      "release toolchain workflow must be .github/workflows/ci.yml",
    );
  }
  return { contract, bytes };
}

export async function validateToolchainMetadata(root) {
  const { contract, bytes } = await loadToolchainContract(root);
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const nodeVersion = (
    await readFile(resolve(root, ".node-version"), "utf8")
  ).trim();
  const nvmrc = (await readFile(resolve(root, ".nvmrc"), "utf8")).trim();
  const workflow = await readFile(resolve(root, contract.workflow), "utf8");

  const expectedPackageManager = `pnpm@${contract.pnpm.pinned}`;
  if (pkg.packageManager !== expectedPackageManager) {
    throw new Error(
      `packageManager drift: expected ${expectedPackageManager}; got ${pkg.packageManager}`,
    );
  }
  if (pkg.engines?.node !== contract.node.engine) {
    throw new Error(
      `Node engine drift: expected ${contract.node.engine}; got ${pkg.engines?.node}`,
    );
  }
  if (pkg.engines?.pnpm !== contract.pnpm.engine) {
    throw new Error(
      `pnpm engine drift: expected ${contract.pnpm.engine}; got ${pkg.engines?.pnpm}`,
    );
  }
  if (
    nodeVersion !== contract.node.default ||
    nvmrc !== contract.node.default
  ) {
    throw new Error(
      `default Node drift: contract=${contract.node.default} .node-version=${nodeVersion} .nvmrc=${nvmrc}`,
    );
  }
  const matrix = parseWorkflowNodeMatrix(workflow);
  if (!sameArray(matrix, contract.node.ci)) {
    throw new Error(
      `CI Node matrix drift: expected [${contract.node.ci.join(", ")}]; got [${matrix.join(", ")}]`,
    );
  }
  const matrixExpression = "node-version: $" + "{{ matrix.node }}";
  if (!workflow.includes(matrixExpression)) {
    throw new Error("CI setup-node must consume matrix.node");
  }
  if (!workflow.includes("pnpm/action-setup@")) {
    throw new Error("CI workflow must explicitly initialize pnpm");
  }

  return {
    schema: SCHEMA,
    contractSha256: sha256(bytes),
    node: contract.node,
    pnpm: contract.pnpm,
  };
}

function readPnpmVersion(root) {
  if (process.platform === "win32") {
    const command = process.env.ComSpec ?? "cmd.exe";
    return execFileSync(command, ["/d", "/s", "/c", "pnpm --version"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  return execFileSync("pnpm", ["--version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function effectiveToolchainIdentity(root) {
  const metadata = await validateToolchainMetadata(root);
  return {
    schema: SCHEMA,
    contractSha256: metadata.contractSha256,
    node: process.version.replace(/^v/, ""),
    pnpm: readPnpmVersion(root),
  };
}

export async function validateEffectiveRuntime(root) {
  const metadata = await validateToolchainMetadata(root);
  const identity = await effectiveToolchainIdentity(root);
  if (!metadata.node.ci.includes(identity.node)) {
    throw new Error(
      `unsupported release Node runtime ${identity.node}; tested versions: ${metadata.node.ci.join(", ")}`,
    );
  }
  if (identity.pnpm !== metadata.pnpm.pinned) {
    throw new Error(
      `pnpm runtime drift: expected ${metadata.pnpm.pinned}; got ${identity.pnpm}`,
    );
  }
  return identity;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const value of args) {
    if (value !== "--runtime") throw new Error(`unknown argument: ${value}`);
  }
  const root = process.cwd();
  const result = args.has("--runtime")
    ? await validateEffectiveRuntime(root)
    : await validateToolchainMetadata(root);
  console.log(JSON.stringify(result, null, 2));
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-toolchain] ${error.message}`);
    process.exitCode = 1;
  });
}
