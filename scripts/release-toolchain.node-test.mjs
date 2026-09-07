import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateToolchainMetadata } from "./release-toolchain.mjs";

const CONTRACT = {
  schema: "totem.release-toolchain/v1",
  node: {
    default: "24.18.0",
    ci: ["22.20.0", "24.18.0"],
    engine: ">=22.20.0",
  },
  pnpm: { pinned: "10.28.0", engine: ">=10 <11" },
  workflow: ".github/workflows/ci.yml",
};
const MATRIX_EXPRESSION = "node-version: $" + "{{ matrix.node }}";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "totem-toolchain-"));
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(root, "config", "release-toolchain.json"),
    `${JSON.stringify(CONTRACT, null, 2)}\n`,
  );
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      packageManager: "pnpm@10.28.0",
      engines: { node: ">=22.20.0", pnpm: ">=10 <11" },
    })}\n`,
  );
  await writeFile(join(root, ".node-version"), "24.18.0\n");
  await writeFile(join(root, ".nvmrc"), "24.18.0\n");
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    `matrix:\n  node: [22.20.0, 24.18.0]\nsteps:\n  - uses: pnpm/action-setup@deadbeef\n  - uses: actions/setup-node@deadbeef\n    with:\n      ${MATRIX_EXPRESSION}\n`,
  );
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

test("accepts aligned package, defaults, and CI matrix", async () => {
  await withFixture(async (root) => {
    const result = await validateToolchainMetadata(root);
    assert.equal(result.node.default, "24.18.0");
    assert.equal(result.pnpm.pinned, "10.28.0");
    assert.match(result.contractSha256, /^[0-9a-f]{64}$/);
  });
});

test("rejects package manager drift", async () => {
  await withFixture(async (root) => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        engines: { node: ">=22.20.0", pnpm: ">=10 <11" },
      }),
    );
    await assert.rejects(
      () => validateToolchainMetadata(root),
      /packageManager drift/,
    );
  });
});

test("rejects default Node drift", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, ".nvmrc"), "22.20.0\n");
    await assert.rejects(
      () => validateToolchainMetadata(root),
      /default Node drift/,
    );
  });
});

test("rejects CI matrix drift", async () => {
  await withFixture(async (root) => {
    await writeFile(
      join(root, ".github", "workflows", "ci.yml"),
      `matrix:\n  node: [24.18.0]\nsteps:\n  - uses: pnpm/action-setup@deadbeef\n  - uses: actions/setup-node@deadbeef\n    with:\n      ${MATRIX_EXPRESSION}\n`,
    );
    await assert.rejects(
      () => validateToolchainMetadata(root),
      /CI Node matrix drift/,
    );
  });
});
