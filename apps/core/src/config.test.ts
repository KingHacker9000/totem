import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses safe local defaults", () => {
    const config = loadConfig({ env: {} });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe("info");
    expect(config.environment).toBe("development");
    expect(config.paths.root.length).toBeGreaterThan(0);
    expect(config.paths.state).toBe(join(config.paths.root, "state"));
    expect(config.paths.extensions).toBe(join(config.paths.root, "extensions"));
    expect(config.paths.themes).toBe(join(config.paths.root, "themes"));
    expect(config.paths.logs).toBe(join(config.paths.root, "logs"));
  });

  it("accepts explicit portable overrides", () => {
    const config = loadConfig({
      env: {
        TOTEM_HOST: "localhost",
        TOTEM_PORT: "4312",
        TOTEM_LOG_LEVEL: "debug",
        TOTEM_ENV: "test",
        TOTEM_DATA_DIR: "./var/totem-test",
      },
    });

    expect(config).toMatchObject({
      host: "localhost",
      port: 4312,
      logLevel: "debug",
      environment: "test",
    });
    expect(config.paths.root).toBe(resolve("./var/totem-test"));
  });

  it("reports deterministic validation failures", () => {
    try {
      loadConfig({
        env: {
          TOTEM_HOST: "bad host/name",
          TOTEM_PORT: "70000",
          TOTEM_LOG_LEVEL: "verbose",
          TOTEM_ENV: "qa",
        },
      });
      throw new Error("expected loadConfig to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        "TOTEM_HOST must be a hostname or IP address without whitespace or slashes",
        "TOTEM_PORT must be an integer between 1 and 65535",
        "TOTEM_LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent",
        "TOTEM_ENV must be development, test, or production",
      ]);
    }
  });
});
