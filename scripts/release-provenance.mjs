#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "totem.release-provenance/v1";
const PUBLIC_REPOSITORY = "KingHacker9000/totem";
const PRIVATE_REPOSITORIES = [
  "KingHacker9000/totem-portal-theme",
  "KingHacker9000/totem-portal-hardware",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function assertInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
  ) {
    return normalizePath(rel || ".");
  }
  throw new Error(
    `${label} must stay inside the public Totem repository: ${candidate}`,
  );
}

function canonicalRemote(value) {
  return value
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
}

function assertPublicRemote(root) {
  const remote = canonicalRemote(
    git(root, ["config", "--get", "remote.origin.url"]),
  );
  if (remote !== `https://github.com/${PUBLIC_REPOSITORY}`) {
    throw new Error(
      `origin must resolve to the public ${PUBLIC_REPOSITORY} repository; got ${remote}`,
    );
  }
  return remote;
}

function assertCleanSource(root, allowedUntracked = new Set()) {
  if (git(root, ["diff", "--name-only", "HEAD", "--"])) {
    throw new Error(
      "tracked source differs from HEAD; provenance requires a clean source revision",
    );
  }
  if (git(root, ["diff", "--cached", "--name-only", "--"])) {
    throw new Error(
      "staged source differs from HEAD; provenance requires a clean source revision",
    );
  }
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  const unexpected = untracked.filter(
    (path) => !allowedUntracked.has(normalizePath(path)),
  );
  if (unexpected.length) {
    throw new Error(
      `unexpected untracked source inputs: ${unexpected.join(", ")}`,
    );
  }
}

