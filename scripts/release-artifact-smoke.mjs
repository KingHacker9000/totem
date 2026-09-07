#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const RELEASE_SCHEMA = "totem.public-release-bundle/v1";
const MANIFEST_NAME = "release-manifest.json";

function normalize(value) {
  return value.split(path.sep).join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) {
    return;
  }
  throw new Error(`${label} escapes artifact root: ${candidate}`);
}

async function listFiles(root) {
  const result = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const info = await stat(absolute);
      if (info.isDirectory()) {
        await walk(absolute);
      } else if (info.isFile()) {
        result.push(normalize(path.relative(root, absolute)));
      } else {
        throw new Error(
          `unsupported artifact entry: ${normalize(path.relative(root, absolute))}`,
        );
      }
    }
  }
  await walk(root);
  return result;
}

export async function verifyPortableBundle(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const manifestPath = path.join(root, MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schema !== RELEASE_SCHEMA) {
    throw new Error(`unsupported release bundle schema: ${manifest.schema}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("release bundle manifest has no files");
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.source?.revision ?? "")) {
    throw new Error("release bundle source revision is missing or invalid");
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.source?.tree ?? "")) {
    throw new Error("release bundle source tree is missing or invalid");
  }

  const expectedPaths = new Set([MANIFEST_NAME]);
  const digestRows = [];
  for (const entry of manifest.files) {
    if (
      typeof entry.path !== "string" ||
      !["100644", "100755"].includes(entry.mode) ||
      !Number.isInteger(entry.bytes) ||
      !/^[0-9a-f]{64}$/i.test(entry.sha256 ?? "")
    ) {
      throw new Error(`invalid manifest entry: ${JSON.stringify(entry)}`);
    }
    const absolute = path.resolve(root, entry.path);
    assertInside(root, absolute, `manifest entry ${entry.path}`);
    const bytes = await readFile(absolute);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`release bundle file drift: ${entry.path}`);
    }
    expectedPaths.add(normalize(entry.path));
    digestRows.push(
      `${normalize(entry.path)}\0${entry.mode}\0${entry.bytes}\0${entry.sha256}\n`,
    );
  }

  const actualPaths = await listFiles(root);
  const unexpected = actualPaths.filter((entry) => !expectedPaths.has(entry));
  const missing = [...expectedPaths].filter((entry) => !actualPaths.includes(entry));
  if (unexpected.length || missing.length) {
    throw new Error(
      `release bundle file set mismatch; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`,
    );
  }

  const aggregate = sha256(Buffer.from(digestRows.join("")));
  if (manifest.digest?.algorithm !== "sha256" || manifest.digest?.value !== aggregate) {
    throw new Error("release bundle aggregate digest is invalid");
  }
  return manifest;
}

function sanitizedEnvironment() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("TOTEM_")) continue;
    if (/(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    env[name] = value;
  }
  return env;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: sanitizedEnvironment(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
        ),
      );
    });
  });
}

export async function smokeReleaseArtifact({ bundleRoot }) {
  const source = path.resolve(bundleRoot);
  await verifyPortableBundle(source);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "totem-release-artifact-"));
  const isolated = path.join(tempRoot, "totem-public");
  try {
    await cp(source, isolated, { recursive: true, errorOnExist: true });
    await verifyPortableBundle(isolated);

    const gitPath = path.join(isolated, ".git");
    try {
      await stat(gitPath);
      throw new Error("isolated release artifact unexpectedly contains .git metadata");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    await run("pnpm", ["install", "--frozen-lockfile"], isolated);
    await run("pnpm", ["build"], isolated);
    await run("pnpm", ["release:config:smoke"], isolated);

    return {
      schema: "totem.release-artifact-smoke/v1",
      ok: true,
      source_revision: (await verifyPortableBundle(source)).source.revision,
      isolated_from_checkout: true,
      credential_free: true,
      steps: [
        "portable-integrity-verify",
        "frozen-install",
        "production-build",
        "credential-free-startup",
      ],
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  let bundleRoot = "dist/release/totem-public";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--bundle") {
      index += 1;
      bundleRoot = argv[index];
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return { bundleRoot };
}

const { bundleRoot } = parseArgs(process.argv.slice(2));
smokeReleaseArtifact({ bundleRoot })
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(`[release-artifact-smoke] ${error.message}`);
    process.exitCode = 1;
  });
