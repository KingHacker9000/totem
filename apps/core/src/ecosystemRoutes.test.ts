import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type RegistryPackageVersion,
  RegistryManager,
  RemoteNodeManager,
  type SignedRegistryIndex,
} from "./ecosystemRoutes.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

function signedCatalog(pkg: RegistryPackageVersion, privateKey: string): SignedRegistryIndex {
  const index = {
    schema: "totem.registry/v0",
    generatedAt: "2026-09-06T12:00:00Z",
    packages: [pkg],
  };
  return {
    index,
    signature: {
      algorithm: "Ed25519",
      keyId: "test-key",
      value: sign(
        null,
        Buffer.from(JSON.stringify(canonicalize(index))),
        privateKey,
      ).toString("base64url"),
    },
  };
}

describe("RegistryManager", () => {
  it("verifies catalogs, installs verified artifacts, and rolls back", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "totem-registry-test-"));
    tempDirs.push(stateDir);
    const artifact = Buffer.from("totem-test-package");
    const sha256 = createHash("sha256").update(artifact).digest("hex");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const pkg: RegistryPackageVersion = {
      id: "clock",
      kind: "extension",
      version: "2.0.0",
      source: "https://registry.example/clock.totem",
      sha256,
      permissions: ["display.read"],
    };
    const manager = new RegistryManager({
      stateDir,
      trustedKeys: { "test-key": publicKey },
      fetchImpl: (async () => new Response(artifact)) as typeof fetch,
    });

    await manager.setCatalog(signedCatalog(pkg, privateKey));
    const denied = await manager.install({ kind: "extension", id: "clock" });
    expect(denied).toEqual({
      installed: false,
      reason: "permissions_required",
      missingPermissions: ["display.read"],
    });

    const installed = await manager.install({
      kind: "extension",
      id: "clock",
      grantedPermissions: ["display.read"],
    });
    expect(installed.installed).toBe(true);
    expect((await manager.snapshot()).installed["extension:clock"]?.version).toBe("2.0.0");
    expect(
      await readFile(
        join(stateDir, "registry", "artifacts", "extension", "clock", "2.0.0.artifact"),
        "utf8",
      ),
    ).toBe("totem-test-package");

    const rollback = await manager.rollback("extension", "clock");
    expect(rollback.toVersion).toBeNull();
    expect((await manager.snapshot()).installed["extension:clock"]).toBeUndefined();
  });

  it("rejects untrusted registry signatures", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "totem-registry-test-"));
    tempDirs.push(stateDir);
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const manager = new RegistryManager({ stateDir });
    const pkg: RegistryPackageVersion = {
      id: "clock",
      kind: "extension",
      version: "1.0.0",
      source: "https://registry.example/clock.totem",
      sha256: "0".repeat(64),
    };
    await expect(manager.setCatalog(signedCatalog(pkg, privateKey))).rejects.toThrow(
      "not trusted",
    );
  });
});

describe("RemoteNodeManager", () => {
  it("registers, probes, capability-checks, invokes, and removes nodes", async () => {
    const requests: string[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/descriptor")) {
        return Response.json({
          schema: "totem.node/v0",
          id: "desk",
          platform: "linux",
          capabilities: ["system.status"],
        });
      }
      if (url.endsWith("/health")) {
        return Response.json({ status: "ok", nodeId: "desk" });
      }
      if (url.endsWith("/invoke")) {
        return Response.json({
          nodeId: "desk",
          capability: "system.status",
          result: { load: 0.25 },
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }) as typeof fetch;
    const manager = new RemoteNodeManager(fakeFetch);

    const node = await manager.register("desk", "http://node.example:8080");
    expect(node.descriptor.capabilities).toContain("system.status");
    expect((await manager.list())[0]?.status).toBe("online");
    await expect(manager.invoke("desk", "missing", {})).rejects.toThrow("not advertised");
    expect(await manager.invoke("desk", "system.status", {})).toMatchObject({
      result: { load: 0.25 },
    });
    expect(manager.remove("desk")).toBe(true);
    expect(await manager.list()).toEqual([]);
    expect(requests.some((request) => request.startsWith("POST ") && request.endsWith("/invoke"))).toBe(true);
  });
});
