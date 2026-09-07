import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { generateIntegrity, verifyIntegrity } from "./release-integrity.mjs";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "totem-integrity-"));
  const bundle = resolve(root, "bundle");
  await mkdir(resolve(bundle, "scripts"), { recursive: true });
  await writeFile(resolve(bundle, "README.md"), "hello\n");
  await writeFile(resolve(bundle, "scripts/tool.mjs"), "console.log('ok')\n");
  const release = {
    schema: "totem.public-release-bundle/v1",
    repository: "KingHacker9000/totem",
    source: { revision: "a".repeat(40), tree: "b".repeat(40) },
    files: [
      { path: "README.md", mode: "100644", bytes: 6, sha256: "0".repeat(64) },
      { path: "scripts/tool.mjs", mode: "100644", bytes: 18, sha256: "1".repeat(64) },
    ],
    digest: { algorithm: "sha256", value: "2".repeat(64) },
  };
  await writeFile(resolve(bundle, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`);
  return { root, bundle: "bundle", manifest: "integrity.json" };
}

async function withFixture(fn) {
  const f = await fixture();
  try { await fn(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}

test("generates deterministic offline-verifiable manifest", async () => withFixture(async (f) => {
  const first = await generateIntegrity(f);
  const firstBytes = await readFile(resolve(f.root, f.manifest), "utf8");
  const second = await generateIntegrity(f);
  const secondBytes = await readFile(resolve(f.root, f.manifest), "utf8");
  assert.deepEqual(second, first);
  assert.equal(secondBytes, firstBytes);
  assert.equal((await verifyIntegrity(f)).releaseBundleDigest, "2".repeat(64));
}));

test("rejects tampered, missing, and unexpected files", async () => withFixture(async (f) => {
  await generateIntegrity(f);
  await writeFile(resolve(f.root, f.bundle, "README.md"), "tampered\n");
  await assert.rejects(() => verifyIntegrity(f), /integrity mismatch/);
}));

test("rejects unexpected files", async () => withFixture(async (f) => {
  await generateIntegrity(f);
  await writeFile(resolve(f.root, f.bundle, "extra.txt"), "nope");
  await assert.rejects(() => verifyIntegrity(f), /missing or unexpected files/);
}));

test("rejects duplicate and unsafe manifest paths", async () => withFixture(async (f) => {
  await generateIntegrity(f);
  const path = resolve(f.root, f.manifest);
  const document = JSON.parse(await readFile(path, "utf8"));
  document.files.push({ ...document.files[0] });
  await writeFile(path, `${JSON.stringify(document)}\n`);
  await assert.rejects(() => verifyIntegrity(f), /duplicate integrity manifest path/);

  document.files = [{ ...document.files[0], path: "../escape" }];
  await writeFile(path, `${JSON.stringify(document)}\n`);
  await assert.rejects(() => verifyIntegrity(f), /unsafe integrity manifest path/);
}));

test("rejects release identity drift even when file checksums are refreshed", async () => withFixture(async (f) => {
  await generateIntegrity(f);
  const releasePath = resolve(f.root, f.bundle, "release-manifest.json");
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  release.digest.value = "3".repeat(64);
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
  await assert.rejects(() => verifyIntegrity(f), /integrity mismatch|does not match embedded release identity/);
}));
