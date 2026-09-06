import { delimiter, join, resolve } from "node:path";
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
    expect(config.discovery).toEqual({
      extensionRoots: [config.paths.extensions],
      themeRoots: [config.paths.themes],
    });
    expect(config.speech).toEqual({
      stt: { provider: "none" },
      tts: { provider: "none" },
      agentProviderId: "mock",
      vadThreshold: 0.015,
    });
  });

  it("accepts explicit portable overrides", () => {
    const config = loadConfig({
      env: {
        TOTEM_HOST: "localhost",
        TOTEM_PORT: "4312",
        TOTEM_LOG_LEVEL: "debug",
        TOTEM_ENV: "test",
        TOTEM_DATA_DIR: "./var/totem-test",
        TOTEM_EXTENSION_ROOTS: [
          "./fixtures/extensions",
          "./vendor/extensions",
        ].join(delimiter),
        TOTEM_THEME_ROOTS: "./fixtures/themes",
        TOTEM_ACTIVE_THEME: "minimal",
        TOTEM_STT_PROVIDER: "whisper.cpp",
        TOTEM_STT_EXECUTABLE: "./bin/whisper-cli",
        TOTEM_STT_MODEL: "./models/whisper.bin",
        TOTEM_TTS_PROVIDER: "piper",
        TOTEM_TTS_EXECUTABLE: "./bin/piper",
        TOTEM_TTS_MODEL: "./models/voice.onnx",
        TOTEM_SPEECH_AGENT_PROVIDER: "codex-cli",
        TOTEM_SPEECH_VAD_THRESHOLD: "0.02",
      },
    });

    expect(config).toMatchObject({
      host: "localhost",
      port: 4312,
      logLevel: "debug",
      environment: "test",
      discovery: {
        extensionRoots: [
          resolve("./fixtures/extensions"),
          resolve("./vendor/extensions"),
        ],
        themeRoots: [resolve("./fixtures/themes")],
        activeThemeId: "minimal",
      },
      speech: {
        stt: {
          provider: "whisper.cpp",
          executablePath: resolve("./bin/whisper-cli"),
          modelPath: resolve("./models/whisper.bin"),
        },
        tts: {
          provider: "piper",
          executablePath: resolve("./bin/piper"),
          modelPath: resolve("./models/voice.onnx"),
        },
        agentProviderId: "codex-cli",
        vadThreshold: 0.02,
      },
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
          TOTEM_ACTIVE_THEME: "Invalid Theme",
          TOTEM_STT_PROVIDER: "cloud",
          TOTEM_TTS_PROVIDER: "cloud",
          TOTEM_SPEECH_AGENT_PROVIDER: "Invalid Provider",
          TOTEM_SPEECH_VAD_THRESHOLD: "2",
        },
      });
      throw new Error("expected loadConfig to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        "TOTEM_ACTIVE_THEME must be a valid package id",
        "TOTEM_HOST must be a hostname or IP address without whitespace or slashes",
        "TOTEM_PORT must be an integer between 1 and 65535",
        "TOTEM_LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent",
        "TOTEM_ENV must be development, test, or production",
        "TOTEM_STT_PROVIDER must be one of: none, whisper.cpp",
        "TOTEM_TTS_PROVIDER must be one of: none, piper",
        "TOTEM_SPEECH_AGENT_PROVIDER must be 'mock' or a valid provider id",
        "TOTEM_SPEECH_VAD_THRESHOLD must be a number between 0 and 1",
      ]);
    }
  });
});
