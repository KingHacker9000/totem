#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const BACKUP_ID_PATTERN = /^\d{8}T\d{6}\.\d{3}Z$/;
const MANIFEST_SCHEMA = "totem.backup/v0";

function backupId(now) {
  return now.toISOString().replace(/[-:]/g, "");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function collectFiles(root) {
  const files = [];

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const item = await lstat(absolute);
      if (item.isSymbolicLink()) {
        throw new Error(`Backup state contains unsupported symbolic link: ${absolute}`);
      }
      if (item.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!item.isFile()) {
        throw new Error(`Backup state contains unsupported filesystem entry: ${absolute}`);
      }
      files.push({
        path: relative(root, absolute).replaceAll("\\", "/"),
        size: item.size,
        sha256: await sha256File(absolute),
      });
    }
  }

  await visit(root);
  return files;
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error(`Unsupported backup manifest schema; expected ${MANIFEST_SCHEMA}.`);
  }
  if (!BACKUP_ID_PATTERN.test(manifest.id ?? "")) {
    throw new Error("Backup manifest has an invalid id.");
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error(
      "Backup manifest has no integrity inventory. Legacy/online snapshots must not be used for release-grade restore.",
    );
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      file.path.startsWith("/") ||
      file.path.includes("..") ||
      typeof file.size !== "number" ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")
    ) {
      throw new Error("Backup manifest contains an invalid file inventory entry.");
    }
  }
}

export async function verifyBackupDirectory(backupDir) {
  const manifestPath = join(backupDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Backup manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateManifestShape(manifest);
  if (basename(backupDir) !== manifest.id) {
    throw new Error("Backup directory name does not match manifest id.");
  }

  const snapshotDir = join(backupDir, "state");
  if (!(await pathExists(snapshotDir))) {
    throw new Error("Backup snapshot state directory is missing.");
  }
  const actual = await collectFiles(snapshotDir);
  const expected = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Backup integrity verification failed: snapshot contents differ from manifest.");
  }

  const totalBytes = actual.reduce((sum, file) => sum + file.size, 0);
  if (
    manifest.integrity?.algorithm !== "sha256" ||
    manifest.integrity?.fileCount !== actual.length ||
    manifest.integrity?.totalBytes !== totalBytes
  ) {
    throw new Error("Backup integrity summary does not match snapshot contents.");
  }
  return manifest;
}

export async function assertSystemdServiceStopped(serviceName = "totem.service") {
  try {
    const { stdout } = await execFileAsync("systemctl", ["is-active", serviceName]);
    const state = stdout.trim();
    throw new Error(`Refusing recovery operation: ${serviceName} is ${state || "active"}.`);
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    if (stdout === "inactive" || stdout === "failed") {
      return;
    }
    if (error instanceof Error && error.message.startsWith("Refusing recovery operation:")) {
      throw error;
    }
    throw new Error(
      `Could not prove ${serviceName} is stopped; recovery fails closed. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createQuiescedBackup({
  root,
  stateDir,
  now = new Date(),
  assertStopped = () => assertSystemdServiceStopped(),
}) {
  await assertStopped();
  if (!(await pathExists(stateDir))) {
    throw new Error(`State directory does not exist: ${stateDir}`);
  }
  const id = backupId(now);
  const backupDir = join(root, "backups", id);
  if (await pathExists(backupDir)) {
    throw new Error(`Backup '${id}' already exists.`);
  }
  await mkdir(backupDir, { recursive: true });
  const snapshotDir = join(backupDir, "state");
  await cp(stateDir, snapshotDir, { recursive: true, force: false });
  const files = await collectFiles(snapshotDir);
  const entries = (await readdir(snapshotDir)).map(String).sort();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    id,
    createdAt: now.toISOString(),
    source: stateDir,
    captureMode: "quiesced",
    entries,
    files,
    integrity: {
      algorithm: "sha256",
      fileCount: files.length,
      totalBytes,
    },
  };
  await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await verifyBackupDirectory(backupDir);
  return { backupDir, manifest };
}

export async function restoreVerifiedBackup({
  backupDir,
  stateDir,
  now = new Date(),
  assertStopped = () => assertSystemdServiceStopped(),
}) {
  await assertStopped();
  const manifest = await verifyBackupDirectory(backupDir);
  const parent = dirname(stateDir);
  await mkdir(parent, { recursive: true });
  const suffix = backupId(now);
  const staging = `${stateDir}.restore-staging.${suffix}`;
  const preserved = `${stateDir}.pre-restore.${suffix}`;
  await rm(staging, { recursive: true, force: true });
  if (await pathExists(preserved)) {
    throw new Error(`Pre-restore preservation path already exists: ${preserved}`);
  }
  await cp(join(backupDir, "state"), staging, { recursive: true, force: false });

  const hadLiveState = await pathExists(stateDir);
  try {
    if (hadLiveState) {
      await rename(stateDir, preserved);
    }
    await rename(staging, stateDir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (hadLiveState && !(await pathExists(stateDir)) && (await pathExists(preserved))) {
      await rename(preserved, stateDir);
    }
    throw error;
  }

  return {
    schema: "totem.restore-result/v0",
    backupId: manifest.id,
    restoredState: stateDir,
    preservedState: hadLiveState ? preserved : null,
    next: [
      "Start Totem core service.",
      "Run pnpm validate:pi and confirm readiness/self-test success.",
      "Retain the pre-restore state until the recovered installation has been validated.",
    ],
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument sequence near '${key ?? "<end>"}'.`);
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "verify") {
    if (!options.backup) throw new Error("verify requires --backup <directory>.");
    const manifest = await verifyBackupDirectory(options.backup);
    console.log(JSON.stringify({ ok: true, backupId: manifest.id }, null, 2));
    return;
  }
  if (command === "backup") {
    if (!options.root || !options.state) {
      throw new Error("backup requires --root <Totem root> --state <state directory>.");
    }
    const result = await createQuiescedBackup({
      root: options.root,
      stateDir: options.state,
      assertStopped: () => assertSystemdServiceStopped(options.service ?? "totem.service"),
    });
    console.log(JSON.stringify({ ok: true, backup: result.backupDir }, null, 2));
    return;
  }
  if (command === "restore") {
    if (!options.backup || !options.state) {
      throw new Error("restore requires --backup <directory> --state <state directory>.");
    }
    const result = await restoreVerifiedBackup({
      backupDir: options.backup,
      stateDir: options.state,
      assertStopped: () => assertSystemdServiceStopped(options.service ?? "totem.service"),
    });
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    return;
  }
  throw new Error("Usage: state-recovery.mjs <backup|verify|restore> [options]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
