import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performDecommission, PURGE_CONFIRMATION } from "./decommission.mjs";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "totem-decommission-"));
  const prefix = path.join(root, "opt", "totem");
  const stateDir = path.join(root, "var", "lib", "totem");
  const configDir = path.join(root, "etc", "totem");
  const serviceFile = path.join(
    root,
    "etc",
    "systemd",
    "system",
    "totem.service",
  );
  await mkdir(path.join(prefix, "releases", "r1"), { recursive: true });
  await mkdir(path.join(stateDir, "backups", "b1"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(path.dirname(serviceFile), { recursive: true });
  await writeFile(path.join(stateDir, "state.db"), "durable\n");
  await writeFile(
    path.join(stateDir, "backups", "b1", "manifest.json"),
    "{}\n",
  );
  await writeFile(path.join(configDir, "totem.env"), "TOKEN=secret\n");
  await writeFile(serviceFile, "[Service]\n");
  return { root, prefix, stateDir, configDir, serviceFile };
}

function systemctlRecorder() {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args.join(" "));
      return { stdout: "", stderr: "" };
    },
  };
}

test("default decommission removes runtime/service but preserves state, backups, and config", async () => {
  const f = await fixture();
  const systemctl = systemctlRecorder();
  const result = await performDecommission({
    ...f,
    runSystemctl: systemctl.run,
  });

  assert.equal(await exists(f.prefix), false);
  assert.equal(await exists(f.serviceFile), false);
  assert.equal(
    await readFile(path.join(f.stateDir, "state.db"), "utf8"),
    "durable\n",
  );
  assert.equal(
    await readFile(
      path.join(f.stateDir, "backups", "b1", "manifest.json"),
      "utf8",
    ),
    "{}\n",
  );
  assert.equal(
    await readFile(path.join(f.configDir, "totem.env"), "utf8"),
    "TOKEN=secret\n",
  );
  assert.equal(result.state, "preserved");
  assert.equal(result.config, "preserved");
  assert.deepEqual(systemctl.calls, [
    "stop totem.service",
    "disable totem.service",
    "daemon-reload",
  ]);

  // Reinstall simulation: runtime can be recreated without touching preserved state.
  await mkdir(path.join(f.prefix, "releases", "r2"), { recursive: true });
  assert.equal(
    await readFile(path.join(f.stateDir, "state.db"), "utf8"),
    "durable\n",
  );

  // Repeated decommission is idempotent.
  await performDecommission({ ...f, runSystemctl: systemctl.run });
  assert.equal(await exists(f.prefix), false);
  assert.equal(
    await readFile(path.join(f.stateDir, "state.db"), "utf8"),
    "durable\n",
  );
});

test("purge refuses to run without the exact destructive confirmation", async () => {
  const f = await fixture();
  const systemctl = systemctlRecorder();
  await assert.rejects(
    performDecommission({
      ...f,
      purgeState: true,
      runSystemctl: systemctl.run,
    }),
    /PURGE-TOTEM-STATE/,
  );
  assert.equal(
    await readFile(path.join(f.stateDir, "state.db"), "utf8"),
    "durable\n",
  );
  assert.equal(await exists(f.prefix), true);
  assert.deepEqual(systemctl.calls, []);
});

test("explicit purge can remove state while preserving config independently", async () => {
  const f = await fixture();
  const systemctl = systemctlRecorder();
  const result = await performDecommission({
    ...f,
    purgeState: true,
    confirmation: PURGE_CONFIRMATION,
    runSystemctl: systemctl.run,
  });
  assert.equal(await exists(f.stateDir), false);
  assert.equal(await exists(f.configDir), true);
  assert.equal(result.state, "purged");
  assert.equal(result.config, "preserved");
});

test("dry-run makes no filesystem or systemctl changes", async () => {
  const f = await fixture();
  const systemctl = systemctlRecorder();
  const result = await performDecommission({
    ...f,
    dryRun: true,
    runSystemctl: systemctl.run,
  });
  assert.equal(await exists(f.prefix), true);
  assert.equal(await exists(f.serviceFile), true);
  assert.equal(await exists(f.stateDir), true);
  assert.deepEqual(systemctl.calls, []);
  assert.ok(
    result.actions.every((item) =>
      ["planned", "preserved"].includes(item.status),
    ),
  );
});
