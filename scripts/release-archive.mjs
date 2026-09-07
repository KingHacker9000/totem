#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const SCHEMA = "totem.release-archive/v1";
export const DEFAULT_BUNDLE = "dist/release/totem-public";
export const DEFAULT_ARCHIVE = "dist/release/totem-public.tar.gz";
const MANIFEST_NAME = "release-manifest.json";

function parseOctal(buffer, start, length, label) {
  const raw = buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "")
    .trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`invalid tar ${label}: ${raw}`);
  return Number.parseInt(raw, 8);
}

function readString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "");
}

export function normalizeArchivePath(value) {
  const unix = value.replaceAll("\\", "/");
  if (unix.includes("\0") || isAbsolute(unix) || /^[A-Za-z]:\//.test(unix)) {
    throw new Error(`unsafe archive path: ${value}`);
  }
  const stripped = unix.replace(/^\.\//, "").replace(/\/$/, "");
  if (!stripped || stripped === ".") return ".";
  const normalized = posix.normalize(stripped);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe archive path: ${value}`);
  }
  return normalized;
}

function tarHeaderChecksum(header) {
  let checksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return checksum;
}

function assertZeroBytes(bytes, label) {
  if (!bytes.every((value) => value === 0)) {
    throw new Error(`non-zero tar ${label}`);
  }
}

export function inspectGzipHeader(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error("release archive is not gzip-compressed");
  }
  if (bytes[2] !== 8) {
    throw new Error(`unsupported gzip compression method: ${bytes[2]}`);
  }
  const flags = bytes[3];
  if (flags !== 0) {
    throw new Error(`non-deterministic gzip header flags: 0x${flags.toString(16)}`);
  }
  const mtime = bytes.readUInt32LE(4);
  if (mtime !== 0) {
    throw new Error(`non-deterministic gzip mtime: ${mtime}`);
  }
  return {
    compressionMethod: bytes[2],
    flags,
    mtime,
    extraFlags: bytes[8],
    operatingSystem: bytes[9],
  };
}

export function parseTarEntries(bytes) {
  const archive =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const entries = [];
  let offset = 0;

  while (offset < archive.length) {
    if (offset + 512 > archive.length) {
      throw new Error(`truncated tar header at offset ${offset}`);
    }

    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (offset + 1024 > archive.length) {
        throw new Error("truncated tar end marker");
      }
      assertZeroBytes(
        archive.subarray(offset + 512, offset + 1024),
        "end marker",
      );
      assertZeroBytes(archive.subarray(offset + 1024), "trailing data");
      return entries;
    }

    const expectedChecksum = parseOctal(header, 148, 8, "checksum");
    const actualChecksum = tarHeaderChecksum(header);
    if (expectedChecksum !== actualChecksum) {
      throw new Error(
        `tar header checksum mismatch at offset ${offset}: expected ${expectedChecksum} got ${actualChecksum}`,
      );
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const mode = parseOctal(header, 100, 8, "mode");
    const size = parseOctal(header, 124, 12, "size");
    const typeByte = header[156];
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const payloadStart = offset + 512;
    const payloadEnd = payloadStart + size;
    const nextOffset = payloadStart + Math.ceil(size / 512) * 512;
    const normalizedPath = normalizeArchivePath(path);
    if (payloadEnd > archive.length) {
      throw new Error(`truncated tar payload: ${normalizedPath}`);
    }
    if (nextOffset > archive.length) {
      throw new Error(`truncated tar padding: ${normalizedPath}`);
    }
    assertZeroBytes(archive.subarray(payloadEnd, nextOffset), "entry padding");
    entries.push({ path: normalizedPath, mode, size, type });
    offset = nextOffset;
  }

  throw new Error("tar archive missing end marker");
}

export function expectedArchiveContract(bundleManifest) {
  if (bundleManifest?.schema !== "totem.public-release-bundle/v1") {
    throw new Error(
      `unsupported release bundle schema: ${bundleManifest?.schema}`,
    );
  }
  const files = new Map();
  for (const entry of bundleManifest.files ?? []) {
    files.set(entry.path, entry.mode === "100755" ? 0o755 : 0o644);
  }
  files.set(MANIFEST_NAME, 0o644);
  return files;
}

export function validateArchiveEntries(entries, expectedFiles) {
  const seen = new Set();
  for (const entry of entries) {
    const path = normalizeArchivePath(entry.path);
    if (path === ".") continue;
    if (entry.type === "5") {
      if ((entry.mode & 0o022) !== 0) {
        throw new Error(`archive directory is group/world writable: ${path}`);
      }
      continue;
    }
    if (entry.type !== "0") {
      throw new Error(`unsupported archive entry type ${entry.type}: ${path}`);
    }
    if (!expectedFiles.has(path)) {
      throw new Error(`unexpected archive file: ${path}`);
    }
    if (seen.has(path)) throw new Error(`duplicate archive file: ${path}`);
    seen.add(path);
    const expectedMode = expectedFiles.get(path);
    const actualMode = entry.mode & 0o777;
    if (actualMode !== expectedMode) {
      throw new Error(
        `archive mode drift: ${path} expected ${expectedMode.toString(8)} got ${actualMode.toString(8)}`,
      );
    }
    if ((actualMode & 0o111) !== 0 && expectedMode !== 0o755) {
      throw new Error(`unexpected executable archive file: ${path}`);
    }
  }
  for (const path of expectedFiles.keys()) {
    if (!seen.has(path))
      throw new Error(`archive missing required file: ${path}`);
  }
}

async function loadContract(bundle) {
  const manifestPath = resolve(bundle, MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return expectedArchiveContract(manifest);
}

export async function verifyExtractedTree({ root, expectedFiles }) {
  for (const [path, expectedMode] of expectedFiles) {
    const absolute = resolve(root, path);
    const info = await stat(absolute);
    if (!info.isFile())
      throw new Error(`extracted entry is not a regular file: ${path}`);
    if (process.platform !== "win32") {
      const actualMode = info.mode & 0o777;
      if (actualMode !== expectedMode) {
        throw new Error(
          `extracted mode drift: ${path} expected ${expectedMode.toString(8)} got ${actualMode.toString(8)}`,
        );
      }
    }
  }
}

function archiveToolEnv(overrides = {}) {
  return {
    ...process.env,
    LC_ALL: "C",
    TZ: "UTC",
    ...overrides,
  };
}

export async function createArchive({
  bundle = DEFAULT_BUNDLE,
  archive = DEFAULT_ARCHIVE,
  env = archiveToolEnv(),
}) {
  if (process.platform === "win32") {
    throw new Error(
      "release archive creation requires a Unix tar implementation",
    );
  }
  await mkdir(dirname(resolve(archive)), { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "totem-release-tar-"));
  const tarPath = join(temp, "payload.tar");
  try {
    execFileSync(
      "tar",
      [
        "--format=ustar",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--mode=u+rwX,go+rX,go-w",
        "-cf",
        tarPath,
        "-C",
        resolve(bundle),
        ".",
      ],
      { env, stdio: "inherit" },
    );
    const compressed = execFileSync("gzip", ["-n", "-c", tarPath], {
      env,
      maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(resolve(archive), compressed);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return verifyArchive({ bundle, archive });
}

export async function verifyArchive({
  bundle = DEFAULT_BUNDLE,
  archive = DEFAULT_ARCHIVE,
}) {
  const expectedFiles = await loadContract(bundle);
  const bytes = await readFile(resolve(archive));
  inspectGzipHeader(bytes);
  const entries = parseTarEntries(bytes);
  validateArchiveEntries(entries, expectedFiles);
  return {
    schema: SCHEMA,
    archive: basename(archive),
    fileCount: expectedFiles.size,
  };
}

export async function proveArchiveReproducibility({
  bundle = DEFAULT_BUNDLE,
} = {}) {
  if (process.platform === "win32") {
    throw new Error(
      "release archive reproducibility requires Unix tar/gzip tooling",
    );
  }
  const temp = await mkdtemp(join(tmpdir(), "totem-release-repro-"));
  const first = join(temp, "first.tar.gz");
  const second = join(temp, "second.tar.gz");
  try {
    await createArchive({
      bundle,
      archive: first,
      env: archiveToolEnv({ LANG: "C", TZ: "Pacific/Kiritimati" }),
    });
    await createArchive({
      bundle,
      archive: second,
      env: archiveToolEnv({ LANG: "C.UTF-8", TZ: "America/New_York" }),
    });
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(first),
      readFile(second),
    ]);
    if (!firstBytes.equals(secondBytes)) {
      throw new Error("compressed release archive bytes are not reproducible");
    }
    return {
      schema: SCHEMA,
      archive: basename(DEFAULT_ARCHIVE),
      bytes: firstBytes.length,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function smokeArchive({
  bundle = DEFAULT_BUNDLE,
  archive = DEFAULT_ARCHIVE,
}) {
  if (process.platform === "win32") {
    throw new Error(
      "release archive extraction smoke requires Unix file-mode semantics",
    );
  }
  const result = await verifyArchive({ bundle, archive });
  const expectedFiles = await loadContract(bundle);
  const temp = await mkdtemp(join(tmpdir(), "totem-release-archive-"));
  try {
    execFileSync("tar", ["-xzf", resolve(archive), "-C", temp], {
      stdio: "inherit",
    });
    await verifyExtractedTree({ root: temp, expectedFiles });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle" || arg === "--archive") {
      index += 1;
      if (!argv[index]) throw new Error(`missing value for ${arg}`);
      options[arg.slice(2)] = argv[index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  let result;
  if (command === "create") result = await createArchive(options);
  else if (command === "verify") result = await verifyArchive(options);
  else if (command === "smoke") result = await smokeArchive(options);
  else if (command === "reproducibility")
    result = await proveArchiveReproducibility(options);
  else
    throw new Error(
      "usage: release-archive.mjs <create|verify|smoke|reproducibility> [--bundle path] [--archive path]",
    );
  const summary =
    "fileCount" in result
      ? `${result.fileCount} files verified in ${result.archive}`
      : `${result.bytes} reproducible compressed bytes in ${result.archive}`;
  console.log(`[release-archive] ${summary}`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[release-archive] ${error.message}`);
    process.exitCode = 1;
  });
}
