import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryExtensionSecretProvider,
  JsonExtensionSettingsStore,
} from "./extensionServices.js";

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function settingsFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "totem-extension-settings-"));
  directories.push(directory);
  return join(directory, "state", "extensions.json");
}

describe("extension runtime services", () => {
  it("persists settings across store instances", async () => {
    const filename = await settingsFile();
    const first = new JsonExtensionSettingsStore(filename);
    await first.set("weather", "units", "imperial");
    await first.set("weather", "offline", true);

    const reopened = new JsonExtensionSettingsStore(filename);
    await expect(reopened.get("weather")).resolves.toEqual({
      units: "imperial",
      offline: true,
    });
  });

  it("fails closed when the durable settings file is malformed", async () => {
    const filename = await settingsFile();
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, '{"version":99,"extensions":{}}', "utf8");
    await expect(
      new JsonExtensionSettingsStore(filename).get("weather"),
    ).rejects.toThrow("Invalid extension settings file");
  });

  it("keeps secret values process-local", async () => {
    const provider = new InMemoryExtensionSecretProvider({
      github: { token: "secret-token" },
    });
    await expect(provider.get("github", "token")).resolves.toBe("secret-token");
    await expect(provider.get("github", "missing")).resolves.toBeUndefined();
    expect(JSON.stringify(provider)).not.toContain("secret-token");
  });
});
