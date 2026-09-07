#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTarEntries } from "./release-archive.mjs";
import { assertPortablePathSet } from "./release-portable-path.mjs";

const DEFAULT_BUNDLE = "dist/release/totem-public";
const DEFAULT_ARCHIVE = "dist/release/totem-public.tar.gz";

export async function verifyBundlePortablePaths(bundle = DEFAULT_BUNDLE) {
  const manifest = JSON.parse(
    await readFile(resolve(bundle, "release-manifest.json"), "utf8"),
  );
  if (manifest?.schema !== "totem.public-release-bundle/v1") {
    throw new Error(`unsupported release bundle schema: ${manifest?.schema}`);
  }
  const paths = (manifest.files ?? []).map((entry) => entry.path);
  assertPortablePathSet(paths, "release bundle paths");
  return { kind: "bundle", count: paths.length };
}

export async function verifyArchivePortablePaths(archive = DEFAULT_ARCHIVE) {
  const entries = parseTarEntries(await readFile(resolve(archive)));
  const paths = entries
    .map((entry) => entry.path)
    .filter((path) => path !== ".");
  assertPortablePathSet(paths, "release archive paths");
  return { kind: "archive", count: paths.length };
}

function parseArgs(argv) {
  const [kind, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--bundle" || arg === "--archive") {
      index += 1;
      if (!rest[index]) throw new Error(`missing value for ${arg}`);
      options[arg.slice(2)] = rest[index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { kind, options };
}

async function main() {
  const { kind, options } = parseArgs(process.argv.slice(2));
  let result;
  if (kind === "bundle") {
    result = await verifyBundlePortablePaths(options.bundle);
  } else if (kind === "archive") {
    result = await verifyArchivePortablePaths(options.archive);
  } else {
    throw new Error(
      "usage: release-portable-path-check.mjs <bundle|archive> [--bundle path|--archive path]",
    );
  }
  console.log(`[release-portable-path] ${result.kind}: ${result.count} paths PASS`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-portable-path] ${error.message}`);
    process.exitCode = 1;
  });
}
