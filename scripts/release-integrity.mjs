#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "totem.release-integrity/v1";
export const DEFAULT_BUNDLE = "dist/release/totem-public";
export const DEFAULT_MANIFEST = "dist/release/totem-public.integrity.json";
const RELEASE_MANIFEST = "release-manifest.json";
const RELEASE_SCHEMA = "totem.public-release-bundle/v1";
const PRIVATE_MARKERS = ["totem-portal-theme", "totem-portal-hardware"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizePath(value) {
  return value.split(sep).join("/");
}

function assertSafeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe ${label}: ${value}`);
  }
  if (
    PRIVATE_MARKERS.some((marker) => normalized.toLowerCase().includes(marker))
  ) {
    throw new Error(
      `private Portal path is forbidden in public integrity metadata: ${value}`,
    );
  }
  return normalized;
}

function assertInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`))) return;
  throw new Error(`${label} escapes the release bundle: ${candidate}`);
}

async function regularFileRecord(bundleRoot, path) {
  const safePath = assertSafeRelativePath(path);
  const absolute = resolve(bundleRoot, safePath);
  assertInside(bundleRoot, absolute, "integrity path");
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`integrity entry is not a regular file: ${safePath}`);
  }
  const bytes = await readFile(absolute);
  return { path: safePath, bytes: bytes.length, sha256: sha256(bytes) };
}

async function listBundleFiles(bundleRoot) {
  const files = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const child = resolve(directory, name);
      const info = await lstat(child);
      const rel = normalizePath(relative(bundleRoot, child));
      assertSafeRelativePath(rel, "bundle entry");
      if (info.isSymbolicLink())
        throw new Error(`bundle contains symlink: ${rel}`);
      if (info.isDirectory()) await walk(child);
      else if (info.isFile()) files.push(rel);
      else throw new Error(`bundle contains unsupported entry: ${rel}`);
    }
  }
  await walk(bundleRoot);
  return files.sort();
}

function validateReleaseManifest(document) {
  if (document?.schema !== RELEASE_SCHEMA) {
    throw new Error(`unsupported release manifest schema: ${document?.schema}`);
  }
  if (!document.source?.revision || !document.source?.tree) {
    throw new Error("release manifest source identity is incomplete");
  }
  if (
    document.digest?.algorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/.test(document.digest?.value ?? "")
  ) {
    throw new Error("release manifest bundle digest is invalid");
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error("release manifest contains no files");
  }
  const seen = new Set();
  for (const entry of document.files) {
    const path = assertSafeRelativePath(entry?.path, "release manifest path");
    if (seen.has(path))
      throw new Error(`duplicate release manifest path: ${path}`);
    seen.add(path);
    if (
      !Number.isSafeInteger(entry?.bytes) ||
      entry.bytes < 0 ||
      !/^[0-9a-f]{64}$/.test(entry?.sha256 ?? "")
    ) {
      throw new Error(`invalid release manifest file identity: ${path}`);
    }
  }
  if (seen.has(RELEASE_MANIFEST)) {
    throw new Error(
      `${RELEASE_MANIFEST} must not self-reference in release manifest files`,
    );
  }
  return seen;
}

function validateIntegrityDocument(document) {
  if (document?.schema !== SCHEMA)
    throw new Error(`unsupported integrity schema: ${document?.schema}`);
  if (document?.algorithm !== "sha256")
    throw new Error("integrity algorithm must be sha256");
  if (!document.source?.revision || !document.source?.tree)
    throw new Error("integrity source identity is incomplete");
  if (!/^[0-9a-f]{64}$/.test(document.releaseBundleDigest ?? ""))
    throw new Error("integrity release bundle digest is invalid");
  if (!Array.isArray(document.files) || document.files.length === 0)
    throw new Error("integrity manifest contains no files");
  const seen = new Set();
  for (const entry of document.files) {
    const path = assertSafeRelativePath(entry?.path, "integrity manifest path");
    if (seen.has(path))
      throw new Error(`duplicate integrity manifest path: ${path}`);
    seen.add(path);
    if (
      !Number.isSafeInteger(entry?.bytes) ||
      entry.bytes < 0 ||
      !/^[0-9a-f]{64}$/.test(entry?.sha256 ?? "")
    ) {
      throw new Error(`invalid integrity file identity: ${path}`);
    }
  }
  return seen;
}

export async function generateIntegrity({
  bundle = DEFAULT_BUNDLE,
  manifest = DEFAULT_MANIFEST,
  root = process.cwd(),
} = {}) {
  const bundleRoot = resolve(root, bundle);
  const releaseManifestBytes = await readFile(
    resolve(bundleRoot, RELEASE_MANIFEST),
  );
  const release = JSON.parse(releaseManifestBytes.toString("utf8"));
  const releasePaths = validateReleaseManifest(release);
  const actualPaths = await listBundleFiles(bundleRoot);
  const expectedPaths = [...releasePaths, RELEASE_MANIFEST].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("bundle file set does not match release-manifest.json");
  }
  const files = [];
  for (const path of actualPaths)
    files.push(await regularFileRecord(bundleRoot, path));
  const document = {
    schema: SCHEMA,
    algorithm: "sha256",
    repository: release.repository,
    source: release.source,
    releaseBundleDigest: release.digest.value,
    files,
  };
  await writeFile(
    resolve(root, manifest),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  return document;
}

export async function verifyIntegrity({
  bundle = DEFAULT_BUNDLE,
  manifest = DEFAULT_MANIFEST,
  root = process.cwd(),
} = {}) {
  const bundleRoot = resolve(root, bundle);
  const document = JSON.parse(await readFile(resolve(root, manifest), "utf8"));
  const manifestPaths = validateIntegrityDocument(document);
  const actualPaths = await listBundleFiles(bundleRoot);
  if (
    JSON.stringify(actualPaths) !== JSON.stringify([...manifestPaths].sort())
  ) {
    throw new Error(
      "bundle contains missing or unexpected files relative to integrity manifest",
    );
  }
  for (const expected of document.files) {
    const actual = await regularFileRecord(bundleRoot, expected.path);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`release integrity mismatch: ${expected.path}`);
    }
  }
  const releaseBytes = await readFile(resolve(bundleRoot, RELEASE_MANIFEST));
  const release = JSON.parse(releaseBytes.toString("utf8"));
  validateReleaseManifest(release);
  if (
    JSON.stringify(document.source) !== JSON.stringify(release.source) ||
    document.repository !== release.repository ||
    document.releaseBundleDigest !== release.digest.value
  ) {
    throw new Error(
      "integrity metadata does not match embedded release identity",
    );
  }
  return document;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--bundle") options.bundle = argv[++index];
    else if (value === "--manifest") options.manifest = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  return options;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  if (command === "generate") {
    const document = await generateIntegrity(options);
    console.log(
      `${document.releaseBundleDigest}  ${options.manifest ?? DEFAULT_MANIFEST}`,
    );
  } else if (command === "verify") {
    const document = await verifyIntegrity(options);
    console.log(
      `${document.releaseBundleDigest}  ${options.bundle ?? DEFAULT_BUNDLE}`,
    );
  } else {
    throw new Error(
      "usage: release-integrity.mjs <generate|verify> [--bundle <path>] [--manifest <path>]",
    );
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-integrity] ${error.message}`);
    process.exitCode = 1;
  });
}
