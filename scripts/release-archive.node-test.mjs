import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedArchiveContract,
  normalizeArchivePath,
  parseTarEntries,
  validateArchiveEntries,
} from "./release-archive.mjs";

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(`${text}\0`, offset, length, "ascii");
}

function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    writeOctal(header, 100, 8, entry.mode ?? 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    writeOctal(header, 148, 8, sum);
    blocks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const manifest = {
  schema: "totem.public-release-bundle/v1",
  files: [
    { path: "README.md", mode: "100644" },
    { path: "deploy/pi/install.sh", mode: "100755" },
  ],
};

test("archive contract derives exact regular-file modes", () => {
  const contract = expectedArchiveContract(manifest);
  assert.equal(contract.get("README.md"), 0o644);
  assert.equal(contract.get("deploy/pi/install.sh"), 0o755);
  assert.equal(contract.get("release-manifest.json"), 0o644);
});

test("tar parser and validator accept the exact portable contract", () => {
  const bytes = tar([
    { path: "./", type: "5", mode: 0o755 },
    { path: "./README.md", mode: 0o644, body: "readme" },
    { path: "./deploy/", type: "5", mode: 0o755 },
    { path: "./deploy/pi/", type: "5", mode: 0o755 },
    { path: "./deploy/pi/install.sh", mode: 0o755, body: "#!/bin/sh\n" },
    { path: "./release-manifest.json", mode: 0o644, body: "{}\n" },
  ]);
  validateArchiveEntries(parseTarEntries(bytes), expectedArchiveContract(manifest));
});

test("unsafe paths fail closed", () => {
  assert.throws(() => normalizeArchivePath("../secret"), /unsafe archive path/);
  assert.throws(() => normalizeArchivePath("/etc/passwd"), /unsafe archive path/);
  assert.throws(() => normalizeArchivePath("C:/secret"), /unsafe archive path/);
});

test("special files and unexpected files fail closed", () => {
  const contract = expectedArchiveContract(manifest);
  assert.throws(
    () => validateArchiveEntries([{ path: "README.md", mode: 0o644, size: 0, type: "2" }], contract),
    /unsupported archive entry type/,
  );
  assert.throws(
    () =>
      validateArchiveEntries(
        [
          { path: "README.md", mode: 0o644, size: 0, type: "0" },
          { path: "evil.sh", mode: 0o755, size: 0, type: "0" },
        ],
        new Map([["README.md", 0o644]]),
      ),
    /unexpected archive file/,
  );
});

test("missing executable bit and unexpected executable bit fail closed", () => {
  assert.throws(
    () =>
      validateArchiveEntries(
        [{ path: "deploy/pi/install.sh", mode: 0o644, size: 0, type: "0" }],
        new Map([["deploy/pi/install.sh", 0o755]]),
      ),
    /archive mode drift/,
  );
  assert.throws(
    () =>
      validateArchiveEntries(
        [{ path: "README.md", mode: 0o755, size: 0, type: "0" }],
        new Map([["README.md", 0o644]]),
      ),
    /archive mode drift/,
  );
});

test("missing required files and writable directories fail closed", () => {
  assert.throws(
    () => validateArchiveEntries([], new Map([["README.md", 0o644]])),
    /archive missing required file/,
  );
  assert.throws(
    () => validateArchiveEntries([{ path: "tmp", mode: 0o777, size: 0, type: "5" }], new Map()),
    /group\/world writable/,
  );
});
