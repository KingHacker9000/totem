import { describe, expect, it } from "vitest";
import type { DiscoveredPackageV0 } from "./discovery.js";
import { buildExtensionContributionSnapshot } from "./extensionContributions.js";
import { ExtensionRuntime } from "./extensionRuntime.js";

function extension(
  id: string,
  contributions: Record<string, unknown>,
  permissions: string[] = [],
  enabled = true,
): DiscoveredPackageV0 {
  return {
    type: "extension",
    id,
    path: `/extensions/${id}`,
    state: enabled ? "enabled" : "disabled",
    enabled,
    manifest: {
      id,
      contributions,
      permissions,
    } as unknown as DiscoveredPackageV0["manifest"],
    errors: [],
  };
}

describe("buildExtensionContributionSnapshot", () => {
  it("renders dashboard metadata without granting display authority", async () => {
    const runtime = new ExtensionRuntime([
      extension("clock", {
        dashboard: [{ id: "clock", title: "Clock" }],
        display: [{ id: "clock", title: "Clock" }],
      }),
    ]);

    const snapshot = await buildExtensionContributionSnapshot(runtime, {
      contributionSnapshot: async () => ({ display: "12:34 PM" }),
    });

    expect(snapshot.dashboard).toEqual([
      expect.objectContaining({
        extensionId: "clock",
        contributionId: "clock",
        title: "Clock",
        data: { display: "12:34 PM" },
      }),
    ]);
    expect(snapshot.display).toEqual([]);
  });

  it("includes display contributions only with an effective display.present grant", async () => {
    const runtime = new ExtensionRuntime(
      [
        extension(
          "weather",
          {
            display: [{ id: "weather", title: "Weather" }],
            dashboard: [{ id: "weather", title: "Weather" }],
          },
          ["display.present"],
        ),
      ],
      { weather: ["display.present"] },
    );

    const snapshot = await buildExtensionContributionSnapshot(runtime, {
      contributionSnapshot: async () => ({
        location: "Toronto",
        temperatureC: 4,
        condition: "cloudy",
      }),
    });

    expect(snapshot.display).toHaveLength(1);
    expect(snapshot.display[0]).toMatchObject({
      extensionId: "weather",
      contributionId: "weather",
      surface: "display",
    });
    expect(snapshot.dashboard).toHaveLength(1);
  });

  it("removes disabled or failed owners before exposing contribution data", async () => {
    const runtime = new ExtensionRuntime([
      extension("timer", {
        dashboard: [{ id: "timer", title: "Timer" }],
      }),
      extension(
        "disabled",
        { dashboard: [{ id: "hidden", title: "Hidden" }] },
        [],
        false,
      ),
    ]);

    const backendHost = {
      contributionSnapshot: async (extensionId: string) => {
        if (extensionId === "timer") {
          runtime.markFailed(extensionId, new Error("snapshot failed"));
        }
        return { activeCount: 0 };
      },
    };

    const snapshot = await buildExtensionContributionSnapshot(
      runtime,
      backendHost,
    );

    expect(snapshot).toEqual({ display: [], dashboard: [] });
  });
});
