import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RegistryManager } from "../src/ecosystemRoutes.js";

const registryRoot = process.argv[2];
const expectedRevision = process.argv[3];
if (!registryRoot || !expectedRevision) {
  throw new Error(
    "usage: registry-integration.ts <registry-root> <expected-revision>",
  );
}

const root = resolve(registryRoot);
const moduleUrl = pathToFileURL(join(root, "src", "registry.js")).href;
const registry = (await import(moduleUrl)) as {
  createRegistryIndex(input: {
    generatedAt: string;
    packages: Array<Record<string, unknown>>;
  }): unknown;
  signRegistryIndex(
    index: unknown,
    privateKeyPem: string,
    keyId: string,
  ): unknown;
  verifySignedRegistry(
    signedIndex: unknown,
    trustedKeys: Record<string, string>,
  ): { ok: boolean; reason?: string };
};

const revision = (await import("node:child_process"))
  .execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  })
  .trim();
if (revision !== expectedRevision) {
  throw new Error(
    `registry revision mismatch: expected ${expectedRevision}, got ${revision}`,
  );
}

const artifact = Buffer.from("totem-registry-integration-artifact-v1");
const sha256 = createHash("sha256").update(artifact).digest("hex");
const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const { publicKey: untrustedPublicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const candidate = {
  id: "integration-clock",
  kind: "extension",
  version: "1.0.0",
  source: "https://registry.invalid/integration-clock.totem",
  sha256,
  compatibility: { totem: ">=0" },
  permissions: ["display.read"],
};
const index = registry.createRegistryIndex({
  generatedAt: "1970-01-01T00:00:00Z",
  packages: [candidate],
});
const signed = registry.signRegistryIndex(index, privateKey, "integration-key");
const packageVerification = registry.verifySignedRegistry(signed, {
  "integration-key": publicKey,
});
if (!packageVerification.ok) {
  throw new Error(
    `registry package rejected its own signed fixture: ${packageVerification.reason}`,
  );
}
if (
  registry.verifySignedRegistry(signed, {
    "integration-key": untrustedPublicKey,
  }).ok
) {
  throw new Error(
    "registry package accepted a signature under the wrong public key",
  );
}

const stateDir = await mkdtemp(join(tmpdir(), "totem-registry-integration-"));
try {
  const host = new RegistryManager({
    stateDir,
    trustedKeys: { "integration-key": publicKey },
    fetchImpl: (async () => new Response(artifact)) as typeof fetch,
  });

  const empty = await host.snapshot();
  if (
    empty.packages.length !== 0 ||
    Object.keys(empty.installed).length !== 0
  ) {
    throw new Error("registry-free host state must remain usable and empty");
  }

  await host.setCatalog(signed as never);
  const denied = await host.install({
    kind: "extension",
    id: "integration-clock",
  });
  if (
    denied.installed !== false ||
    denied.reason !== "permissions_required" ||
    denied.missingPermissions?.join(",") !== "display.read"
  ) {
    throw new Error(
      "registry discovery must not auto-grant package permissions",
    );
  }

  const installed = await host.install({
    kind: "extension",
    id: "integration-clock",
    grantedPermissions: ["display.read"],
  });
  if (!installed.installed)
    throw new Error("permission-approved registry install failed");

  const stored = await readFile(
    join(
      stateDir,
      "registry",
      "artifacts",
      "extension",
      "integration-clock",
      "1.0.0.artifact",
    ),
  );
  if (!stored.equals(artifact))
    throw new Error("host persisted unexpected registry artifact bytes");

  const rollback = await host.rollback("extension", "integration-clock");
  if (rollback.toVersion !== null)
    throw new Error("rollback did not restore the prior empty state");

  const tampered = structuredClone(signed) as {
    index: { packages: Array<{ version: string }> };
  };
  const firstPackage = tampered.index.packages[0];
  if (!firstPackage) throw new Error("signed registry fixture has no package");
  firstPackage.version = "9.9.9";
  await host.setCatalog(tampered as never).then(
    () => {
      throw new Error("host accepted tampered signed registry metadata");
    },
    () => undefined,
  );

  const badArtifactHost = new RegistryManager({
    stateDir: join(stateDir, "bad-artifact"),
    trustedKeys: { "integration-key": publicKey },
    fetchImpl: (async () =>
      new Response(Buffer.from("tampered"))) as typeof fetch,
  });
  await badArtifactHost.setCatalog(signed as never);
  await badArtifactHost
    .install({
      kind: "extension",
      id: "integration-clock",
      grantedPermissions: ["display.read"],
    })
    .then(
      () => {
        throw new Error(
          "host accepted artifact bytes that failed the registry digest",
        );
      },
      () => undefined,
    );
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    schema: "totem.registry-host-integration/v1",
    registryRevision: revision,
    signatureTrust: "PASS",
    artifactIntegrity: "PASS",
    permissionBoundary: "PASS",
    rollback: "PASS",
    registryOptional: "PASS",
  }),
);
