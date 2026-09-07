#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "totem.public-release-bundle/v1";
export const DEFAULT_OUTPUT = "dist/release/totem-public";
const MANIFEST_NAME = "release-manifest.json";

const ROOT_FILES = new Set([
  ".node-version",
  ".npmrc",
  ".nvmrc",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.ts",
]);
const INCLUDED_PREFIXES = [
  "apps/",
  "deploy/",
  "docs/",
  "packages/",
  "scripts/",
];
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".github",
  ".idea",
  ".totem",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "data",
  "dist",
  "logs",
  "node_modules",
]);
const PRIVATE_PORTAL_NAMES = ["totem-portal-theme", "totem-portal-hardware"];
const FORBIDDEN_EXTENSIONS = [
  ".db",
  ".key",
  ".log",
  ".pem",
  ".sqlite",
  ".sqlite3",
  ".tmp",
];
const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizePath(value) {
  return value.split(sep).join("/");
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`))) {
    return normalizePath(rel || ".");
  }
  throw new Error(`${label} must stay inside the Totem checkout: ${candidate}`);
}

function trackedEntries(root) {
  const output = git(root, ["ls-files", "--stage", "-z"]);
  if (!output) return [];
  return output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^(\d{6}) [0-9a-f]+ \d\t(.+)$/);
      if (!match) {
        throw new Error(`unable to parse git index record: ${record}`);
      }
      return { mode: match[1], path: normalizePath(match[2]) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function releasePolicy(path) {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  const parts = lower.split("/");
  const basename = parts.at(-1) ?? lower;

  if (PRIVATE_PORTAL_NAMES.some((name) => lower.includes(name))) {
    return { include: false, fatal: true, reason: "private Portal content" };
  }
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) {
    return {
      include: false,
      fatal: false,
      reason: "transient/generated path",
    };
  }
  if (FORBIDDEN_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return {
      include: false,
      fatal: true,
      reason: "secret/state/transient extension",
    };
  }
  if (
    (basename === ".env" || basename.startsWith(".env.")) &&
    !basename.endsWith(".example")
  ) {
    return { include: false, fatal: true, reason: "local environment file" };
  }
  if (
    basename.includes("credential") ||
    basename.includes("private-key") ||
    basename === "secrets.json" ||
    basename === "secrets.yaml" ||
    basename === "secrets.yml"
  ) {
    return { include: false, fatal: true, reason: "credential/secret path" };
  }

  const include =
    ROOT_FILES.has(normalized) ||
    INCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  return {
    include,
    fatal: false,
    reason: include ? "public release input" : "outside public release allowlist",
  };
}

function assertNoEmbeddedSecret(path, bytes) {
  const text = bytes.toString("utf8");
  for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`high-confidence secret material detected in ${path}`);
    }
  }
}

function sourceIdentity(root) {
  return {
    revision: git(root, ["rev-parse", "HEAD"]),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]),
  };
}

function aggregateDigest(files) {
  const payload = files
    .map(
      (entry) =>
        `${entry.path}\0${entry.mode}\0${entry.bytes}\0${entry.sha256}\n`,
    )
    .join("");
  return sha256(Buffer.from(payload));
}

async function collectSourceFiles(root) {
  const files = [];
  for (const entry of trackedEntries(root)) {
    const policy = releasePolicy(entry.path);
    if (policy.fatal) {
      throw new Error(
        `forbidden tracked release input: ${entry.path} (${policy.reason})`,
      );
    }
    if (!policy.include) continue;
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      throw new Error(
        `unsupported tracked file mode ${entry.mode}: ${entry.path}`,
      );
    }
    const absolute = resolve(root, entry.path);
    assertInside(root, absolute, "release input");
    const info = await stat(absolute);
    if (!info.isFile()) {
      throw new Error(`release input is not a regular file: ${entry.path}`);
    }
    const bytes = await readFile(absolute);
    assertNoEmbeddedSecret(entry.path, bytes);
    files.push({
      path: entry.path,
      mode: entry.mode,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  if (!files.length) {
    throw new Error("public release allowlist selected no files");
  }
  return files;
}

export async function buildReleaseBundle({ root, output = DEFAULT_OUTPUT }) {
  const rootAbs = resolve(root);
  const outputAbs = resolve(rootAbs, output);
  const outputRel = assertInside(rootAbs, outputAbs, "release output");
  if (releasePolicy(outputRel).include) {
    throw new Error("release output must be outside the release source allowlist");
  }

  const files = await collectSourceFiles(rootAbs);
  await rm(outputAbs, { recursive: true, force: true });
  await mkdir(outputAbs, { recursive: true });

  for (const entry of files) {
    const source = resolve(rootAbs, entry.path);
    const destination = resolve(outputAbs, entry.path);
    assertInside(outputAbs, destination, "bundle destination");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, entry.mode === "100755" ? 0o755 : 0o644);
  }

  const identity = sourceIdentity(rootAbs);
  const manifest = {
    schema: SCHEMA,
    repository: "KingHacker9000/totem",
    source: identity,
    policy: {
      trackedFilesOnly: true,
      allowlistedRoots: [...INCLUDED_PREFIXES],
      allowlistedRootFiles: [...ROOT_FILES].sort(),
      excludedGeneratedAndLocalSegments: [...EXCLUDED_SEGMENTS].sort(),
      excludedPrivateRepositories: [...PRIVATE_PORTAL_NAMES],
      generatedBuildOutputs:
        "excluded; bundle is a pinned source/deployment input and runs pnpm build after frozen install",
    },
    files,
    digest: {
      algorithm: "sha256",
      value: aggregateDigest(files),
    },
  };
  await writeFile(
    resolve(outputAbs, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export async function verifyReleaseBundle({ root, output = DEFAULT_OUTPUT }) {
  const rootAbs = resolve(root);
  const outputAbs = resolve(rootAbs, output);
  assertInside(rootAbs, outputAbs, "release output");
  const manifest = JSON.parse(
    await readFile(resolve(outputAbs, MANIFEST_NAME), "utf8"),
  );
  if (manifest.schema !== SCHEMA) {
    throw new Error(`unsupported release bundle schema: ${manifest.schema}`);
  }
  const identity = sourceIdentity(rootAbs);
  if (JSON.stringify(manifest.source) !== JSON.stringify(identity)) {
    throw new Error("release bundle source revision/tree is stale");
  }
  const expectedFiles = await collectSourceFiles(rootAbs);
  if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      "release bundle manifest does not match current allowlisted source inputs",
    );
  }
  if (manifest.digest?.value !== aggregateDigest(expectedFiles)) {
    throw new Error("release bundle aggregate digest is invalid");
  }
  for (const entry of expectedFiles) {
    const bundled = resolve(outputAbs, entry.path);
    assertInside(outputAbs, bundled, "bundle verification path");
    const bytes = await readFile(bundled);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`release bundle file drift: ${entry.path}`);
    }
  }
  return manifest;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      index += 1;
      options.output = argv[index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return options;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  const root = process.cwd();
  if (command === "build") {
    const manifest = await buildReleaseBundle({ root, ...options });
    console.log(`${manifest.digest.value}  ${options.output ?? DEFAULT_OUTPUT}`);
  } else if (command === "verify") {
    const manifest = await verifyReleaseBundle({ root, ...options });
    console.log(`${manifest.digest.value}  ${options.output ?? DEFAULT_OUTPUT}`);
  } else {
    throw new Error(
      "usage: release-bundle.mjs <build|verify> [--output <path>]",
    );
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-bundle] ${error.message}`);
    process.exitCode = 1;
  });
}
