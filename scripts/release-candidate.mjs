#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArchive } from "./release-archive.mjs";
import {
  DEFAULT_BUNDLE,
  DEFAULT_MANIFEST as DEFAULT_INTEGRITY,
  verifyIntegrity,
} from "./release-integrity.mjs";

export const SCHEMA = "totem.release-candidate/v1";
export const DEFAULT_ARCHIVE = "dist/release/totem-public.tar.gz";
export const DEFAULT_CANDIDATE = "dist/release/totem-public.candidate.json";
const SHA256_RE = /^[0-9a-f]{64}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSha256(value, label) {
  if (!SHA256_RE.test(value ?? "")) {
    throw new Error(`${label} must be a lowercase sha256 digest`);
  }
}

function assertByteSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertLeafName(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    basename(value) !== value ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${label} must be a plain file name`);
  }
}

export function buildCandidateDocument({
  integrityDocument,
  integrityBytes,
  integrityName,
  archiveBytes,
  archiveName,
}) {
  if (!integrityDocument?.repository) {
    throw new Error("integrity repository identity is missing");
  }
  if (!integrityDocument.source?.revision || !integrityDocument.source?.tree) {
    throw new Error("integrity source identity is incomplete");
  }
  assertSha256(
    integrityDocument.releaseBundleDigest,
    "integrity release bundle digest",
  );
  assertLeafName(integrityName, "integrity metadata name");
  assertLeafName(archiveName, "archive name");
  return {
    schema: SCHEMA,
    algorithm: "sha256",
    repository: integrityDocument.repository,
    source: integrityDocument.source,
    releaseBundleDigest: integrityDocument.releaseBundleDigest,
    integrity: {
      name: integrityName,
      bytes: integrityBytes.length,
      sha256: sha256(integrityBytes),
    },
    archive: {
      name: archiveName,
      bytes: archiveBytes.length,
      sha256: sha256(archiveBytes),
    },
  };
}

export function validateCandidateDocument(document) {
  if (document?.schema !== SCHEMA) {
    throw new Error(`unsupported release candidate schema: ${document?.schema}`);
  }
  if (document.algorithm !== "sha256") {
    throw new Error("release candidate algorithm must be sha256");
  }
  if (typeof document.repository !== "string" || document.repository.length === 0) {
    throw new Error("release candidate repository identity is missing");
  }
  if (!document.source?.revision || !document.source?.tree) {
    throw new Error("release candidate source identity is incomplete");
  }
  assertSha256(document.releaseBundleDigest, "release candidate bundle digest");
  for (const [label, record] of [
    ["integrity metadata", document.integrity],
    ["archive", document.archive],
  ]) {
    if (!record || typeof record !== "object") {
      throw new Error(`release candidate ${label} identity is missing`);
    }
    assertLeafName(record.name, `${label} name`);
    assertByteSize(record.bytes, `${label} byte size`);
    assertSha256(record.sha256, `${label} digest`);
  }
  return document;
}

export function assertCandidateMatches({
  candidate,
  integrityDocument,
  integrityBytes,
  integrityName,
  archiveBytes,
  archiveName,
}) {
  validateCandidateDocument(candidate);
  const actual = buildCandidateDocument({
    integrityDocument,
    integrityBytes,
    integrityName,
    archiveBytes,
    archiveName,
  });
  if (JSON.stringify(candidate) !== JSON.stringify(actual)) {
    throw new Error(
      "release candidate metadata does not match the verified release artifacts",
    );
  }
  return candidate;
}

export async function generateCandidate({
  bundle = DEFAULT_BUNDLE,
  integrity = DEFAULT_INTEGRITY,
  archive = DEFAULT_ARCHIVE,
  candidate = DEFAULT_CANDIDATE,
  root = process.cwd(),
} = {}) {
  const integrityDocument = await verifyIntegrity({ bundle, manifest: integrity, root });
  await verifyArchive({
    bundle: resolve(root, bundle),
    archive: resolve(root, archive),
  });
  const integrityBytes = await readFile(resolve(root, integrity));
  const archiveBytes = await readFile(resolve(root, archive));
  const document = buildCandidateDocument({
    integrityDocument,
    integrityBytes,
    integrityName: basename(integrity),
    archiveBytes,
    archiveName: basename(archive),
  });
  await writeFile(
    resolve(root, candidate),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  return document;
}

export async function verifyCandidate({
  bundle = DEFAULT_BUNDLE,
  integrity = DEFAULT_INTEGRITY,
  archive = DEFAULT_ARCHIVE,
  candidate = DEFAULT_CANDIDATE,
  root = process.cwd(),
} = {}) {
  const integrityDocument = await verifyIntegrity({ bundle, manifest: integrity, root });
  await verifyArchive({
    bundle: resolve(root, bundle),
    archive: resolve(root, archive),
  });
  const [candidateBytes, integrityBytes, archiveBytes] = await Promise.all([
    readFile(resolve(root, candidate)),
    readFile(resolve(root, integrity)),
    readFile(resolve(root, archive)),
  ]);
  const document = JSON.parse(candidateBytes.toString("utf8"));
  return assertCandidateMatches({
    candidate: document,
    integrityDocument,
    integrityBytes,
    integrityName: basename(integrity),
    archiveBytes,
    archiveName: basename(archive),
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (
      value === "--bundle" ||
      value === "--integrity" ||
      value === "--archive" ||
      value === "--candidate"
    ) {
      index += 1;
      if (!argv[index]) throw new Error(`missing value for ${value}`);
      options[value.slice(2)] = argv[index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return options;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  let document;
  if (command === "generate") document = await generateCandidate(options);
  else if (command === "verify") document = await verifyCandidate(options);
  else {
    throw new Error(
      "usage: release-candidate.mjs <generate|verify> [--bundle path] [--integrity path] [--archive path] [--candidate path]",
    );
  }
  console.log(
    `${document.archive.sha256}  ${document.archive.name} (${document.archive.bytes} bytes)`,
  );
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-candidate] ${error.message}`);
    process.exitCode = 1;
  });
}
