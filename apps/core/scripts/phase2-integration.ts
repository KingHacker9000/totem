import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverPackages } from "../src/discovery.js";
import { ExtensionBackendHost } from "../src/extensionBackendHost.js";
import { ExtensionRuntime } from "../src/extensionRuntime.js";
import {
  InMemoryExtensionSecretProvider,
  JsonExtensionSettingsStore,
} from "../src/extensionServices.js";

const [baseRoot, sdkRoot] = process.argv.slice(2);
assert.ok(
  baseRoot && sdkRoot,
  "Pass base-extensions and extension-sdk checkout paths",
);
const root = await mkdtemp(join(tmpdir(), "totem-phase2-"));
const extensions = join(root, "extensions");
let host: ExtensionBackendHost | undefined;
try {
  await mkdir(extensions);
  for (const id of ["clock", "weather", "timer", "system-status"]) {
    await cp(resolve(baseRoot, id), join(extensions, id), { recursive: true });
  }
  await cp(
    resolve(sdkRoot, "examples/hello-world"),
    join(extensions, "hello-world"),
    { recursive: true },
  );
  await writeFile(
    join(extensions, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const broken = join(extensions, "broken");
  await mkdir(broken);
  await writeFile(
    join(broken, "totem-extension.json"),
    JSON.stringify({
      schema: "totem.extension/v0",
      id: "broken",
      name: "Broken",
      version: "0.2.0",
      compatibility: { totem: ">=0.2.0 <0.3.0", sdk: ">=0.2.0 <0.3.0" },
      enabledByDefault: true,
      entrypoints: { backend: "index.mjs" },
      permissions: ["secrets.read:test-key", "mcp.register"],
      secrets: [{ id: "test-key" }],
      mcp: [{ id: "fixture" }],
    }),
  );
  await writeFile(
    join(broken, "index.mjs"),
    'export default context => ({ async start() { throw new Error(await context.secrets.get("test-key")); } });',
  );
  const discovery = await discoverPackages({
    extensionRoots: [extensions],
    themeRoots: [],
  });
  assert.equal(discovery.extensions.length, 6);
  assert.ok(
    discovery.extensions.every((p) => p.state !== "invalid"),
    JSON.stringify(discovery),
  );
  const settings = new JsonExtensionSettingsStore(join(root, "settings.json"));
  const grants = Object.fromEntries(
    discovery.extensions.map((p) => [
      String(p.id),
      p.manifest?.schema === "totem.extension/v0"
        ? (p.manifest.permissions ?? [])
        : [],
    ]),
  );
  const runtime = await ExtensionRuntime.fromDiscovery(
    discovery.extensions,
    grants,
    {
      settings,
      secrets: new InMemoryExtensionSecretProvider({
        broken: { "test-key": "fixture-secret-never-in-diagnostics" },
      }),
    },
  );
  await runtime.setSetting("clock", "timeZone", "UTC");
  assert.equal((await runtime.getSettings("clock")).timeZone, "UTC");
  assert.equal(
    (
      await ExtensionRuntime.fromDiscovery(discovery.extensions, grants, {
        settings,
      }).then((r) => r.getSettings("clock"))
    ).timeZone,
    "UTC",
  );
  assert.equal(runtime.mcpRegistrations("broken").length, 1);
  assert.ok(runtime.get("clock")?.contributions.display);
  host = new ExtensionBackendHost(runtime, discovery.extensions);
  for (const id of [
    "clock",
    "weather",
    "timer",
    "system-status",
    "hello-world",
    "broken",
  ]) {
    await host.setEnabled(id, true);
    await host.start(id);
    assert.equal(
      runtime.get(id)?.state,
      id === "broken" ? "failed" : id === "hello-world" ? "ready" : "running",
    );
  }
  assert.ok(
    !JSON.stringify([runtime.publicSnapshot(), host.diagnostics()]).includes(
      "fixture-secret-never-in-diagnostics",
    ),
  );
  for (const id of ["clock", "weather", "timer", "system-status"]) {
    await host.setEnabled(id, false);
    assert.equal(runtime.get(id)?.state, "disabled");
    await host.setEnabled(id, true);
    await host.start(id);
    assert.equal(runtime.get(id)?.state, "running");
  }
  const denied = await ExtensionRuntime.fromDiscovery(discovery.extensions);
  denied.setEnabled("weather", true);
  const deniedHost = new ExtensionBackendHost(denied, discovery.extensions);
  await deniedHost.start("weather");
  assert.equal(denied.get("weather")?.state, "failed");
  assert.equal(
    deniedHost.diagnostics()[0]?.code,
    "extension_permission_denied",
  );
  assert.throws(() => denied.mcpRegistrations("broken"));
  console.log(
    "Phase 2 integration passed: five public packages, lifecycle/restart, settings persistence, permission denial, MCP and secret-safe failure isolation",
  );
} finally {
  await host?.stopAll();
  await rm(root, { recursive: true, force: true });
}
