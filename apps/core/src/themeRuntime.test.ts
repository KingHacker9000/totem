import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ThemeRuntime, ThemeRuntimeError } from "./themeRuntime.js";

async function writeTheme(root: string, id: string, manifest: unknown): Promise<void> {
  const path = join(root, id);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "totem-theme.json"), JSON.stringify(manifest), "utf8");
}

function manifest(id: string, extra: Record<string, unknown> = {}) {
  return {
    schema: "totem.theme/v0",
    id,
    name: id,
    version: "1.0.0",
    ...extra,
  };
}

describe("ThemeRuntime", () => {
  it("hydrates the full manifest, hot switches disabled-by-default themes, persists, and rolls back", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-theme-runtime-"));
    const themes = join(root, "themes");
    const stateFile = join(root, "state", "theme-state.json");
    await mkdir(themes);
    await writeTheme(
      themes,
      "default",
      manifest("default", {
        enabledByDefault: true,
        presentation: { tokens: { accent: "blue" } },
      }),
    );
    await writeTheme(
      themes,
      "minimal",
      manifest("minimal", {
        presentation: { ambient: { scene: "ambient" } },
        persona: { name: "Minimal" },
        voice: { provider: "local", voice: "neutral" },
      }),
    );

    const runtime = new ThemeRuntime({ themeRoots: [themes], stateFile });
    expect(await runtime.snapshot()).toMatchObject({
      activeThemeId: "default",
      source: "default",
      manifest: { presentation: { tokens: { accent: "blue" } } },
    });

    const switched = await runtime.activate("minimal");
    expect(switched).toMatchObject({
      activeThemeId: "minimal",
      previousThemeId: "default",
      source: "persisted",
      manifest: {
        persona: { name: "Minimal" },
        voice: { provider: "local", voice: "neutral" },
      },
    });

    const restarted = new ThemeRuntime({ themeRoots: [themes], stateFile });
    expect(await restarted.snapshot()).toMatchObject({
      activeThemeId: "minimal",
      source: "persisted",
    });
    expect(await restarted.rollback()).toMatchObject({
      activeThemeId: "default",
      previousThemeId: "minimal",
    });
  });

  it("rejects nested privilege-bearing fields before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-theme-privilege-"));
    const themes = join(root, "themes");
    await mkdir(themes);
    await writeTheme(themes, "default", manifest("default", { enabledByDefault: true }));
    await writeTheme(
      themes,
      "unsafe",
      manifest("unsafe", { presentation: { tokens: { nested: { network: true } } } }),
    );

    const runtime = new ThemeRuntime({
      themeRoots: [themes],
      stateFile: join(root, "theme-state.json"),
    });
    await expect(runtime.activate("unsafe")).rejects.toMatchObject<ThemeRuntimeError>({
      code: "theme_invalid",
    });
  });

  it("falls back deterministically when configured or persisted ids disappear", async () => {
    const root = await mkdtemp(join(tmpdir(), "totem-theme-fallback-"));
    const themes = join(root, "themes");
    const stateFile = join(root, "state", "theme-state.json");
    await mkdir(themes);
    await writeTheme(themes, "default", manifest("default", { enabledByDefault: true }));
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ activeThemeId: "missing" }), "utf8");

    const runtime = new ThemeRuntime({
      themeRoots: [themes],
      stateFile,
      configuredThemeId: "also-missing",
    });
    expect(await runtime.snapshot()).toMatchObject({
      activeThemeId: "default",
      source: "default",
    });
  });
});
