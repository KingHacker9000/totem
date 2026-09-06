import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredPackageV0 } from "./discovery.js";
import { ExtensionBackendHost } from "./extensionBackendHost.js";
import { ExtensionRuntime } from "./extensionRuntime.js";

const directories: string[] = [];

interface FixtureOptions {
  id: string;
  permissions?: string[];
  lifecycle?: "on-enable" | "on-demand";
  backendSource?: string;
}

afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(options: FixtureOptions): Promise<DiscoveredPackageV0> {
  const root = await mkdtemp(join(tmpdir(), "totem-backend-host-"));
  directories.push(root);
  const packagePath = join(root, options.id);
  await mkdir(join(packagePath, "backend"), { recursive: true });
  const manifest = {
    schema: "totem.extension/v0",
    id: options.id,
    name: options.id,
    version: "0.2.0",
    compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
    enabledByDefault: true,
    entrypoints: { backend: "./backend/index.mjs" },
    lifecycle: { start: options.lifecycle ?? "on-enable" },
    permissions: options.permissions ?? [],
  };
  await writeFile(
    join(packagePath, "totem-extension.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  await writeFile(
    join(packagePath, "backend", "index.mjs"),
    options.backendSource ??
      "export default () => ({ async start() {}, async stop() {} });",
    "utf8",
  );
  return {
    type: "extension",
    id: options.id,
    path: packagePath,
    state: "enabled",
    enabled: true,
    manifest: manifest as unknown as DiscoveredPackageV0["manifest"],
    errors: [],
  };
}

describe("ExtensionBackendHost", () => {
  it("starts and stops a valid backend without affecting core", async () => {
    const candidate = await fixture({ id: "clock" });
    const runtime = await ExtensionRuntime.fromDiscovery([candidate]);
    const host = new ExtensionBackendHost(runtime, [candidate]);

    await host.startEnabled();
    expect(runtime.get("clock")?.state).toBe("running");
    await host.stopAll();
    expect(runtime.get("clock")?.state).toBe("ready");
    expect(host.diagnostics()).toEqual([]);
  });

  it("isolates backend startup failures to the extension", async () => {
    const candidate = await fixture({
      id: "broken",
      backendSource:
        'export default () => ({ async start() { throw new Error("fixture boom"); } });',
    });
    const runtime = await ExtensionRuntime.fromDiscovery([candidate]);
    const host = new ExtensionBackendHost(runtime, [candidate]);

    await expect(host.startEnabled()).resolves.toBeUndefined();
    expect(runtime.get("broken")).toMatchObject({ state: "failed" });
    expect(host.diagnostics()).toEqual([
      {
        extensionId: "broken",
        code: "extension_backend_start_failed",
        message: "Extension backend failed; error details withheld",
      },
    ]);
  });

  it("does not import a backend until every requested permission is granted", async () => {
    const markerRoot = await mkdtemp(join(tmpdir(), "totem-backend-marker-"));
    directories.push(markerRoot);
    const marker = join(markerRoot, "imported.txt");
    const candidate = await fixture({
      id: "networked",
      permissions: ["network.internet"],
      backendSource: `import { writeFile } from "node:fs/promises"; await writeFile(${JSON.stringify(
        marker,
      )}, "loaded"); export default () => ({ async start() {} });`,
    });
    const runtime = await ExtensionRuntime.fromDiscovery([candidate]);
    const host = new ExtensionBackendHost(runtime, [candidate]);

    await host.start("networked");
    expect(runtime.get("networked")?.state).toBe("failed");
    expect(host.diagnostics()[0]?.code).toBe("extension_permission_denied");
    await expect(access(marker)).rejects.toThrow();
  });

  it("defers on-demand backends until explicitly started", async () => {
    const candidate = await fixture({ id: "weather", lifecycle: "on-demand" });
    const runtime = await ExtensionRuntime.fromDiscovery([candidate]);
    const host = new ExtensionBackendHost(runtime, [candidate]);

    await host.startEnabled();
    expect(runtime.get("weather")?.state).toBe("ready");
    await host.start("weather");
    expect(runtime.get("weather")?.state).toBe("running");
  });
});
