import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReleaseBundle,
  releasePolicy,
  verifyReleaseBundle,
} from "./release-bundle.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "totem-release-bundle-"));
  git(root, ["init"]);
  git(root, ["config", "user.name", "Totem CI"]);
  git(root, ["config", "user.email", "totem@example.invalid"]);
  await mkdir(join(root, "apps/core/src"), { recursive: true });
  await mkdir(join(root, "deploy/pi"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    '{"name":"totem","private":true}\n',
  );
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
  );
  await writeFile(
    join(root, "apps/core/src/main.ts"),
    'console.log("totem")\n',
  );
  await writeFile(
    join(root, "deploy/pi/totem.env.example"),
    "TOTEM_PORT=3000\n",
  );
  await writeFile(join(root, "docs/README.md"), "# release docs\n");
  await writeFile(join(root, "scripts/tool.mjs"), "export const ok = true;\n");
  await writeFile(join(root, ".github-note"), "not allowlisted\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

test("release policy rejects private, state, and secret paths", () => {
  assert.equal(releasePolicy("apps/core/src/main.ts").include, true);
  assert.equal(releasePolicy("deploy/pi/totem.env.example").include, true);
  assert.equal(releasePolicy(".github/workflows/ci.yml").include, false);
  assert.equal(releasePolicy("logs/runtime.log").fatal, false);
  assert.equal(releasePolicy("apps/core/.env.local").fatal, true);
  assert.equal(releasePolicy("apps/core/server.key").fatal, true);
  assert.equal(releasePolicy("docs/totem-portal-theme/source.txt").fatal, true);
});

test("bundle generation is deterministic and verifiable", async () => {
  const root = await fixture();
  const first = await buildReleaseBundle({ root });
  await verifyReleaseBundle({ root });
  const manifestBytes1 = await readFile(
    join(root, "dist/release/totem-public/release-manifest.json"),
  );
  const second = await buildReleaseBundle({ root });
  await verifyReleaseBundle({ root });
  const manifestBytes2 = await readFile(
    join(root, "dist/release/totem-public/release-manifest.json"),
  );
  assert.equal(first.digest.value, second.digest.value);
  assert.deepEqual(manifestBytes1, manifestBytes2);
  assert.deepEqual(
    first.files.map((entry) => entry.path),
    [
      "apps/core/src/main.ts",
      "deploy/pi/totem.env.example",
      "docs/README.md",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "scripts/tool.mjs",
    ],
  );
});

test("tracked secret material fails closed", async () => {
  const root = await fixture();
  await writeFile(join(root, "apps/core/server.key"), "secret\n");
  git(root, ["add", "apps/core/server.key"]);
  git(root, ["commit", "-m", "bad secret"]);
  await assert.rejects(
    buildReleaseBundle({ root }),
    /forbidden tracked release input: apps\/core\/server\.key/,
  );
});

test("high-confidence embedded credential fails closed", async () => {
  const root = await fixture();
  const token = ["ghp", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
  await writeFile(
    join(root, "docs/token-sample.txt"),
    `github token ${token}\n`,
  );
  git(root, ["add", "docs/token-sample.txt"]);
  git(root, ["commit", "-m", "bad embedded secret"]);
  await assert.rejects(
    buildReleaseBundle({ root }),
    /high-confidence secret material/,
  );
});
