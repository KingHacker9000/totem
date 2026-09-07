#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseBundle, DEFAULT_OUTPUT } from "./release-bundle.mjs";

export const SCHEMA = "totem.release-reproducibility/v1";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function firstDifference(left, right, path = "$") {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || left === null || right === null) {
    return path;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) return `${path}.keys`;
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return path;
}

export function assertReproducibleManifests(left, right) {
  const difference = firstDifference(left, right);
  if (difference) {
    throw new Error(`release bundle reproducibility drift: ${difference}`);
  }
}

async function perturbTrackedMtimes(root, timestamp) {
  const output = git(root, ["ls-files", "-z"]);
  for (const path of output.split("\0").filter(Boolean)) {
    const absolute = resolve(root, path);
    const info = await stat(absolute);
    if (info.isFile()) await utimes(absolute, timestamp, timestamp);
  }
}

function assertClean(root) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (status) throw new Error(`reproducibility worktree is not clean: ${status}`);
}

async function loadManifest(root) {
  return JSON.parse(
    await readFile(resolve(root, DEFAULT_OUTPUT, "release-manifest.json"), "utf8"),
  );
}

async function addWorktree(sourceRoot, path, revision) {
  execFileSync("git", ["-C", sourceRoot, "worktree", "add", "--detach", path, revision], {
    stdio: "ignore",
  });
}

async function removeWorktree(sourceRoot, path) {
  try {
    execFileSync("git", ["-C", sourceRoot, "worktree", "remove", "--force", path], {
      stdio: "ignore",
    });
  } catch {
    await rm(path, { recursive: true, force: true });
    execFileSync("git", ["-C", sourceRoot, "worktree", "prune"], { stdio: "ignore" });
  }
}

function buildInIsolatedEnvironment(root, { lang, timezone, umask }) {
  execFileSync(process.execPath, [resolve(root, "scripts/release-reproducibility.mjs"), "build-one"], {
    cwd: root,
    env: {
      ...process.env,
      LANG: lang,
      LC_ALL: lang,
      TZ: timezone,
      TOTEM_REPRO_UMASK: umask,
    },
    stdio: "inherit",
  });
}

export async function checkReleaseReproducibility({ root = process.cwd(), revision = "HEAD" } = {}) {
  const sourceRoot = resolve(root);
  const resolvedRevision = git(sourceRoot, ["rev-parse", revision]);
  const temp = await mkdtemp(join(tmpdir(), "totem-release-repro-"));
  const leftRoot = join(temp, "checkout-a");
  const rightRoot = join(temp, "checkout-b-with-a-different-path");
  try {
    await addWorktree(sourceRoot, leftRoot, resolvedRevision);
    await addWorktree(sourceRoot, rightRoot, resolvedRevision);
    await perturbTrackedMtimes(leftRoot, new Date("2001-01-01T00:00:00Z"));
    await perturbTrackedMtimes(rightRoot, new Date("2031-12-31T23:59:58Z"));
    assertClean(leftRoot);
    assertClean(rightRoot);

    buildInIsolatedEnvironment(leftRoot, {
      lang: "C",
      timezone: "UTC",
      umask: "022",
    });
    buildInIsolatedEnvironment(rightRoot, {
      lang: "C.UTF-8",
      timezone: "Pacific/Honolulu",
      umask: "077",
    });

    const left = await loadManifest(leftRoot);
    const right = await loadManifest(rightRoot);
    assertReproducibleManifests(left, right);
    return {
      schema: SCHEMA,
      revision: resolvedRevision,
      tree: left.source.tree,
      digest: left.digest.value,
      files: left.files.length,
    };
  } finally {
    await removeWorktree(sourceRoot, leftRoot);
    await removeWorktree(sourceRoot, rightRoot);
    await rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === "build-one") {
    const requestedUmask = process.env.TOTEM_REPRO_UMASK ?? "022";
    if (!/^[0-7]{3}$/.test(requestedUmask)) throw new Error("invalid TOTEM_REPRO_UMASK");
    process.umask(Number.parseInt(requestedUmask, 8));
    await buildReleaseBundle({ root: process.cwd() });
    return;
  }
  if (command !== "check") {
    throw new Error("usage: release-reproducibility.mjs <check|build-one>");
  }
  const result = await checkReleaseReproducibility();
  console.log(
    `[release-reproducibility] ${result.files} files reproducible at ${result.revision} (${result.digest})`,
  );
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-reproducibility] ${error.message}`);
    process.exitCode = 1;
  });
}
