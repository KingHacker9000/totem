import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverPackages } from "../src/discovery.js";
import { ExtensionBackendHost } from "../src/extensionBackendHost.js";
import { ExtensionRuntime } from "../src/extensionRuntime.js";

const [baseRoot, revision] = process.argv.slice(2);
assert.ok(
  baseRoot && revision,
  "Pass base-extension checkout path and revision",
);
assert.match(revision, /^[0-9a-f]{40}$/u, "Expected an exact commit revision");

const expectedIds = [
  "clock",
  "github",
  "spotify",
  "system-control",
  "system-status",
  "timer",
  "weather",
] as const;
const deterministicRuntimeIds = [
  "clock",
  "system-status",
  "timer",
  "weather",
] as const;

const root = await mkdtemp(join(tmpdir(), "totem-base-extension-host-"));
const extensions = join(root, "extensions");
let host: ExtensionBackendHost | undefined;
let deniedHost: ExtensionBackendHost | undefined;

try {
  await mkdir(extensions);
  for (const id of expectedIds) {
    await cp(resolve(baseRoot, id), join(extensions, id), { recursive: true });
  }

  const incompatible = join(extensions, "incompatible-fixture");
  await mkdir(incompatible);
  await writeFile(
    join(incompatible, "totem-extension.json"),
    JSON.stringify({
      schema: "totem.extension/v0",
      id: "incompatible-fixture",
      name: "Incompatible fixture",
      version: "0.2.0",
      compatibility: { totem: ">=9.0.0", sdk: ">=0.2.0" },
      enabledByDefault: true,
      permissions: [],
    }),
    "utf8",
  );

  const discovery = await discoverPackages({
    extensionRoots: [extensions],
    themeRoots: [],
  });
  const shipped = discovery.extensions.filter(
    (candidate) => candidate.id !== "incompatible-fixture",
  );
  assert.deepEqual(
    shipped.map((candidate) => candidate.id).sort(),
    [...expectedIds].sort(),
  );
  assert.ok(
    shipped.every((candidate) => candidate.state !== "invalid"),
    JSON.stringify(discovery),
  );

  const incompatibleCandidate = discovery.extensions.find(
    (candidate) => candidate.id === "incompatible-fixture",
  );
  assert.equal(incompatibleCandidate?.state, "invalid");
  assert.ok(
    incompatibleCandidate?.errors.some(
      (error) => error.code === "compatibility_unsatisfied",
    ),
  );

  const grants = Object.fromEntries(
    shipped.map((candidate) => [
      String(candidate.id),
      candidate.manifest?.schema === "totem.extension/v0"
        ? (candidate.manifest.permissions ?? [])
        : [],
    ]),
  );
  const runtime = await ExtensionRuntime.fromDiscovery(shipped, grants);
  host = new ExtensionBackendHost(runtime, shipped);

  for (const id of deterministicRuntimeIds) {
    await host.setEnabled(id, true);
    await host.start(id);
    assert.equal(runtime.get(id)?.state, "running");
  }
  assert.ok(runtime.get("clock")?.contributions.display);
  assert.ok(runtime.get("system-status")?.contributions.dashboard);

  const denied = await ExtensionRuntime.fromDiscovery(shipped);
  denied.setEnabled("weather", true);
  deniedHost = new ExtensionBackendHost(denied, shipped);
  await deniedHost.start("weather");
  assert.equal(denied.get("weather")?.state, "failed");
  assert.ok(
    deniedHost
      .diagnostics()
      .some((diagnostic) => diagnostic.code === "extension_permission_denied"),
  );

  console.log(
    `Base extension host integration passed for ${expectedIds.length} packages at ${revision}: exact discovery, representative runtime/contributions, default-deny, and incompatible-manifest rejection`,
  );
} finally {
  await host?.stopAll();
  await deniedHost?.stopAll();
  await rm(root, { recursive: true, force: true });
}
