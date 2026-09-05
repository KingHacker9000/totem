import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { TotemConfig } from "./config.js";

const testConfig: TotemConfig = {
  host: "127.0.0.1",
  port: 3000,
  logLevel: "silent",
  environment: "test",
  paths: {
    root: "/tmp/totem-test",
    state: "/tmp/totem-test/state",
    extensions: "/tmp/totem-test/extensions",
    themes: "/tmp/totem-test/themes",
    logs: "/tmp/totem-test/logs",
  },
};

describe("core HTTP surface", () => {
  it("serves identity, health, and runtime status", async () => {
    const startedAt = "2026-09-05T22:00:00.000Z";
    const app = createApp({ config: testConfig, startedAt, logger: false });

    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(root.json()).toEqual({
        name: "Totem",
        stage: "phase-1",
        status: "ok",
      });

      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok" });

      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        status: "ok",
        name: "Totem",
        stage: "phase-1",
        environment: "test",
        startedAt,
        dataDir: testConfig.paths.root,
      });
      expect(status.json().uptimeSeconds).toBeGreaterThanOrEqual(0);

      expect(
        (await app.inject({ method: "GET", url: "/missing" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  }, 15_000);
});
