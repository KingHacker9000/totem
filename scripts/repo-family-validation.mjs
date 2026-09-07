import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const manifestUrl = new URL(
  "../release/repo-family-validation.json",
  import.meta.url,
);
const releaseRepositoriesUrl = new URL(
  "../release/public-repositories.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const releaseRepositories = JSON.parse(
  await readFile(releaseRepositoriesUrl, "utf8"),
);

const execute = process.argv.includes("--execute");
const remote = execute || process.argv.includes("--remote");
const keep = process.argv.includes("--keep");
const failures = [];
const selfRepository = "KingHacker9000/totem";
const fullCommitPattern = /^[0-9a-f]{40}$/;

function fail(message) {
  failures.push(message);
}

function assertStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    return;
  }
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      fail(`${label} contains a non-string/empty item`);
    }
  }
}

function assertCommand(value, label) {
  assertStringArray(value, label);
}

if (manifest.schema !== "totem.repo-family-validation/v1") {
  fail(`unexpected schema: ${manifest.schema}`);
}
if (manifest.credential_free !== true) {
  fail("repo-family validation must remain credential-free");
}
if (!manifest.default_ref) {
  fail("default_ref is required");
}

const privateBoundary = new Set(manifest.excluded_private_repositories ?? []);
for (const required of [
  "KingHacker9000/totem-portal-theme",
  "KingHacker9000/totem-portal-hardware",
]) {
  if (!privateBoundary.has(required)) {
    fail(`missing private repository boundary: ${required}`);
  }
}

const entries = manifest.repositories ?? [];
const entryNames = new Set();
for (const entry of entries) {
  if (!entry.repo?.startsWith("KingHacker9000/totem")) {
    fail(`invalid repository identity: ${entry.repo}`);
    continue;
  }
  if (privateBoundary.has(entry.repo)) {
    fail(
      `private Portal repository leaked into public validation: ${entry.repo}`,
    );
  }
  if (entryNames.has(entry.repo)) {
    fail(`duplicate repository: ${entry.repo}`);
  }
  entryNames.add(entry.repo);
  if (entry.repo !== selfRepository && !fullCommitPattern.test(entry.revision ?? "")) {
    fail(`${entry.repo} must declare an exact 40-character lowercase commit revision`);
  }
  assertStringArray(entry.metadata, `${entry.repo} metadata`);
  if (entry.install !== null)
    assertCommand(entry.install, `${entry.repo} install`);
  if (!Array.isArray(entry.commands)) {
    fail(`${entry.repo} commands must be an array`);
  } else {
    entry.commands.forEach((command, index) => {
      assertCommand(command, `${entry.repo} commands[${index}]`);
    });
  }
  if (entry.kind === "node") {
    if (entry.runtime?.node !== ">=22.20.0") {
      fail(`${entry.repo} must declare the supported Node floor >=22.20.0`);
    }
    assertStringArray(
      entry.required_package_scripts,
      `${entry.repo} required_package_scripts`,
    );
  }
  if (entry.kind === "content" && !entry.justification) {
    fail(`${entry.repo} content-only exception needs a justification`);
  }
}

const releaseNames = new Set(
  (releaseRepositories.public_repositories ?? []).map((entry) => entry.repo),
);
for (const repo of entryNames) {
  if (!releaseNames.has(repo)) {
    fail(`${repo} is missing from release/public-repositories.json`);
  }
}
for (const repo of releaseNames) {
  if (!entryNames.has(repo)) {
    fail(`${repo} is missing from release/repo-family-validation.json`);
  }
}

