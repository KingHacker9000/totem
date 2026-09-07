import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertReleaseTransition,
  validateStateCompatibilityDescriptor,
} from "./state-compatibility.mjs";
import {
  createQuiescedBackup,
  restoreVerifiedBackup,
} from "../../scripts/state-recovery.mjs";

const roots = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "totem-state-compat-"));
  roots.push(root);
  return root;
}

async function writeDescriptor(release, descriptor = {}) {
  const dir = join(release, "deploy", "pi");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "state-compatibility.json"),
    `${JSON.stringify(
      {
        schema: "totem.state-compatibility/v1",
        stateFormat: "opaque-v0",
        reads: ["opaque-v0"],
        writes: "opaque-v0",
        migration: "none",
        legacyUnversionedFormat: "opaque-v0",
        ...descriptor,
      },
      null,
      2,
    )}\n`,
  );
}

test.after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("current descriptor is internally consistent", () => {
  assert.deepEqual(
    validateStateCompatibilityDescriptor({
      schema: "totem.state-compatibility/v1",
      stateFormat: "opaque-v0",
      reads: ["opaque-v0"],
      writes: "opaque-v0",
      migration: "none",
      legacyUnversionedFormat: "opaque-v0",
    }),
    {
      schema: "totem.state-compatibility/v1",
      stateFormat: "opaque-v0",
      reads: ["opaque-v0"],
      writes: "opaque-v0",
      migration: "none",
      legacyUnversionedFormat: "opaque-v0",
    },
  );
});

test("update and rollback accept the current opaque state contract", async () => {
  const root = await makeRoot();
  const oldRelease = join(root, "releases", "old");
  const newRelease = join(root, "releases", "new");
  await writeDescriptor(oldRelease);
  await writeDescriptor(newRelease);

  const update = await assertReleaseTransition({
    fromRelease: oldRelease,
    toRelease: newRelease,
  });
  assert.equal(update.compatible, true);
  assert.equal(update.stateMutation, "none");

  const rollback = await assertReleaseTransition({
    fromRelease: newRelease,
    toRelease: oldRelease,
  });
  assert.equal(rollback.compatible, true);
  assert.equal(rollback.stateMutation, "none");
});

test("legacy pre-contract releases are accepted only through the declared baseline", async () => {
  const root = await makeRoot();
  const legacy = join(root, "releases", "legacy");
  const current = join(root, "releases", "current");
  await mkdir(legacy, { recursive: true });
  await writeDescriptor(current);

  const forward = await assertReleaseTransition({
    fromRelease: legacy,
    toRelease: current,
  });
  assert.equal(forward.from.source, "legacy-unversioned");

  const backward = await assertReleaseTransition({
    fromRelease: current,
    toRelease: legacy,
  });
  assert.equal(backward.to.source, "legacy-unversioned");
});

test("an incompatible future state format fails closed", async () => {
  const root = await makeRoot();
  const oldRelease = join(root, "releases", "old");
  const incompatible = join(root, "releases", "future");
  await writeDescriptor(oldRelease);
  await writeDescriptor(incompatible, {
    stateFormat: "opaque-v1",
    reads: ["opaque-v1"],
    writes: "opaque-v1",
    legacyUnversionedFormat: undefined,
  });

  await assert.rejects(
    assertReleaseTransition({
      fromRelease: oldRelease,
      toRelease: incompatible,
    }),
    /Unsafe state transition/,
  );
});

test("state survives simulated release reuse and verified recovery without implicit migration", async () => {
  const root = await makeRoot();
  const oldRelease = join(root, "releases", "old");
  const newRelease = join(root, "releases", "new");
  const stateDir = join(root, "state");
  await writeDescriptor(oldRelease);
  await writeDescriptor(newRelease);
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "durable.json"), '{"turn":1}\n');

  await assertReleaseTransition({
    fromRelease: oldRelease,
    toRelease: newRelease,
  });
  assert.equal(
    await readFile(join(stateDir, "durable.json"), "utf8"),
    '{"turn":1}\n',
  );

  const backup = await createQuiescedBackup({
    root,
    stateDir,
    now: new Date("2026-09-07T08:00:00.000Z"),
    assertStopped: async () => {},
  });
  await writeFile(join(stateDir, "durable.json"), '{"turn":2}\n');

  await assertReleaseTransition({
    fromRelease: newRelease,
    toRelease: oldRelease,
  });
  assert.equal(
    await readFile(join(stateDir, "durable.json"), "utf8"),
    '{"turn":2}\n',
  );

  await restoreVerifiedBackup({
    backupDir: backup.backupDir,
    stateDir,
    now: new Date("2026-09-07T08:01:00.000Z"),
    assertStopped: async () => {},
  });
  assert.equal(
    await readFile(join(stateDir, "durable.json"), "utf8"),
    '{"turn":1}\n',
  );
});
