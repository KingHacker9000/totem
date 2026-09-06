import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("extension permission grant configuration", () => {
  it("parses explicit grants and deduplicates permissions", () => {
    const config = loadConfig({
      platform: "linux",
      homeDir: "/home/tester",
      env: {
        TOTEM_ENV: "test",
        TOTEM_EXTENSION_GRANTS: JSON.stringify({
          weather: ["display.present", "display.present", "network.internet"],
        }),
      },
    });

    expect(config.extensionGrants).toEqual({
      weather: ["display.present", "network.internet"],
    });
  });

  it("rejects malformed grant maps instead of granting ambiguously", () => {
    expect(() =>
      loadConfig({
        platform: "linux",
        homeDir: "/home/tester",
        env: { TOTEM_EXTENSION_GRANTS: '{"weather":"network.internet"}' },
      }),
    ).toThrow(ConfigError);

    expect(() =>
      loadConfig({
        platform: "linux",
        homeDir: "/home/tester",
        env: { TOTEM_EXTENSION_GRANTS: '{"Bad ID":["network.internet"]}' },
      }),
    ).toThrow(ConfigError);
  });
});
