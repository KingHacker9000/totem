import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPackages } from "../src/discovery.js";

const root = process.argv[2];
const expectedRevision = process.argv[3];
if (!root || !expectedRevision) {
  throw new Error(
    "usage: theme-integration.ts <base-themes-root> <expected-revision>",
  );
}

const expectedIds = ["default", "minimal", "retro-terminal"];
const installationRoot = await mkdtemp(
  join(tmpdir(), "totem-theme-integration-installation-"),
);
for (const id of expectedIds) {
  await cp(join(root, id), join(installationRoot, id), {
    recursive: true,
    errorOnExist: true,
  });
}

const snapshot = await discoverPackages({
  extensionRoots: [],
  themeRoots: [installationRoot],
  activeThemeId: "minimal",
  enablement: { "theme:minimal": true },
});

if (snapshot.rootDiagnostics.length !== 0) {
  throw new Error(
    `theme root diagnostics: ${JSON.stringify(snapshot.rootDiagnostics)}`,
  );
}

const actualIds = snapshot.themes
  .filter((theme) => theme.state !== "invalid")
  .map((theme) => theme.id)
  .sort();
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error(
    `expected themes ${expectedIds.join(",")}, got ${actualIds.join(",")}`,
  );
}
for (const theme of snapshot.themes) {
  if (
    theme.state === "invalid" ||
    theme.errors.length !== 0 ||
    !theme.manifest
  ) {
    throw new Error(
      `invalid public theme ${theme.id ?? theme.path}: ${JSON.stringify(theme.errors)}`,
    );
  }
}
if (
  snapshot.activeTheme.id !== "minimal" ||
  snapshot.activeTheme.source !== "configured"
) {
  throw new Error(
    `configured theme selection failed: ${JSON.stringify(snapshot.activeTheme)}`,
  );
}

const invalidRoot = await mkdtemp(
  join(tmpdir(), "totem-theme-integration-invalid-"),
);
const invalidTheme = join(invalidRoot, "unsafe");
await mkdir(invalidTheme);
await writeFile(
  join(invalidTheme, "totem-theme.json"),
  JSON.stringify({
    schema: "totem.theme/v0",
    id: "unsafe",
    name: "Unsafe",
    version: "1.0.0",
    enabledByDefault: true,
    capabilities: ["network.internet"],
  }),
  "utf8",
);
const invalidSnapshot = await discoverPackages({
  extensionRoots: [],
  themeRoots: [invalidRoot],
  activeThemeId: "unsafe",
});
const unsafe = invalidSnapshot.themes[0];
if (
  unsafe?.state !== "invalid" ||
  !unsafe.errors.some(
    (error) => error.code === "theme_privilege_field_forbidden",
  )
) {
  throw new Error(
    `unsafe theme did not fail closed: ${JSON.stringify(unsafe)}`,
  );
}
if (invalidSnapshot.activeTheme.source !== "fallback") {
  throw new Error(
    `invalid theme was selected: ${JSON.stringify(invalidSnapshot.activeTheme)}`,
  );
}

console.log(
  JSON.stringify({
    schema: "totem.theme-host-integration/v1",
    baseThemesRevision: expectedRevision,
    installationRoot: "staged-public-themes",
    discoveredThemeIds: actualIds,
    activeTheme: snapshot.activeTheme.id,
    invalidFixture: "rejected",
  }),
);
