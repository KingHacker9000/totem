import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPackages } from "./discovery.js";

async function writeManifest(
  root: string,
  directory: string,
  filename: string,
  manifest: unknown,
): Promise<string> {
  const packagePath = join(root, directory);
  await mkdir(packagePath, { recursive: true });
  await writeFile(
    join(packagePath, filename),
    JSON.stringify(manifest),
    "utf8",
  );
  return packagePath;
}

describe("discoverPackages", () => {
  it("discovers valid packages, reports malformed candidates, and selects default theme", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-discovery-"));
    const extensions = join(root, "extensions");
    const themes = join(root, "themes");
    await mkdir(extensions);
    await mkdir(themes);

    await writeManifest(extensions, "clock", "totem-extension.json", {
      schema: "totem.extension/v0",
      compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
      id: "clock",
      name: "Clock",
      version: "0.1.0",
      enabledByDefault: true,
      permissions: [],
    });
    await writeManifest(extensions, "broken", "totem-extension.json", {
      schema: "totem.extension/v0",
      compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
      id: "Broken Extension",
      name: "Broken",
      version: "not-semver",
    });
    await writeManifest(themes, "default", "totem-theme.json", {
      schema: "totem.theme/v0",
      id: "default",
      name: "Totem Default",
      version: "0.1.0",
      enabledByDefault: true,
    });

    const snapshot = await discoverPackages({
      extensionRoots: [extensions],
      themeRoots: [themes],
    });

    expect(snapshot.extensions).toHaveLength(2);
    expect(
      snapshot.extensions.find((candidate) => candidate.id === "clock"),
    ).toMatchObject({
      state: "enabled",
      enabled: true,
    });
    expect(
      snapshot.extensions.find(
        (candidate) => candidate.id === "Broken Extension",
      ),
    ).toMatchObject({
      state: "invalid",
      enabled: false,
    });
    expect(
      snapshot.extensions
        .find((candidate) => candidate.id === "Broken Extension")
        ?.errors.map((error) => error.code),
    ).toEqual(expect.arrayContaining(["id_invalid", "version_invalid"]));
    expect(snapshot.activeTheme).toMatchObject({
      source: "default",
      id: "default",
    });
  });

  it("rejects theme privilege fields and falls back safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-theme-security-"));
    const themes = join(root, "themes");
    await mkdir(themes);

    await writeManifest(themes, "unsafe", "totem-theme.json", {
      schema: "totem.theme/v0",
      id: "unsafe",
      name: "Unsafe",
      version: "1.0.0",
      enabledByDefault: true,
      capabilities: ["network"],
    });

    const snapshot = await discoverPackages({
      extensionRoots: [],
      themeRoots: [themes],
      activeThemeId: "unsafe",
    });

    expect(snapshot.themes[0]).toMatchObject({
      state: "invalid",
      enabled: false,
    });
    expect(snapshot.themes[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "theme_privilege_field_forbidden" }),
    );
    expect(snapshot.activeTheme).toEqual({
      source: "fallback",
      id: null,
      packagePath: null,
    });
  });

  it("marks duplicate ids invalid and honors explicit enablement", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-duplicates-"));
    const firstRoot = join(root, "extensions-a");
    const secondRoot = join(root, "extensions-b");
    await mkdir(firstRoot);
    await mkdir(secondRoot);

    const manifest = {
      schema: "totem.extension/v0",
      compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
      id: "clock",
      name: "Clock",
      version: "0.1.0",
      enabledByDefault: true,
    };
    await writeManifest(firstRoot, "one", "totem-extension.json", manifest);
    await writeManifest(secondRoot, "two", "totem-extension.json", manifest);

    const duplicateSnapshot = await discoverPackages({
      extensionRoots: [firstRoot, secondRoot],
      themeRoots: [],
    });
    expect(duplicateSnapshot.extensions).toHaveLength(2);
    expect(
      duplicateSnapshot.extensions.every(
        (candidate) =>
          candidate.state === "invalid" &&
          candidate.errors.some((error) => error.code === "id_duplicate"),
      ),
    ).toBe(true);

    const singleSnapshot = await discoverPackages({
      extensionRoots: [firstRoot],
      themeRoots: [],
      enablement: { "extension:clock": false },
    });
    expect(singleSnapshot.extensions[0]).toMatchObject({
      state: "disabled",
      enabled: false,
    });
  });
});

it("rejects incompatible and overprivileged manifests through the public SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), "totem-sdk-discovery-"));
  const base = {
    schema: "totem.extension/v0",
    name: "Fixture",
    version: "0.2.0",
    compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
    enabledByDefault: true,
  };
  await writeManifest(root, "unknown", "totem-extension.json", {
    ...base,
    id: "unknown",
    permissions: ["network"],
  });
  await writeManifest(root, "incompatible", "totem-extension.json", {
    ...base,
    id: "incompatible",
    compatibility: { totem: ">=9.0.0", sdk: ">=0.2.0" },
  });
  await writeManifest(root, "escape", "totem-extension.json", {
    ...base,
    id: "escape",
    entrypoints: { backend: "../../outside.js" },
  });
  const snapshot = await discoverPackages({
    extensionRoots: [root],
    themeRoots: [],
  });
  expect(snapshot.extensions).toHaveLength(3);
  expect(
    snapshot.extensions.every((candidate) => candidate.state === "invalid"),
  ).toBe(true);
  expect(
    snapshot.extensions.flatMap((candidate) =>
      candidate.errors.map((error) => error.code),
    ),
  ).toEqual(
    expect.arrayContaining([
      "permission_unknown",
      "compatibility_unsatisfied",
      "entrypoint_invalid",
    ]),
  );
});
