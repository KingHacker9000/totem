#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA = "totem.third-party-release-manifest/v1";
export const ARTIFACT_KIND = "totem.pi-source-release/v1";

const PRIVATE_REPOSITORIES = [
  "KingHacker9000/totem-portal-theme",
  "KingHacker9000/totem-portal-hardware",
];

const EXTERNALLY_SUPPLIED = [
  {
    id: "codex-cli",
    kind: "executable",
    locator: "codex",
    bundled: false,
    note: "Agent runtime supplied and authenticated by the operator environment.",
  },
  {
    id: "claude-code-cli",
    kind: "executable",
    locator: "claude",
    bundled: false,
    note: "Agent runtime supplied and authenticated by the operator environment.",
  },
  {
    id: "whisper-cpp",
    kind: "executable",
    locator: "whisper.cpp/whisper-cli",
    bundled: false,
    note: "Optional local speech executable supplied separately by the operator.",
  },
  {
    id: "piper",
    kind: "executable",
    locator: "piper",
    bundled: false,
    note: "Optional local speech executable supplied separately by the operator.",
  },
  {
    id: "speech-models-and-voices",
    kind: "model",
    locator: "operator-configured filesystem paths",
    bundled: false,
    note: "Speech models and voices are user-supplied unless a future release explicitly packages them.",
  },
];

function slash(value) {
  return value.split(sep).join("/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function run(command, args, cwd, shell = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseJsonOutput(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${context} JSON: ${error.message}`);
  }
}

export function flattenPnpmList(listing, workspaceNames = new Set()) {
  const result = new Map();

  function visitDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== "object") return;

    for (const [fallbackName, node] of Object.entries(dependencies)) {
      if (!node || typeof node !== "object") continue;
      const name = typeof node.name === "string" ? node.name : fallbackName;
      const version =
        typeof node.version === "string"
          ? node.version
          : typeof node.from === "string"
            ? node.from
            : "unknown";

      if (!workspaceNames.has(name)) {
        const key = `${name}@${version}`;
        result.set(key, {
          name,
          version,
        });
      }

      visitDependencies(node.dependencies);
      visitDependencies(node.optionalDependencies);
      visitDependencies(node.devDependencies);
    }
  }

  for (const workspace of Array.isArray(listing) ? listing : [listing]) {
    if (!workspace || typeof workspace !== "object") continue;
    visitDependencies(workspace.dependencies);
    visitDependencies(workspace.optionalDependencies);
    visitDependencies(workspace.devDependencies);
  }

  return result;
}

export function classifyDependencyGraphs({
  runtimeListing,
  fullListing,
  workspaceNames,
  directSpecs,
}) {
  const runtime = flattenPnpmList(runtimeListing, workspaceNames);
  const full = flattenPnpmList(fullListing, workspaceNames);

  const decorate = ([key, entry]) => ({
    ...entry,
    directSpec: directSpecs.get(entry.name) ?? null,
    identity: key,
  });

  const runtimePackages = [...runtime.entries()].map(decorate).sort(byIdentity);
  const buildDevPackages = [...full.entries()]
    .filter(([key]) => !runtime.has(key))
    .map(decorate)
    .sort(byIdentity);

  return { runtimePackages, buildDevPackages };
}

