import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TotemConfig } from "./config.js";
import { ensureDataDirectories } from "./runtime.js";

function configFor(root: string): TotemConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    logLevel: "silent",
    environment: "test",
    paths: {
      root,
      state: join(root, "state"),
      extensions: join(root, "extensions"),
      themes: join(root, "themes"),
      logs: join(root, "logs"),
    },
    discovery: {
      extensionRoots: [join(root, "extensions")],
      themeRoots: [join(root, "themes")],
    },
  };
}

describe("ensureDataDirectories", () => {
  it("creates the configured portable data layout", async () => {
    const parent = await mkdtemp(join(tmpdir(), "totem-core-"));
    const root = join(parent, "data");
    const config = configFor(root);

    try {
      await ensureDataDirectories(config);

      for (const path of Object.values(config.paths)) {
        expect((await stat(path)).isDirectory()).toBe(true);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
