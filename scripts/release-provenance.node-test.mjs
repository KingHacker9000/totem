import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateProvenance, SCHEMA, verifyProvenance } from "./release-provenance.mjs";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "totem-provenance-"));
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Totem Test");
  git(root, "remote", "add", "origin", "https://github.com/KingHacker9000/totem.git");
  await writeFile(join(root, ".gitignore"), "artifact.bin\ntotem-portal-theme/\nprovenance.json\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "totem", version: "0.0.0", private: true, packageManager: "pnpm@10.28.0", engines: { node: ">=22.20.0" } }), "utf8");
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  await writeFile(join(root, "artifact.bin"), "artifact-v1", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

async function withFixture(run) {
  const root = await fixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("generates deterministic source and artifact identities and verifies them", async () => {
  await withFixture(async (root) => {
    const first = await generateProvenance({ root, artifacts: ["artifact.bin"], output: "provenance.json" });
    assert.equal(first.schema, SCHEMA);
    assert.match(first.repository.revision, /^[0-9a-f]{40}$/);
    assert.match(first.repository.tree, /^[0-9a-f]{40}$/);
    assert.equal(first.artifacts.length, 1);
    assert.equal(first.boundary.publicRepositoryOnly, true);
    const bytes1 = await readFile(join(root, "provenance.json"), "utf8");
    await generateProvenance({ root, artifacts: ["artifact.bin"], output: "provenance.json" });
    const bytes2 = await readFile(join(root, "provenance.json"), "utf8");
    assert.equal(bytes2, bytes1);
    await verifyProvenance({ root, output: "provenance.json" });
  });
});

test("rejects artifact digest drift without source changes", async () => {
  await withFixture(async (root) => {
    await generateProvenance({ root, artifacts: ["artifact.bin"], output: "provenance.json" });
    await writeFile(join(root, "artifact.bin"), "tampered", "utf8");
    await assert.rejects(() => verifyProvenance({ root, output: "provenance.json" }), /artifact digest drift/);
  });
});

test("rejects dirty tracked source", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "README.md"), "dirty\n", "utf8");
    await assert.rejects(
      () => generateProvenance({ root, artifacts: ["artifact.bin"], output: "provenance.json" }),
      /tracked source differs from HEAD/,
    );
  });
});

test("rejects stale provenance after source revision advances", async () => {
  await withFixture(async (root) => {
    await generateProvenance({ root, artifacts: ["artifact.bin"], output: "provenance.json" });
    await writeFile(join(root, "README.md"), "fixture v2\n", "utf8");
    git(root, "add", "README.md");
    git(root, "commit", "-m", "advance source");
    await assert.rejects(() => verifyProvenance({ root, output: "provenance.json" }), /source revision\/tree is stale/);
  });
});

test("rejects private Portal artifact paths", async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, "totem-portal-theme"));
    await writeFile(join(root, "totem-portal-theme", "private.bin"), "private", "utf8");
    await assert.rejects(
      () => generateProvenance({ root, artifacts: ["totem-portal-theme/private.bin"], output: "provenance.json" }),
      /private Portal content/,
    );
  });
});
