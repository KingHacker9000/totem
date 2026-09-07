#!/usr/bin/env node
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUTPUT, verifyReleaseBundle } from "./release-bundle.mjs";

export const SCHEMA = "totem.release-artifact-content-scan/v1";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const PRIVATE_IDENTIFIERS = ["totem-portal-theme", "totem-portal-hardware"];
const PRIVATE_REFERENCE_ALLOWLIST = new Set([
  "release-manifest.json",
  "docs/LICENSING_PROPOSAL.md",
  "docs/RELEASE_BUNDLE.md",
  "docs/RELEASE_PROVENANCE.md",
  "docs/RELEASE_READINESS_AUDIT.md",
  "docs/RELEASE_VERSIONING.md",
  "docs/REPOSITORIES.md",
  "docs/THIRD_PARTY_RELEASE_MANIFEST.md",
  "scripts/release-artifact-scan.mjs",
  "scripts/release-bundle.mjs",
  "scripts/release-docs.mjs",
  "scripts/release-provenance.mjs",
  "scripts/release-repository-metadata.mjs",
  "scripts/repo-family-validation.mjs",
  "scripts/third-party-manifest.mjs",
]);
const SAFE_ABSOLUTE_PATH_LITERALS = new Map([
  ["apps/core/src/extensionGrants.config.test.ts", new Set(["/home/tester"])],
]);
const SECRET_PATTERNS = [
  {
    label: "private key material",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    label: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    label: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  },
  {
    label: "OpenAI project key",
    pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    label: "AWS access key",
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
  },
];
const ABSOLUTE_PATH_PATTERNS = [
  /\/(?:home|Users)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._@+\-/]+)?/g,
  /\b[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._@+\-\\]+)?/g,
];

function normalizePath(value) {
  return value.split(sep).join("/");
}

function assertInside(root, candidate) {
  const rel = relative(root, candidate);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`))) {
    return normalizePath(rel || ".");
  }
  throw new Error(`artifact path escapes scan root: ${candidate}`);
}

async function collectFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const path = assertInside(root, absolute);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`release artifact contains symlink: ${path}`);
      }
      if (info.isDirectory()) {
        await walk(absolute);
      } else if (info.isFile()) {
        files.push({ absolute, path, bytes: info.size });
      } else {
        throw new Error(`unsupported release artifact entry: ${path}`);
      }
    }
  }
  await walk(root);
  return files;
}

function findMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function scanSecrets(path, text) {
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (findMatches(text, pattern).length > 0) {
      throw new Error(`${label} detected in release artifact: ${path}`);
    }
  }
}

function scanAbsolutePaths(path, text) {
  const allowed = SAFE_ABSOLUTE_PATH_LITERALS.get(path) ?? new Set();
  for (const pattern of ABSOLUTE_PATH_PATTERNS) {
    for (const match of findMatches(text, pattern)) {
      if (![...allowed].some((literal) => match.startsWith(literal))) {
        throw new Error(
          `absolute developer/workspace path detected in release artifact: ${path}: ${match}`,
        );
      }
    }
  }
}

function scanPrivateBoundary(path, text) {
  for (const identifier of PRIVATE_IDENTIFIERS) {
    if (text.includes(identifier) && !PRIVATE_REFERENCE_ALLOWLIST.has(path)) {
      throw new Error(
        `private Portal identifier detected outside explicit policy allowlist: ${path}: ${identifier}`,
      );
    }
  }
}

function scanDebugMaterial(path, text) {
  if (path.endsWith(".map")) {
    throw new Error(`source-map artifact is not allowed in public release: ${path}`);
  }
  if (/\bsourceMappingURL\s*=/.test(text)) {
    throw new Error(`source-map reference is not allowed in public release: ${path}`);
  }
}

function scanFileContent(path, bytes) {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(
      `release artifact file exceeds ${MAX_FILE_BYTES} byte scan limit: ${path} (${bytes.length} bytes)`,
    );
  }
  const binary = bytes.includes(0);
  const searchable = bytes.toString(binary ? "latin1" : "utf8");
  scanSecrets(path, searchable);
  scanPrivateBoundary(path, searchable);
  scanAbsolutePaths(path, searchable);
  scanDebugMaterial(path, searchable);
  return binary;
}

export async function scanArtifactDirectory(artifactRoot) {
  const root = resolve(artifactRoot);
  const info = await lstat(root);
  if (!info.isDirectory()) {
    throw new Error(`release artifact is not a directory: ${root}`);
  }
  const files = await collectFiles(root);
  if (files.length === 0) {
    throw new Error("release artifact contains no files");
  }

  let binaryFiles = 0;
  let totalBytes = 0;
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    totalBytes += bytes.length;
    if (scanFileContent(file.path, bytes)) binaryFiles += 1;
  }

  return {
    schema: SCHEMA,
    artifact: basename(root),
    files: files.length,
    binaryFiles,
    textFiles: files.length - binaryFiles,
    totalBytes,
    maxFileBytes: MAX_FILE_BYTES,
    status: "PASS",
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--artifact") {
      index += 1;
      options.artifact = argv[index];
    } else if (value === "--skip-integrity-check") {
      options.skipIntegrityCheck = true;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const artifact = options.artifact ?? DEFAULT_OUTPUT;
  if (!options.skipIntegrityCheck) {
    await verifyReleaseBundle({ root, output: artifact });
  }
  const report = await scanArtifactDirectory(resolve(root, artifact));
  console.log(JSON.stringify(report));
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-artifact-scan] ${error.message}`);
    process.exitCode = 1;
  });
}
