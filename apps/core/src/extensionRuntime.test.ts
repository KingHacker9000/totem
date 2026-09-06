import { describe, expect, it } from "vitest";
import type { DiscoveredPackageV0 } from "./discovery.js";
import {
  ExtensionPermissionError,
  ExtensionRuntime,
} from "./extensionRuntime.js";

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
    manifest: manifest as DiscoveredPackageV0["manifest"],
    errors: [],
  };
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
    expect(JSON.stringify(snapshot)).not.toContain("secretValue");
  });
});
