import { readFile } from "node:fs/promises";
import process from "node:process";

const manifestUrl = new URL(
  "../release/public-repositories.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const remote = process.argv.includes("--remote");
const failures = [];

function fail(message) {
  failures.push(message);
}

if (manifest.schema !== "totem.release-repositories/v1") {
  fail(`unexpected schema: ${manifest.schema}`);
}
if (manifest.version_policy?.mode !== "independent-semver") {
  fail("version policy must be independent-semver");
}
if (!manifest.version_policy?.release_notes?.includes("CHANGELOG.md")) {
  fail("release-note source must name CHANGELOG.md");
}

const privateBoundary = new Set(manifest.excluded_private_repositories ?? []);
for (const required of [
  "KingHacker9000/totem-portal-theme",
  "KingHacker9000/totem-portal-hardware",
]) {
  if (!privateBoundary.has(required)) {
    fail(`missing private boundary: ${required}`);
  }
}

const repos = manifest.public_repositories ?? [];
const names = new Set();
for (const entry of repos) {
  if (!entry.repo?.startsWith("KingHacker9000/totem")) {
    fail(`invalid repo identity: ${entry.repo}`);
  }
  if (privateBoundary.has(entry.repo)) {
    fail(`private Portal repo leaked into public contract: ${entry.repo}`);
  }
  if (names.has(entry.repo)) fail(`duplicate repo: ${entry.repo}`);
  names.add(entry.repo);
  if (entry.package && !/^(@totem\/[a-z0-9-]+|totem)$/.test(entry.package)) {
    fail(`invalid package name: ${entry.package}`);
  }
  if (entry.version && !/^\d+\.\d+\.\d+$/.test(entry.version)) {
    fail(`invalid semver: ${entry.repo} ${entry.version}`);
  }
  if (entry.node && entry.node !== manifest.runtime.node) {
    fail(`runtime drift in manifest: ${entry.repo} ${entry.node}`);
  }
  if (entry.publishable && entry.private) {
    fail(`publishable package cannot be private: ${entry.repo}`);
  }
}

const local = repos.find((entry) => entry.repo === "KingHacker9000/totem");
const localPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
for (const [field, expected] of [
  ["name", local.package],
  ["version", local.version],
  ["private", local.private],
]) {
  if (localPackage[field] !== expected) {
    fail(
      `local package ${field} drift: expected ${expected}, got ${localPackage[field]}`,
    );
  }
}
if (localPackage.engines?.node !== local.node) {
  fail(
    `local Node engine drift: expected ${local.node}, got ${localPackage.engines?.node}`,
  );
}

if (remote) {
  for (const entry of repos.filter((candidate) => candidate.package)) {
    const url = `https://raw.githubusercontent.com/${entry.repo}/main/package.json`;
    let pkg;
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "totem-release-metadata-check" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      pkg = await response.json();
    } catch (error) {
      fail(`unable to fetch ${entry.repo}/package.json: ${error.message}`);
      continue;
    }
    for (const [field, expected] of [
      ["name", entry.package],
      ["version", entry.version],
      ["private", entry.private],
    ]) {
      if (pkg[field] !== expected) {
        fail(
          `${entry.repo} ${field} drift: expected ${expected}, got ${pkg[field]}`,
        );
      }
    }
    if (pkg.engines?.node !== entry.node) {
      fail(
        `${entry.repo} Node engine drift: expected ${entry.node}, got ${pkg.engines?.node}`,
      );
    }
  }
}

if (failures.length) {
  console.error("Totem release repository metadata check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Totem release repository metadata check passed (${repos.length} public repos${remote ? ", remote drift enabled" : ""}).`,
  );
}
