import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createQuiescedBackup,
  restoreVerifiedBackup,
  verifyBackupDirectory,
} from "./state-recovery.mjs";

const roots = [];

test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "totem-state-recovery-"));
  roots.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "nested"), { recursive: true });
  await writeFile(join(stateDir, "totem.sqlite"), "sqlite-state-v1\n", "utf8");
  await writeFile(join(stateDir, "totem.sqlite-wal"), "wal-sidecar\n", "utf8");
  await writeFile(
    join(stateDir, "nested", "durable.json"),
    '{"turn":1}\n',
    "utf8",
  );
  return { root, stateDir };
}

const stopped = async () => {};

test("creates and verifies a quiesced integrity-manifested backup", async () => {
  const { root, stateDir } = await fixture();
  const { backupDir, manifest } = await createQuiescedBackup({
    root,
    stateDir,
    now: new Date("2026-09-07T07:30:00.000Z"),
    assertStopped: stopped,
  });

  assert.equal(manifest.captureMode, "quiesced");
  assert.equal(manifest.integrity.algorithm, "sha256");
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["nested/durable.json", "totem.sqlite", "totem.sqlite-wal"],
  );
  const verified = await verifyBackupDirectory(backupDir);
  assert.equal(verified.id, "20260907T073000.000Z");
});

test("rejects tampered, incomplete, and legacy snapshots", async () => {
  const { root, stateDir } = await fixture();
  const first = await createQuiescedBackup({
    root,
    stateDir,
    now: new Date("2026-09-07T07:31:00.000Z"),
    assertStopped: stopped,
  });
  await writeFile(
    join(first.backupDir, "state", "totem.sqlite"),
    "tampered\n",
    "utf8",
  );
  await assert.rejects(
    () => verifyBackupDirectory(first.backupDir),
    /integrity verification failed/,
  );

  const second = await createQuiescedBackup({
    root,
    stateDir,
    now: new Date("2026-09-07T07:32:00.000Z"),
    assertStopped: stopped,
  });
  await rm(join(second.backupDir, "state", "nested", "durable.json"));
  await assert.rejects(
    () => verifyBackupDirectory(second.backupDir),
    /integrity verification failed/,
  );

  const legacyDir = join(root, "backups", "20260907T073300.000Z");
  await mkdir(join(legacyDir, "state"), { recursive: true });
  await writeFile(
    join(legacyDir, "manifest.json"),
    JSON.stringify({
      schema: "totem.backup/v0",
      id: "20260907T073300.000Z",
      createdAt: "2026-09-07T07:33:00.000Z",
      source: stateDir,
      entries: [],
    }),
  );
  await assert.rejects(
    () => verifyBackupDirectory(legacyDir),
    /no integrity inventory/,
  );
});

test("fails closed without stopped-state proof and preserves live state before restore", async () => {
  const { root, stateDir } = await fixture();
  const backup = await createQuiescedBackup({
    root,
    stateDir,
    now: new Date("2026-09-07T07:34:00.000Z"),
    assertStopped: stopped,
  });

  await writeFile(join(stateDir, "totem.sqlite"), "new-live-state\n", "utf8");
  let stopChecks = 0;
  await assert.rejects(
    () =>
      restoreVerifiedBackup({
        backupDir: backup.backupDir,
        stateDir,
        assertStopped: async () => {
          stopChecks += 1;
          throw new Error("service active");
        },
      }),
    /service active/,
  );
  assert.equal(stopChecks, 1);
  assert.equal(
    await readFile(join(stateDir, "totem.sqlite"), "utf8"),
    "new-live-state\n",
  );

  const result = await restoreVerifiedBackup({
    backupDir: backup.backupDir,
    stateDir,
    now: new Date("2026-09-07T07:35:00.000Z"),
    assertStopped: stopped,
  });
  assert.equal(
    await readFile(join(stateDir, "totem.sqlite"), "utf8"),
    "sqlite-state-v1\n",
  );
  assert.ok(result.preservedState);
  assert.equal(
    await readFile(join(result.preservedState, "totem.sqlite"), "utf8"),
    "new-live-state\n",
  );
  assert.match(result.next.join("\n"), /validate:pi/);
});