async function hashPath(root, inputPath) {
  const absolute = resolve(root, inputPath);
  const rel = assertInside(root, absolute, "artifact");
  const resolvedRoot = await realpath(root);
  const resolvedArtifact = await realpath(absolute);
  assertInside(resolvedRoot, resolvedArtifact, "artifact realpath");
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) {
    throw new Error(`artifact root may not be a symlink: ${rel}`);
  }

  if (info.isFile()) {
    const bytes = await readFile(absolute);
    return {
      path: rel,
      type: "file",
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }
  if (!info.isDirectory()) {
    throw new Error(`unsupported artifact type: ${rel}`);
  }

  const entries = [];
  async function walk(directory) {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const child = resolve(directory, name);
      const childInfo = await lstat(child);
      if (childInfo.isSymbolicLink()) {
        throw new Error(
          `artifact contains symlink: ${normalizePath(relative(root, child))}`,
        );
      }
      if (childInfo.isDirectory()) {
        await walk(child);
      } else if (childInfo.isFile()) {
        const bytes = await readFile(child);
        entries.push({
          path: normalizePath(relative(absolute, child)),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      } else {
        throw new Error(
          `artifact contains unsupported entry: ${normalizePath(relative(root, child))}`,
        );
      }
    }
  }
  await walk(absolute);
  const digestInput = entries
    .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
    .join("");
  return {
    path: rel,
    type: "directory",
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    sha256: sha256(Buffer.from(digestInput)),
  };
}

async function workspaceIdentity(root) {
  const packageJsonBytes = await readFile(resolve(root, "package.json"));
  const lockfileBytes = await readFile(resolve(root, "pnpm-lock.yaml"));
  const workspaceBytes = await readFile(resolve(root, "pnpm-workspace.yaml"));
  const pkg = JSON.parse(packageJsonBytes.toString("utf8"));
  return {
    name: pkg.name,
    version: pkg.version,
    private: pkg.private === true,
    packageManager: pkg.packageManager,
    engines: pkg.engines ?? {},
    packageJsonSha256: sha256(packageJsonBytes),
    lockfileSha256: sha256(lockfileBytes),
    workspaceSha256: sha256(workspaceBytes),
  };
}

export async function generateProvenance({
  root,
  artifacts,
  output,
  buildCommand = "pnpm build",
  profile = "production",
}) {
  if (!artifacts.length) {
    throw new Error("at least one --artifact is required");
  }
  const rootReal = await realpath(root);
  const outputAbs = resolve(rootReal, output);
  const outputRel = assertInside(rootReal, outputAbs, "provenance output");
  assertCleanSource(rootReal, new Set([outputRel]));
  const remote = assertPublicRemote(rootReal);

  const artifactRecords = [];
  for (const artifact of [...new Set(artifacts)].sort()) {
    const normalized = normalizePath(
      relative(rootReal, resolve(rootReal, artifact)),
    );
    for (const privateRepository of PRIVATE_REPOSITORIES) {
      if (normalized.includes(privateRepository.split("/").at(-1))) {
        throw new Error(
          `private Portal content cannot be attested by public provenance: ${normalized}`,
        );
      }
    }
    artifactRecords.push(await hashPath(rootReal, artifact));
  }

  const document = {
    schema: SCHEMA,
    repository: {
      slug: PUBLIC_REPOSITORY,
      origin: remote,
      revision: git(rootReal, ["rev-parse", "HEAD"]),
      tree: git(rootReal, ["rev-parse", "HEAD^{tree}"]),
    },
    workspace: await workspaceIdentity(rootReal),
    build: { profile, command: buildCommand },
    artifacts: artifactRecords.sort((a, b) => a.path.localeCompare(b.path)),
    boundary: {
      publicRepositoryOnly: true,
      excludedPrivateRepositories: PRIVATE_REPOSITORIES,
    },
  };
  await writeFile(outputAbs, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
}

export async function verifyProvenance({ root, output }) {
  const rootReal = await realpath(root);
  const outputAbs = resolve(rootReal, output);
  assertInside(rootReal, outputAbs, "provenance output");
  const document = JSON.parse(await readFile(outputAbs, "utf8"));
  if (document.schema !== SCHEMA) {
    throw new Error(`unsupported provenance schema: ${document.schema}`);
  }
  assertCleanSource(
    rootReal,
    new Set([normalizePath(relative(rootReal, outputAbs))]),
  );
  const remote = assertPublicRemote(rootReal);
  if (
    document.repository?.slug !== PUBLIC_REPOSITORY ||
    document.repository?.origin !== remote
  ) {
    throw new Error(
      "provenance repository identity does not match the public Totem checkout",
    );
  }
  const revision = git(rootReal, ["rev-parse", "HEAD"]);
  const tree = git(rootReal, ["rev-parse", "HEAD^{tree}"]);
  if (
    document.repository.revision !== revision ||
    document.repository.tree !== tree
  ) {
    throw new Error("provenance source revision/tree is stale");
  }
  const workspace = await workspaceIdentity(rootReal);
  if (JSON.stringify(document.workspace) !== JSON.stringify(workspace)) {
    throw new Error("provenance workspace/lockfile identity is stale");
  }
  if (!document.boundary?.publicRepositoryOnly) {
    throw new Error("public/private release boundary is not asserted");
  }
  if (
    JSON.stringify(document.boundary.excludedPrivateRepositories) !==
    JSON.stringify(PRIVATE_REPOSITORIES)
  ) {
    throw new Error(
      "private Portal repository exclusions are missing or stale",
    );
  }
  if (!Array.isArray(document.artifacts) || document.artifacts.length === 0) {
    throw new Error("provenance has no artifacts");
  }
  for (const expected of document.artifacts) {
    const actual = await hashPath(rootReal, expected.path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`artifact digest drift: ${expected.path}`);
    }
  }
  return document;
}

function parseArgs(argv) {
  const args = { artifacts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--artifact") {
      index += 1;
      args.artifacts.push(argv[index]);
    } else if (value === "--output") {
      index += 1;
      args.output = argv[index];
    } else if (value === "--build-command") {
      index += 1;
      args.buildCommand = argv[index];
    } else if (value === "--profile") {
      index += 1;
      args.profile = argv[index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  if (!args.output) {
    throw new Error("--output is required");
  }
  const root = process.cwd();
  if (command === "generate") {
    await generateProvenance({ root, ...args });
  } else if (command === "verify") {
    await verifyProvenance({ root, output: args.output });
  } else {
    throw new Error(
      "usage: release-provenance.mjs <generate|verify> --output <path> [--artifact <path> ...]",
    );
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-provenance] ${error.message}`);
    process.exitCode = 1;
  });
}