function githubHeaders() {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "totem-repo-family-validation",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubContent(repo, metadataPath, ref) {
  const encodedPath = metadataPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function githubCommit(repo, ref) {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function validateRemoteEntry(entry) {
  const exactRef = entry.repo === selfRepository ? manifest.default_ref : entry.revision;
  for (const metadataPath of entry.metadata) {
    try {
      await githubContent(entry.repo, metadataPath, exactRef);
    } catch (error) {
      fail(`${entry.repo} missing ${metadataPath} at ${exactRef}: ${error.message}`);
    }
  }

  if (entry.repo !== selfRepository) {
    try {
      const defaultHead = await githubCommit(entry.repo, manifest.default_ref);
      if (defaultHead.sha !== entry.revision) {
        fail(
          `${entry.repo} remote drift: declared ${entry.revision}, ${manifest.default_ref} is ${defaultHead.sha}`,
        );
      }
    } catch (error) {
      fail(`${entry.repo} remote drift check failed: ${error.message}`);
    }
  }

  if (entry.kind !== "node") return;
  let payload;
  try {
    payload = await githubContent(entry.repo, "package.json", exactRef);
  } catch (error) {
    fail(`${entry.repo} package.json unavailable: ${error.message}`);
    return;
  }
  if (payload.type !== "file" || !payload.content) {
    fail(`${entry.repo} package.json is not a readable file`);
    return;
  }
  const pkg = JSON.parse(
    Buffer.from(payload.content, "base64").toString("utf8"),
  );
  if (pkg.engines?.node !== entry.runtime.node) {
    fail(
      `${entry.repo} Node engine drift: expected ${entry.runtime.node}, got ${pkg.engines?.node}`,
    );
  }
  for (const script of entry.required_package_scripts) {
    if (
      typeof pkg.scripts?.[script] !== "string" ||
      !pkg.scripts[script].trim()
    ) {
      fail(`${entry.repo} missing declared package script: ${script}`);
    }
  }
}

function run(command, cwd, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const [program, ...args] = command;
    let stdout = "";
    const child = spawn(program, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, CI: "true" },
    });
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(capture ? stdout.trim() : undefined);
      else
        reject(new Error(`exit=${code ?? "null"} signal=${signal ?? "none"}`));
    });
  });
}

async function currentSelfRevision() {
  return run(["git", "rev-parse", "HEAD"], process.cwd(), { capture: true });
}

async function checkoutExactRevision(entry, checkout, root, selfRevision) {
  const expectedRevision =
    entry.repo === selfRepository ? selfRevision : entry.revision;
  await run(["git", "init", checkout], root);
  await run(
    [
      "git",
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      `https://github.com/${entry.repo}.git`,
    ],
    root,
  );
  await run(
    [
      "git",
      "-C",
      checkout,
      "fetch",
      "--depth",
      "1",
      "origin",
      expectedRevision,
    ],
    root,
  );
  await run(
    ["git", "-C", checkout, "checkout", "--detach", "FETCH_HEAD"],
    root,
  );
  const actualRevision = await run(
    ["git", "-C", checkout, "rev-parse", "HEAD"],
    root,
    { capture: true },
  );
  if (actualRevision !== expectedRevision) {
    throw new Error(
      `${entry.repo} checkout identity mismatch: expected ${expectedRevision}, got ${actualRevision}`,
    );
  }
}

async function executeEntry(entry, root, selfRevision) {
  const repoName = entry.repo.split("/").at(-1);
  const checkout = path.join(root, repoName);
  console.log(`\n==> ${entry.repo}`);
  await checkoutExactRevision(entry, checkout, root, selfRevision);
  if (entry.install) await run(entry.install, checkout);
  for (const command of entry.commands) await run(command, checkout);
}

if (remote && failures.length === 0) {
  for (const entry of entries) await validateRemoteEntry(entry);
}

let executionRoot = null;
if (execute && failures.length === 0) {
  executionRoot = await mkdtemp(path.join(tmpdir(), "totem-repo-family-"));
  console.log(`Repo-family clean-checkout root: ${executionRoot}`);
  try {
    const selfRevision = await currentSelfRevision();
    if (!fullCommitPattern.test(selfRevision)) {
      throw new Error(`current Totem checkout did not resolve to a full commit: ${selfRevision}`);
    }
    for (const entry of entries) {
      await executeEntry(entry, executionRoot, selfRevision);
    }
  } catch (error) {
    fail(`clean-checkout execution failed: ${error.message}`);
  } finally {
    if (!keep) await rm(executionRoot, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error("Totem repo-family validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const mode = execute
    ? "pinned clean-checkout execution"
    : remote
      ? "remote drift"
      : "manifest";
  console.log(
    `Totem repo-family validation passed (${entries.length} public repos, ${mode}).`,
  );
  if (execute && keep && executionRoot) {
    console.log(`Kept clean checkouts at ${executionRoot}`);
  }
}
