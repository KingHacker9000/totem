#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseBundle, DEFAULT_OUTPUT as DEFAULT_BUNDLE } from "./release-bundle.mjs";
import { buildManifest as buildThirdPartyManifest } from "./third-party-manifest.mjs";

export const FORMAT = "CycloneDX";
export const SPEC_VERSION = "1.6";
export const DEFAULT_OUTPUT = "dist/release/totem-public.sbom.cdx.json";
export const ROOT_BOM_REF = "pkg:github/KingHacker9000/totem";

function slash(value) {
  return value.split(sep).join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function packagePurl(name, version) {
  if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
    throw new Error("SBOM runtime dependency is missing an exact name/version identity.");
  }
  if (version === "unknown") {
    throw new Error(`SBOM runtime dependency ${name} has unknown version.`);
  }
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function sortedProperties(properties) {
  return properties
    .filter((entry) => entry.value !== null && entry.value !== undefined)
    .map((entry) => ({ name: entry.name, value: String(entry.value) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCycloneDx({ bundleManifest, thirdPartyManifest, thirdPartyBytes }) {
  if (bundleManifest?.schema !== "totem.public-release-bundle/v1") {
    throw new Error("SBOM requires a totem.public-release-bundle/v1 manifest.");
  }
  if (thirdPartyManifest?.schema !== "totem.third-party-release-manifest/v1") {
    throw new Error("SBOM requires a totem.third-party-release-manifest/v1 manifest.");
  }
  if (bundleManifest.repository !== thirdPartyManifest.source?.repository) {
    throw new Error("SBOM source repository identity differs between release and third-party manifests.");
  }
  if (bundleManifest.source?.revision !== thirdPartyManifest.source?.revision) {
    throw new Error("SBOM source revision differs between release and third-party manifests.");
  }
  if (!/^[0-9a-f]{64}$/.test(bundleManifest.source?.tree ?? "")) {
    throw new Error("SBOM release bundle is missing an exact source tree identity.");
  }
  if (!/^[0-9a-f]{64}$/.test(bundleManifest.digest?.value ?? "")) {
    throw new Error("SBOM release bundle is missing an exact SHA-256 artifact digest.");
  }
  if (!/^[0-9a-f]{64}$/.test(thirdPartyManifest.source?.lockfileSha256 ?? "")) {
    throw new Error("SBOM third-party manifest is missing the lockfile SHA-256 identity.");
  }
  if (thirdPartyManifest.boundaries?.publicReleaseOnly !== true) {
    throw new Error("SBOM third-party dependency boundary is not marked public-release-only.");
  }
  if (
    thirdPartyManifest.boundaries?.excludedPrivateRepositories?.some((name) =>
      /totem-portal-(?:theme|hardware)/i.test(String(name)),
    ) !== true
  ) {
    throw new Error("SBOM third-party manifest does not record the private Portal exclusion boundary.");
  }

  const runtime = thirdPartyManifest.dependencies?.runtimeOrBundledCandidates;
  if (!Array.isArray(runtime)) {
    throw new Error("SBOM third-party manifest is missing runtime dependency candidates.");
  }

  const seen = new Set();
  const components = runtime
    .map((entry) => {
      const purl = packagePurl(entry.name, entry.version);
      if (seen.has(purl)) throw new Error(`Duplicate SBOM runtime component: ${purl}`);
      seen.add(purl);
      return {
        type: "library",
        "bom-ref": purl,
        name: entry.name,
        version: entry.version,
        purl,
        scope: "required",
        properties: sortedProperties([
          { name: "totem:dependency-identity", value: entry.identity },
          { name: "totem:direct-spec", value: entry.directSpec },
        ]),
      };
    })
    .sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));

  const thirdPartyText = thirdPartyBytes
    ? Buffer.from(thirdPartyBytes)
    : Buffer.from(canonicalJson(thirdPartyManifest), "utf8");
  const rootRef = `${ROOT_BOM_REF}@${bundleManifest.source.revision}`;

  return {
    bomFormat: FORMAT,
    specVersion: SPEC_VERSION,
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        group: "KingHacker9000",
        name: "totem",
        version: bundleManifest.source.revision,
        properties: sortedProperties([
          { name: "totem:repository", value: bundleManifest.repository },
          { name: "totem:source-revision", value: bundleManifest.source.revision },
          { name: "totem:source-tree", value: bundleManifest.source.tree },
          { name: "totem:release-bundle-sha256", value: bundleManifest.digest.value },
          { name: "totem:lockfile-sha256", value: thirdPartyManifest.source.lockfileSha256 },
          { name: "totem:third-party-manifest-sha256", value: sha256(thirdPartyText) },
          { name: "totem:release-boundary", value: "public-only" },
        ]),
      },
      properties: sortedProperties([
        { name: "totem:sbom-generator", value: "scripts/release-sbom.mjs" },
        { name: "totem:runtime-scope-source", value: "totem.third-party-release-manifest/v1" },
        { name: "totem:artifact-identity-source", value: "totem.public-release-bundle/v1" },
      ]),
    },
    components,
    dependencies: [
      {
        ref: rootRef,
        dependsOn: components.map((component) => component["bom-ref"]),
      },
    ],
  };
}

export function assertSbomMatches(expected, actual) {
  if (actual?.bomFormat !== FORMAT || actual?.specVersion !== SPEC_VERSION) {
    throw new Error(`Expected CycloneDX ${SPEC_VERSION} SBOM.`);
  }
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error("Release SBOM is stale or does not match the exact current release artifact/dependency boundary.");
  }
}

async function buildCurrent({ root, bundleOutput = DEFAULT_BUNDLE, output = DEFAULT_OUTPUT }) {
  const bundleManifest = await buildReleaseBundle({ root, output: bundleOutput });
  const thirdPartyPath = resolve(root, "dist/release/third-party-manifest.json");
  const thirdPartyManifest = await buildThirdPartyManifest({
    rootDir: root,
    outputPath: thirdPartyPath,
    sourceRevision: bundleManifest.source.revision,
  });
  const thirdPartyBytes = Buffer.from(canonicalJson(thirdPartyManifest), "utf8");
  const sbom = buildCycloneDx({ bundleManifest, thirdPartyManifest, thirdPartyBytes });
  const outputPath = resolve(root, output);
  const rel = relative(root, outputPath);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("SBOM output must stay inside the Totem checkout.");
  }
  return { sbom, outputPath, thirdPartyBytes };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.output = argv[++index];
    else if (value === "--bundle") options.bundleOutput = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== "generate" && command !== "verify") {
    throw new Error("usage: release-sbom.mjs <generate|verify> [--output <path>] [--bundle <path>]");
  }
  const root = process.cwd();
  const options = parseArgs(argv);
  const { sbom, outputPath } = await buildCurrent({ root, ...options });

  if (command === "generate") {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, canonicalJson(sbom), "utf8");
    console.log(`Wrote ${slash(relative(root, outputPath))}`);
    return;
  }

  const actual = JSON.parse(await readFile(outputPath, "utf8"));
  assertSbomMatches(sbom, actual);
  console.log(`Verified ${slash(relative(root, outputPath))}`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-sbom] ${error.message}`);
    process.exitCode = 1;
  });
}
