#!/usr/bin/env node
import { lstat, readdir, readlink, realpath, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIB = 1024 * 1024;
export const DEFAULT_RETENTION = 2;
export const DEFAULT_MIN_FREE_MIB = 2048;

export function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer; received ${value}`);
  }
  return parsed;
}

export function chooseRetention({ releases, current, retain = DEFAULT_RETENTION }) {
  if (!Number.isSafeInteger(retain) || retain < 2) {
    throw new Error("release retention must be at least 2 (current + rollback)");
  }

  const ordered = [...releases].sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path));
  const currentEntry = ordered.find((entry) => entry.path === current);
  const rollback = ordered.find((entry) => entry.path !== current);
  const protectedPaths = new Set([currentEntry?.path, rollback?.path].filter(Boolean));

  for (const entry of ordered) {
    if (protectedPaths.size >= retain) break;
    protectedPaths.add(entry.path);
  }

  return {
    protected: ordered.filter((entry) => protectedPaths.has(entry.path)),
    prune: ordered.filter((entry) => !protectedPaths.has(entry.path)),
    rollback: rollback?.path ?? null,
  };
}

export function assertFreeSpace({ availableBytes, minFreeBytes, estimatedReleaseBytes = 0 }) {
  const required = minFreeBytes + estimatedReleaseBytes;
  if (availableBytes < required) {
    const availableMiB = Math.floor(availableBytes / MIB);
    const requiredMiB = Math.ceil(required / MIB);
    const reserveMiB = Math.ceil(minFreeBytes / MIB);
    const estimateMiB = Math.ceil(estimatedReleaseBytes / MIB);
    throw new Error(
      `insufficient free space: ${availableMiB} MiB available; need at least ${requiredMiB} MiB ` +
        `(${reserveMiB} MiB reserve + ${estimateMiB} MiB estimated release)`,
    );
  }
  return { availableBytes, requiredBytes: required };
}

async function resolveCurrent(prefix) {
  const currentLink = path.join(prefix, "current");
  try {
    const target = await readlink(currentLink);
    return await realpath(path.resolve(prefix, target));
  } catch {
    try {
      return await realpath(currentLink);
    } catch {
      return null;
    }
  }
}

async function listReleases(prefix) {
  const releasesDir = path.join(prefix, "releases");
  let names = [];
  try {
    names = await readdir(releasesDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const releases = [];
  for (const name of names) {
    const releasePath = path.join(releasesDir, name);
    const info = await stat(releasePath);
    if (info.isDirectory()) releases.push({ path: await realpath(releasePath), mtimeMs: info.mtimeMs });
  }
  return releases;
}

async function treeSize(root) {
  let apparentBytes = 0;
  let allocatedBytes = 0;

  async function visit(target) {
    const info = await lstat(target, { bigint: true });
    apparentBytes += Number(info.size);
    if (info.blocks !== undefined) allocatedBytes += Number(info.blocks) * 512;
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    for (const name of await readdir(target)) await visit(path.join(target, name));
  }

  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { apparentBytes, allocatedBytes };
}

async function availableBytes(target) {
  const fs = await statfs(target, { bigint: true });
  return Number(fs.bavail * fs.bsize);
}

function formatMiB(bytes) {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

async function prune(prefix, retain, dryRun = false) {
  const releases = await listReleases(prefix);
  const current = await resolveCurrent(prefix);
  const plan = chooseRetention({ releases, current, retain });

  for (const entry of plan.prune) {
    if (entry.path === current) throw new Error(`refusing to prune active release ${entry.path}`);
    if (!dryRun) await rm(entry.path, { recursive: true, force: false });
    console.log(`${dryRun ? "would prune" : "pruned"}: ${entry.path}`);
  }

  if (plan.rollback) console.log(`protected rollback: ${plan.rollback}`);
  if (current) console.log(`protected current: ${current}`);
  return plan;
}

async function preflight(prefix, sourceDir, minFreeMiB) {
  const releasesDir = path.join(prefix, "releases");
  const sourceSize = await treeSize(sourceDir);
  const free = await availableBytes(releasesDir);
  assertFreeSpace({
    availableBytes: free,
    minFreeBytes: minFreeMiB * MIB,
    estimatedReleaseBytes: sourceSize.allocatedBytes,
  });
  console.log(
    `disk preflight: ${formatMiB(free)} free; source ${formatMiB(sourceSize.apparentBytes)} apparent / ` +
      `${formatMiB(sourceSize.allocatedBytes)} allocated; reserve ${minFreeMiB} MiB`,
  );
}

async function report(prefix) {
  const releases = await listReleases(prefix);
  const current = await resolveCurrent(prefix);
  let totalApparent = 0;
  let totalAllocated = 0;
  for (const release of releases.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const size = await treeSize(release.path);
    totalApparent += size.apparentBytes;
    totalAllocated += size.allocatedBytes;
    console.log(
      `${release.path === current ? "*" : " "} ${release.path}: ${formatMiB(size.apparentBytes)} apparent / ` +
        `${formatMiB(size.allocatedBytes)} allocated`,
    );
  }
  console.log(`release total: ${formatMiB(totalApparent)} apparent / ${formatMiB(totalAllocated)} allocated`);
  console.log("Allocated size is the disk-usage signal; apparent size can overstate hard-linked pnpm content.");
}

async function main(argv) {
  const [command, ...args] = argv;
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const prefix = option("--prefix", process.env.TOTEM_PREFIX ?? "/opt/totem");

  if (command === "prune") {
    const retain = parsePositiveInteger(
      option("--retain", process.env.TOTEM_RELEASE_RETENTION),
      DEFAULT_RETENTION,
      "TOTEM_RELEASE_RETENTION",
    );
    await prune(prefix, retain, args.includes("--dry-run"));
    return;
  }
  if (command === "preflight") {
    const sourceDir = option("--source", process.cwd());
    const minFreeMiB = parsePositiveInteger(
      option("--min-free-mib", process.env.TOTEM_MIN_FREE_MIB),
      DEFAULT_MIN_FREE_MIB,
      "TOTEM_MIN_FREE_MIB",
    );
    await preflight(prefix, sourceDir, minFreeMiB);
    return;
  }
  if (command === "report") {
    await report(prefix);
    return;
  }

  throw new Error(
    "usage: release-policy.mjs <preflight|prune|report> [--prefix PATH] [--source PATH] [--retain N] [--min-free-mib N] [--dry-run]",
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release policy error: ${error.message}`);
    process.exitCode = 1;
  });
}
