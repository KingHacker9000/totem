import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const fullCommitPattern = /^[0-9a-f]{40}$/;
const manifestUrl = new URL(
  "../release/repo-family-validation.json",
  import.meta.url,
);

export function assertExactRevision(repo, revision) {
  if (!fullCommitPattern.test(revision ?? "")) {
    throw new Error(
      `${repo} must declare an exact 40-character lowercase commit revision`,
    );
  }
  return revision;
}

export function resolvePinnedEntries(manifest, requestedRepositories) {
  if (!Array.isArray(requestedRepositories) || requestedRepositories.length === 0) {
    throw new Error("at least one --repo is required");
  }
  const entries = new Map(
    (manifest.repositories ?? []).map((entry) => [entry.repo, entry]),
  );
  return requestedRepositories.map((repo) => {
    const entry = entries.get(repo);
    if (!entry) throw new Error(`${repo} is not declared in repo-family validation`);
    assertExactRevision(repo, entry.revision);
    return entry;
  });
}

export function assertCheckoutIdentity(repo, expectedRevision, actualRevision) {
  if (actualRevision !== expectedRevision) {
    throw new Error(
      `${repo} checkout identity mismatch: expected ${expectedRevision}, got ${actualRevision}`,
    );
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
      else reject(new Error(`exit=${code ?? "null"} signal=${signal ?? "none"}`));
    });
  });
}

async function checkoutEntry(entry, root) {
  const destination = path.join(root, entry.repo.split("/").at(-1));
  await run(["git", "init", destination], root);
  await run(
    [
      "git",
      "-C",
      destination,
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
      destination,
      "fetch",
      "--depth",
      "1",
      "origin",
      entry.revision,
    ],
    root,
  );
  await run(
    ["git", "-C", destination, "checkout", "--detach", "FETCH_HEAD"],
    root,
  );
  const actualRevision = await run(
    ["git", "-C", destination, "rev-parse", "HEAD"],
    root,
    { capture: true },
  );
  assertCheckoutIdentity(entry.repo, entry.revision, actualRevision);
  console.log(`${entry.repo} -> ${entry.revision}`);
}

function parseArgs(argv) {
  let root = null;
  const repositories = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      root = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--repo") {
      const repo = argv[index + 1];
      if (!repo) throw new Error("--repo requires a repository identity");
      repositories.push(repo);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!root) throw new Error("--root is required");
  return { root: path.resolve(root), repositories };
}

async function main() {
  const { root, repositories } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entries = resolvePinnedEntries(manifest, repositories);
  await mkdir(root, { recursive: true });
  for (const entry of entries) await checkoutEntry(entry, root);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Pinned repository checkout failed: ${error.message}`);
    process.exitCode = 1;
  });
}
