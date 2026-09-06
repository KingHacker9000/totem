import { describe, expect, it } from "vitest";
import type { DiscoveredPackageV0 } from "./discovery.js";
import {
  ExtensionPermissionError,
  ExtensionRuntime,
  ExtensionSecretError,
  ExtensionSettingsError,
} from "./extensionRuntime.js";
import {
  InMemoryExtensionSecretProvider,
  type ExtensionSettingsStore,
} from "./extensionServices.js";

function extension(
  manifest: Record<string, unknown>,
  enabled = true,
): DiscoveredPackageV0 {
  return {
    type: "extension",
    id: String(manifest.id),
    path: `/extensions/${String(manifest.id)}`,
    state: enabled ? "enabled" : "disabled",
    enabled,
    manifest: manifest as unknown as DiscoveredPackageV0["manifest"],
    errors: [],
  };
}

class MemorySettingsStore implements ExtensionSettingsStore {
  readonly values = new Map<string, Record<string, unknown>>();

  async get(extensionId: string): Promise<Record<string, unknown>> {
    return structuredClone(this.values.get(extensionId) ?? {});
  }

  async set(extensionId: string, key: string, value: unknown): Promise<void> {
    const current = structuredClone(this.values.get(extensionId) ?? {});
    current[key] = structuredClone(value);
    this.values.set(extensionId, current);
  }
}

describe("ExtensionRuntime", () => {
  it("separates requested permissions from effective grants and fails closed", () => {
    const runtime = new ExtensionRuntime(
      [
        extension({
          id: "weather",
          permissions: ["network.internet", "display.present"],
        }),
      ],
      { weather: ["display.present"] },
    );

    expect(runtime.get("weather")?.requestedPermissions).toEqual([
      "network.internet",
      "display.present",
    ]);
    expect(runtime.get("weather")?.grantedPermissions).toEqual([
      "display.present",
    ]);
    expect(() =>
      runtime.assertPermission("weather", "display.present"),
    ).not.toThrow();
    expect(() =>
      runtime.assertPermission("weather", "network.internet"),
    ).toThrow(ExtensionPermissionError);
  });

  it("revokes runtime access while disabled and supports deterministic lifecycle", () => {
    const runtime = new ExtensionRuntime(
      [extension({ id: "timer", permissions: ["tasks.create"] })],
      { timer: ["tasks.create"] },
    );

    expect(runtime.markRunning("timer").state).toBe("running");
    expect(runtime.setEnabled("timer", false).state).toBe("disabled");
    expect(() => runtime.assertPermission("timer", "tasks.create")).toThrow(
      ExtensionPermissionError,
    );
    expect(runtime.setEnabled("timer", true).state).toBe("ready");
    expect(runtime.markFailed("timer", new Error("boom"))).toMatchObject({
      state: "failed",
      diagnostics: [{ code: "extension_runtime_failed", message: "boom" }],
    });
  });

  it("enforces extension event ownership and explicit publication declarations", () => {
    const runtime = new ExtensionRuntime([
      extension({
        id: "weather",
        events: {
          publish: ["extension.weather.updated", "task.succeeded"],
        },
      }),
    ]);

    expect(runtime.canPublish("weather", "extension.weather.updated")).toBe(
      true,
    );
    expect(runtime.canPublish("weather", "task.succeeded")).toBe(false);
    expect(runtime.canPublish("weather", "extension.weather.other")).toBe(
      false,
    );
  });

  it("persists validated settings and applies declared defaults", async () => {
    const settings = new MemorySettingsStore();
    const runtime = new ExtensionRuntime(
      [
        extension({
          id: "weather",
          settings: {
            units: { type: "string", default: "metric", enum: ["metric", "imperial"] },
            offline: { type: "boolean", default: false },
          },
        }),
      ],
      {},
      {},
      { settings },
    );

    await expect(runtime.getSettings("weather")).resolves.toEqual({
      units: "metric",
      offline: false,
    });
    await expect(runtime.setSetting("weather", "units", "imperial")).resolves.toEqual({
      units: "imperial",
      offline: false,
    });
    await expect(runtime.setSetting("weather", "units", "kelvin")).rejects.toThrow(
      ExtensionSettingsError,
    );
    await expect(runtime.setSetting("weather", "missing", true)).rejects.toThrow(
      ExtensionSettingsError,
    );
  });

  it("resolves only declared and granted secrets without exposing them in snapshots", async () => {
    const runtime = new ExtensionRuntime(
      [
        extension({
          id: "github",
          permissions: ["secrets.read:github-token"],
          secrets: [{ id: "github-token", required: true }],
        }),
      ],
      { github: ["secrets.read:github-token"] },
      {},
      {
        secrets: new InMemoryExtensionSecretProvider({
          github: { "github-token": "top-secret-token" },
        }),
      },
    );

    await expect(runtime.resolveSecret("github", "github-token")).resolves.toBe(
      "top-secret-token",
    );
    await expect(runtime.resolveSecret("github", "other-token")).rejects.toThrow(
      ExtensionSecretError,
    );
    expect(JSON.stringify(runtime.publicSnapshot())).not.toContain("top-secret-token");
  });

  it("permission-gates display contributions and MCP registrations", () => {
    const candidate = extension({
      id: "tools",
      permissions: ["display.present", "mcp.register"],
      contributions: { display: [{ id: "panel" }] },
      mcp: [{ id: "tools-mcp" }],
    });
    const allowed = new ExtensionRuntime(
      [candidate],
      { tools: ["display.present", "mcp.register"] },
    );
    expect(allowed.displayContributions("tools")).toEqual([{ id: "panel" }]);
    expect(allowed.mcpRegistrations("tools")).toEqual([{ id: "tools-mcp" }]);

    const denied = new ExtensionRuntime([candidate]);
    expect(() => denied.displayContributions("tools")).toThrow(
      ExtensionPermissionError,
    );
    expect(() => denied.mcpRegistrations("tools")).toThrow(
      ExtensionPermissionError,
    );
  });

  it("exposes declaration metadata but never secret values", () => {
    const runtime = new ExtensionRuntime([
      extension({
        id: "github",
        contributions: { dashboard: [{ id: "repo" }] },
        settings: { repo: { type: "string" } },
        secrets: [{ id: "github-token", required: true }],
        mcp: [{ id: "github-mcp", command: "example" }],
      }),
    ]);

    const snapshot = runtime.publicSnapshot()[0];
    expect(snapshot).toMatchObject({
      id: "github",
      secretRefs: [{ id: "github-token", required: true }],
      mcp: [{ id: "github-mcp", command: "example" }],
    });
    expect(snapshot).not.toHaveProperty("secretValue");
    expect(snapshot).not.toHaveProperty("secretValues");
  });
});
