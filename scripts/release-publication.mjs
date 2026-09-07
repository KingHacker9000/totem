#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CANDIDATE,
  validateCandidateDocument,
} from "./release-candidate.mjs";

export const SCHEMA = "totem.release-publication/v1";
const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const TREE_RE = /^[0-9a-f]{40}$/;
const TAG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function git(args, root) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function candidateDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeTagRef(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("release tag is required");
  }
  if (value.startsWith("refs/heads/") || value.startsWith("refs/remotes/")) {
    throw new Error(
      "moving branch refs are not valid release publication refs",
    );
  }
  const name = value.startsWith("refs/tags/")
    ? value.slice("refs/tags/".length)
    : value;
  if (
    !TAG_NAME_RE.test(name) ||
    name.includes("..") ||
    name.endsWith("/") ||
    name.includes("//")
  ) {
    throw new Error("release tag name is invalid");
  }
  return `refs/tags/${name}`;
}

export function verifyPublicationIdentity({
  candidate,
  candidateBytes,
  releaseRef,
  root,
}) {
  validateCandidateDocument(candidate);
  if (!FULL_SHA_RE.test(candidate.source.revision)) {
    throw new Error(
      "release candidate source revision must be a full commit SHA",
    );
  }
  if (!TREE_RE.test(candidate.source.tree)) {
    throw new Error("release candidate source tree must be a full tree SHA");
  }

  const tagRef = normalizeTagRef(releaseRef);
  let refObject;
  let refCommit;
  try {
    refObject = git(["rev-parse", "--verify", tagRef], root);
    refCommit = git(["rev-parse", "--verify", `${tagRef}^{commit}`], root);
  } catch {
    throw new Error(`release tag does not resolve to a commit: ${tagRef}`);
  }

  if (!FULL_SHA_RE.test(refCommit)) {
    throw new Error(
      `release tag did not resolve to a full commit SHA: ${tagRef}`,
    );
  }
  if (refCommit !== candidate.source.revision) {
    throw new Error(
      `release tag commit ${refCommit} does not match candidate source revision ${candidate.source.revision}`,
    );
  }

  let sourceTree;
  try {
    sourceTree = git(
      ["rev-parse", "--verify", `${candidate.source.revision}^{tree}`],
      root,
    );
  } catch {
    throw new Error(
      `candidate source revision is not available as a local commit: ${candidate.source.revision}`,
    );
  }
  if (sourceTree !== candidate.source.tree) {
    throw new Error(
      `candidate source tree ${candidate.source.tree} does not match commit tree ${sourceTree}`,
    );
  }

  return {
    schema: SCHEMA,
    repository: candidate.repository,
    releaseRef: tagRef,
    refObject,
    source: {
      revision: refCommit,
      tree: sourceTree,
    },
    candidate: {
      sha256: candidateDigest(candidateBytes),
      schema: candidate.schema,
      archiveSha256: candidate.archive.sha256,
    },
  };
}

export async function verifyPublication({
  candidate = DEFAULT_CANDIDATE,
  releaseRef,
  root = process.cwd(),
} = {}) {
  const candidateBytes = await readFile(resolve(root, candidate));
  const document = JSON.parse(candidateBytes.toString("utf8"));
  return verifyPublicationIdentity({
    candidate: document,
    candidateBytes,
    releaseRef,
    root,
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--candidate" || value === "--ref") {
      index += 1;
      if (!argv[index]) throw new Error(`missing value for ${value}`);
      if (value === "--candidate") options.candidate = argv[index];
      else options.releaseRef = argv[index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (!options.releaseRef) {
    throw new Error(
      "usage: release-publication.mjs --ref <tag> [--candidate path]",
    );
  }
  return options;
}

async function main() {
  const proof = await verifyPublication(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(proof, null, 2));
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-publication] ${error.message}`);
    process.exitCode = 1;
  });
}