function byIdentity(a, b) {
  return a.identity.localeCompare(b.identity);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function discoverWorkspaces(rootDir) {
  const workspaces = [];
  for (const parent of ["apps", "packages"]) {
    const parentPath = resolve(rootDir, parent);
    let entries;
    try {
      entries = await readdir(parentPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packagePath = resolve(parentPath, entry.name, "package.json");
      try {
        const manifest = await readJson(packagePath);
        workspaces.push({
          path: slash(relative(rootDir, dirname(packagePath))),
          manifest,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return workspaces.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertPublicBoundary(packageManifests) {
  const forbidden = /totem-portal-(?:theme|hardware)/i;
  for (const { path, manifest } of packageManifests) {
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "devDependencies",
    ]) {
      for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
        if (forbidden.test(name) || forbidden.test(String(spec))) {
          throw new Error(
            `Private Portal dependency crossed the public release boundary in ${path}: ${section}.${name}`,
          );
        }
      }
    }
  }
}

function collectDirectSpecs(packageManifests) {
  const specs = new Map();
  for (const { manifest } of packageManifests) {
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "devDependencies",
    ]) {
      for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
        if (!specs.has(name)) specs.set(name, String(spec));
      }
    }
  }
  return specs;
}

async function hashSourceSnapshot(rootDir, outputPath) {
  const outputRelative = slash(relative(rootDir, outputPath));
  const excludedDirectoryNames = new Set([".git", "node_modules", "dist"]);
  const entries = [];

  async function walk(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (child.isDirectory() && excludedDirectoryNames.has(child.name))
        continue;
      const absolute = resolve(directory, child.name);
      const rel = slash(relative(rootDir, absolute));
      if (rel === outputRelative) continue;
      if (child.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!child.isFile()) continue;
      const content = await readFile(absolute);
      entries.push({
        path: rel,
        size: content.byteLength,
        sha256: sha256(content),
      });
    }
  }

  await walk(rootDir);
  const canonical = entries
    .map((entry) => `${entry.path}\0${entry.size}\0${entry.sha256}`)
    .join("\n");
  return {
    sha256: sha256(Buffer.from(canonical, "utf8")),
    fileCount: entries.length,
  };
}

function resolveSourceRevision(rootDir, override) {
  if (override) return override;
  try {
    return run("git", ["rev-parse", "HEAD"], rootDir);
  } catch {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    throw new Error(
      "Source revision is required when git metadata is unavailable; pass --source-revision.",
    );
  }
}

function pnpmListing(rootDir, productionOnly) {
  const args = productionOnly
    ? [
        "--filter",
        "./apps/*",
        "list",
        "--json",
        "--depth",
        "Infinity",
        "--prod",
      ]
    : ["list", "--recursive", "--json", "--depth", "Infinity"];
  const raw = run("pnpm", args, rootDir, process.platform === "win32");
  return parseJsonOutput(
    raw || "[]",
    productionOnly ? "production dependency graph" : "full dependency graph",
  );
}

export async function buildManifest({
  rootDir = process.cwd(),
  outputPath = resolve(rootDir, "release/third-party-manifest.json"),
  sourceRevision,
  runtimeListing,
  fullListing,
} = {}) {
  rootDir = resolve(rootDir);
  outputPath = resolve(outputPath);

  const rootManifest = await readJson(resolve(rootDir, "package.json"));
  const workspaces = await discoverWorkspaces(rootDir);
  const packageManifests = [
    { path: ".", manifest: rootManifest },
    ...workspaces,
  ];
  assertPublicBoundary(packageManifests);

  const workspaceNames = new Set(
    workspaces
      .map(({ manifest }) => manifest.name)
      .filter((name) => typeof name === "string"),
  );
  const directSpecs = collectDirectSpecs(packageManifests);
  const graphs = classifyDependencyGraphs({
    runtimeListing: runtimeListing ?? pnpmListing(rootDir, true),
    fullListing: fullListing ?? pnpmListing(rootDir, false),
    workspaceNames,
    directSpecs,
  });

  const lockfile = await readFile(resolve(rootDir, "pnpm-lock.yaml"));
  const snapshot = await hashSourceSnapshot(rootDir, outputPath);

  return {
    schema: SCHEMA,
    artifact: {
      kind: ARTIFACT_KIND,
      installBoundary:
        "deploy/pi/install.sh source copy excluding .git, node_modules, and dist",
      sourceSnapshotSha256: snapshot.sha256,
      sourceFileCount: snapshot.fileCount,
    },
    source: {
      repository: "KingHacker9000/totem",
      revision: resolveSourceRevision(rootDir, sourceRevision),
      packageManager: rootManifest.packageManager ?? null,
      lockfileSha256: sha256(lockfile),
    },
    dependencies: {
      runtimeOrBundledCandidates: graphs.runtimePackages,
      buildOrDevelopmentOnly: graphs.buildDevPackages,
    },
    externallySupplied: EXTERNALLY_SUPPLIED,
    boundaries: {
      publicReleaseOnly: true,
      excludedPrivateRepositories: PRIVATE_REPOSITORIES,
      statement:
        "Private Portal theme/hardware repositories and assets are outside this public release manifest.",
    },
    policy: {
      licenseSelection: "UNRESOLVED_T913",
      noticeDecision: "REQUIRES_ARTIFACT_SPECIFIC_UPSTREAM_REVIEW",
      statement:
        "This manifest inventories redistribution candidates only; it does not select a Totem license or determine upstream notice obligations.",
    },
  };
}

export function assertManifestShape(manifest) {
  if (!manifest || manifest.schema !== SCHEMA)
    throw new Error(`Expected schema ${SCHEMA}.`);
  if (manifest.artifact?.kind !== ARTIFACT_KIND)
    throw new Error(`Expected artifact kind ${ARTIFACT_KIND}.`);
  if (!/^[0-9a-f]{64}$/.test(manifest.artifact?.sourceSnapshotSha256 ?? "")) {
    throw new Error(
      "Manifest is missing a valid artifact sourceSnapshotSha256.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.source?.lockfileSha256 ?? "")) {
    throw new Error("Manifest is missing a valid source lockfileSha256.");
  }
  if (
    typeof manifest.source?.revision !== "string" ||
    manifest.source.revision.length < 7
  ) {
    throw new Error("Manifest is missing an exact source revision.");
  }
  if (!Array.isArray(manifest.dependencies?.runtimeOrBundledCandidates)) {
    throw new Error("Manifest is missing runtime dependency candidates.");
  }
  if (!Array.isArray(manifest.dependencies?.buildOrDevelopmentOnly)) {
    throw new Error(
      "Manifest is missing build/development dependency candidates.",
    );
  }
  if (manifest.externallySupplied?.some((entry) => entry.bundled !== false)) {
    throw new Error(
      "Externally supplied executables/models must not be marked as bundled.",
    );
  }
  if (manifest.policy?.licenseSelection !== "UNRESOLVED_T913") {
    throw new Error(
      "Third-party manifest must not infer or select the Totem project license.",
    );
  }
}

export function assertManifestMatches(expected, actual) {
  assertManifestShape(expected);
  assertManifestShape(actual);
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  const actualText = `${JSON.stringify(actual, null, 2)}\n`;
  if (expectedText !== actualText) {
    throw new Error(
      "Third-party release manifest is stale or mismatched with the current source/artifact dependency graph.",
    );
  }
}

function parseArgs(argv) {
  const command = argv[0] ?? "generate";
  let output;
  let sourceRevision;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "--out") {
      output = argv[++index];
    } else if (arg === "--source-revision") {
      sourceRevision = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { command, output, sourceRevision };
}

async function main() {
  const { command, output, sourceRevision } = parseArgs(
    process.argv.slice(2),
  );
  const rootDir = process.cwd();
  const outputPath = resolve(
    rootDir,
    output ?? "release/third-party-manifest.json",
  );

  if (command === "generate") {
    const manifest = await buildManifest({ rootDir, outputPath, sourceRevision });
    assertManifestShape(manifest);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`Wrote ${slash(relative(rootDir, outputPath))}`);
    return;
  }

  if (command === "verify") {
    const expected = await readJson(outputPath);
    const actual = await buildManifest({ rootDir, outputPath, sourceRevision });
    assertManifestMatches(expected, actual);
    console.log(`Verified ${slash(relative(rootDir, outputPath))}`);
    return;
  }

  throw new Error(`Unknown command: ${command}. Expected generate or verify.`);
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
