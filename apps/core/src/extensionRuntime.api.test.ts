import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { TotemConfig } from "./config.js";

describe("extension runtime HTTP surface", () => {
  it("preserves phase2 declarations, separates grants, and exposes no secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-extension-runtime-"));
    const extensions = join(root, "extensions");
    const themes = join(root, "themes");
    const weather = join(extensions, "weather");
    await mkdir(weather, { recursive: true });
    await mkdir(themes, { recursive: true });
    await writeFile(
      join(weather, "totem-extension.json"),
      JSON.stringify({
        schema: "totem.extension/v0",
        id: "weather",
        name: "Weather",
        version: "0.2.0",
        compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
        enabledByDefault: true,
        permissions: ["network.internet", "display.present"],
        events: { publish: ["extension.weather.updated"] },
        contributions: { display: [{ id: "weather", title: "Weather" }] },
        settings: { units: { type: "string", default: "metric" } },
        secrets: [{ id: "weather-key", required: true }],
        mcp: [{ id: "weather-mcp" }],
      }),
    );

    const config: TotemConfig = {
      host: "127.0.0.1",
      port: 3000,
      logLevel: "silent",
      environment: "test",
      paths: {
        root,
        state: join(root, "state"),
        extensions,
        themes,
        logs: join(root, "logs"),
      },
      discovery: { extensionRoots: [extensions], themeRoots: [themes] },
    };
    const app = createApp({
      config,
      logger: false,
      extensionGrants: { weather: ["display.present"] },
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/extensions/runtime",
      });
      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload).toMatchObject({
        extensions: [
          {
            id: "weather",
            requestedPermissions: ["network.internet", "display.present"],
            grantedPermissions: ["display.present"],
            secretRefs: [{ id: "weather-key", required: true }],
            mcp: [{ id: "weather-mcp" }],
          },
        ],
        security: { defaultGrantPolicy: "deny", secretValuesExposed: false },
      });
      expect(payload.extensions[0]).not.toHaveProperty("secretValue");
      expect(payload.extensions[0]).not.toHaveProperty("secretValues");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
