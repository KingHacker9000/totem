import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TotemConfig } from "./config.js";
import { OperatorManager } from "./operatorRoutes.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeConfig(root: string, host = "127.0.0.1"): TotemConfig {
  return {
    host,
    port: 3000,
    logLevel: "silent",
    environment: "test",
    paths: {
      root,
      state: join(root, "state"),
      extensions: join(root, "extensions"),
      themes: join(root, "themes"),
      logs: join(root, "logs"),
    },
    discovery: {
      extensionRoots: [join(root, "extensions")],
      themeRoots: [join(root, "themes")],
    },
  };
}

describe("OperatorManager", () => {
  it("reports loopback as secure-by-default and warns on remote bind", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-operator-test-"));
    tempDirs.push(root);

    const local = new OperatorManager(makeConfig(root), { env: {} });
    expect(local.capabilitySnapshot().security).toMatchObject({
      loopbackOnly: true,
      remoteExposureSecure: true,
      applicationAuth: "not-implemented",
    });

    const remote = new OperatorManager(makeConfig(root, "0.0.0.0"), {
      env: {},
    });
    expect(remote.capabilitySnapshot().security).toMatchObject({
      loopbackOnly: false,
      remoteExposureSecure: false,
      applicationAuth: "not-implemented",
    });

    const declaredAccessLayer = new OperatorManager(
      makeConfig(root, "0.0.0.0"),
      { env: { TOTEM_REMOTE_ACCESS_LAYER: "tailscale-proxy" } },
    );
    expect(declaredAccessLayer.capabilitySnapshot().security).toMatchObject({
      loopbackOnly: false,
      remoteExposureSecure: false,
      externalAccessLayer: "tailscale-proxy",
    });
  });

  it("creates state backups and produces restart-required restore plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-operator-test-"));
    tempDirs.push(root);
    const config = makeConfig(root);
    await mkdir(config.paths.state, { recursive: true });
    await writeFile(
      join(config.paths.state, "state.json"),
      "original\n",
      "utf8",
    );

    const now = new Date("2026-09-06T19:40:00.000Z");
    const manager = new OperatorManager(config, {
      now: () => now,
      env: {},
    });
    const backup = await manager.createBackup();
    expect(backup.id).toBe("20260906T194000.000Z");
    expect(backup.entries).toContain("state.json");
    expect(
      await readFile(
        join(root, "backups", backup.id, "state", "state.json"),
        "utf8",
      ),
    ).toBe("original\n");

    const listed = await manager.listBackups();
    expect(listed.map((item) => item.id)).toEqual([backup.id]);

    const plan = await manager.restorePlan(backup.id);
    expect(plan.liveRestoreSupported).toBe(false);
    expect(plan.steps.join("\n")).toContain(config.paths.state);
  });

  it("keeps a bounded structured request history", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-operator-test-"));
    tempDirs.push(root);
    const manager = new OperatorManager(makeConfig(root), { env: {} });

    for (let index = 0; index < 300; index += 1) {
      manager.record({
        occurredAt: `2026-09-06T19:40:${String(index % 60).padStart(2, "0")}Z`,
        method: "GET",
        url: `/api/test/${index}`,
        statusCode: 200,
      });
    }

    expect(manager.recentLogs(500)).toHaveLength(250);
    expect(manager.recentLogs(1)[0]?.url).toBe("/api/test/299");
  });
});
