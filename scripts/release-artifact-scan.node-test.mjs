import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanArtifactDirectory } from "./release-artifact-scan.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "totem-artifact-scan-"));
  await mkdir(join(root, "apps/core"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "apps/core/main.js"), 'console.log("totem")\n');
  await writeFile(join(root, "docs/README.md"), "# public release\n");
  return root;
}

test("safe release artifact passes with deterministic summary", async () => {
  const root = await fixture();
  const report = await scanArtifactDirectory(root);
  assert.equal(report.schema, "totem.release-artifact-content-scan/v1");
  assert.equal(report.status, "PASS");
  assert.equal(report.files, 2);
  assert.equal(report.binaryFiles, 0);
});

test("credential-like material fails closed", async () => {
  const root = await fixture();
  const token = ["ghp", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
  await writeFile(join(root, "docs/leak.txt"), `token=${token}\n`);
  await assert.rejects(scanArtifactDirectory(root), /GitHub token detected/);
});

test("developer home paths fail closed", async () => {
  const root = await fixture();
  const pathLeak = ["", "Users", "alice", "src", "totem"].join("/");
  await writeFile(join(root, "docs/leak.txt"), `built-from=${pathLeak}\n`);
  await assert.rejects(
    scanArtifactDirectory(root),
    /absolute developer\/workspace path detected/,
  );
});

test("private Portal identifiers fail outside the explicit policy allowlist", async () => {
  const root = await fixture();
  const privateName = ["totem-portal", "theme"].join("-");
  await writeFile(join(root, "apps/core/private.txt"), `${privateName}\n`);
  await assert.rejects(
    scanArtifactDirectory(root),
    /private Portal identifier detected outside explicit policy allowlist/,
  );
});

test("source-map files and references fail closed", async () => {
  const root = await fixture();
  await writeFile(join(root, "apps/core/bundle.js.map"), "{}\n");
  await assert.rejects(scanArtifactDirectory(root), /source-map artifact/);

  const second = await fixture();
  const sourceMapMarker = ["//# source", "MappingURL=bundle.js.map"].join("");
  await writeFile(
    join(second, "apps/core/main.js"),
    ["console.log('totem')", sourceMapMarker, ""].join("\n"),
  );
  await assert.rejects(scanArtifactDirectory(second), /source-map reference/);
});

test("binary payloads are bounded and still scanned for ASCII secrets", async () => {
  const root = await fixture();
  const token = ["ghp", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
  const bytes = Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    Buffer.from(token, "ascii"),
    Buffer.from([0, 255]),
  ]);
  await writeFile(join(root, "apps/core/blob.bin"), bytes);
  await assert.rejects(scanArtifactDirectory(root), /GitHub token detected/);
});
