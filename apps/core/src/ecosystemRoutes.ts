import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";

const REGISTRY_SCHEMA = "totem.registry/v0";
const ROLLBACK_SCHEMA = "totem.registry.rollback/v0";

export interface RegistryPackageVersion {
  id: string;
  kind: "extension" | "theme" | "agent-provider" | "node-plugin";
  version: string;
  source: string;
  sha256: string;
  compatibility?: { totem?: string };
  permissions?: string[];
}

export interface SignedRegistryIndex {
  index: {
    schema: string;
    generatedAt: string;
    packages: RegistryPackageVersion[];
  };
  signature: {
    algorithm: string;
    keyId: string;
    value: string;
  };
}

interface RegistryState {
  catalog?: SignedRegistryIndex;
  installed: Record<string, RegistryPackageVersion>;
  rollback: Record<string, RegistryPackageVersion | null>;
}

export interface RemoteNodeDescriptor {
  schema: string;
  id: string;
  platform: string;
  capabilities: string[];
  [key: string]: unknown;
}

interface RemoteNodeRecord {
  id: string;
  url: string;
  descriptor: RemoteNodeDescriptor;
  registeredAt: string;
}

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function packageKey(pkg: Pick<RegistryPackageVersion, "kind" | "id">): string {
  return `${pkg.kind}:${pkg.id}`;
}

function assertPackage(
  value: unknown,
): asserts value is RegistryPackageVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("registry package must be an object");
  }
  const pkg = value as Record<string, unknown>;
  const kinds = new Set([
    "extension",
    "theme",
    "agent-provider",
    "node-plugin",
  ]);
  if (typeof pkg.id !== "string" || pkg.id.trim() === "") {
    throw new Error("registry package id is required");
  }
  if (typeof pkg.kind !== "string" || !kinds.has(pkg.kind)) {
    throw new Error("registry package kind is invalid");
  }
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error("registry package version is required");
  }
  if (typeof pkg.source !== "string" || pkg.source.trim() === "") {
    throw new Error("registry package source is required");
  }
  if (typeof pkg.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(pkg.sha256)) {
    throw new Error("registry package sha256 must be 64 hex characters");
  }
  if (
    pkg.permissions !== undefined &&
    (!Array.isArray(pkg.permissions) ||
      pkg.permissions.some((permission) => typeof permission !== "string"))
  ) {
    throw new Error("registry package permissions must be a string array");
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export class RegistryManager {
  readonly #stateFile: string;
  readonly #artifactRoot: string;
  readonly #trustedKeys: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;

  constructor(options: {
    stateDir: string;
    trustedKeys?: Readonly<Record<string, string>>;
    fetchImpl?: typeof fetch;
  }) {
    this.#stateFile = join(options.stateDir, "registry", "state.json");
    this.#artifactRoot = join(options.stateDir, "registry", "artifacts");
    this.#trustedKeys = options.trustedKeys ?? {};
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #readState(): Promise<RegistryState> {
    try {
      const parsed = JSON.parse(
        await readFile(this.#stateFile, "utf8"),
      ) as RegistryState;
      return {
        ...parsed,
        installed: parsed.installed ?? {},
        rollback: parsed.rollback ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { installed: {}, rollback: {} };
      }
      throw error;
    }
  }

  async #writeState(state: RegistryState): Promise<void> {
    await writeJsonAtomic(this.#stateFile, state);
  }

  #verifyCatalog(signed: SignedRegistryIndex): void {
    if (signed.index?.schema !== REGISTRY_SCHEMA) {
      throw new Error("unsupported registry schema");
    }
    if (!Array.isArray(signed.index.packages)) {
      throw new Error("registry packages must be an array");
    }
    for (const pkg of signed.index.packages) assertPackage(pkg);
    if (signed.signature?.algorithm !== "Ed25519") {
      throw new Error("unsupported registry signature algorithm");
    }
    const publicKeyPem = this.#trustedKeys[signed.signature.keyId];
    if (!publicKeyPem) throw new Error("registry signing key is not trusted");
    const ok = verify(
      null,
      Buffer.from(canonicalJson(signed.index)),
      createPublicKey(publicKeyPem),
      Buffer.from(signed.signature.value, "base64url"),
    );
    if (!ok) throw new Error("registry signature is invalid");
  }

  async setCatalog(signed: SignedRegistryIndex): Promise<void> {
    this.#verifyCatalog(signed);
    const state = await this.#readState();
    state.catalog = signed;
    await this.#writeState(state);
  }

  async snapshot(query?: { q?: string; kind?: string }) {
    const state = await this.#readState();
    const needle = query?.q?.trim().toLowerCase();
    const packages = (state.catalog?.index.packages ?? []).filter((pkg) => {
      if (query?.kind && pkg.kind !== query.kind) return false;
      if (!needle) return true;
      return `${pkg.id} ${pkg.kind} ${pkg.version}`
        .toLowerCase()
        .includes(needle);
    });
    return {
      catalog: state.catalog
        ? {
            schema: state.catalog.index.schema,
            generatedAt: state.catalog.index.generatedAt,
            keyId: state.catalog.signature.keyId,
          }
        : null,
      packages,
      installed: state.installed,
      rollbackAvailable: Object.fromEntries(
        Object.entries(state.rollback).map(([key, value]) => [
          key,
          value !== null,
        ]),
      ),
    };
  }

  async install(input: {
    kind: RegistryPackageVersion["kind"];
    id: string;
    version?: string;
    grantedPermissions?: string[];
  }) {
    const state = await this.#readState();
    const candidates = (state.catalog?.index.packages ?? []).filter(
      (pkg) =>
        pkg.kind === input.kind &&
        pkg.id === input.id &&
        (input.version === undefined || pkg.version === input.version),
    );
    const candidate = candidates.at(-1);
    if (!candidate) throw new Error("registry package version was not found");
    const granted = new Set(input.grantedPermissions ?? []);
    const missingPermissions = (candidate.permissions ?? []).filter(
      (permission) => !granted.has(permission),
    );
    if (missingPermissions.length > 0) {
      return {
        installed: false,
        reason: "permissions_required",
        missingPermissions,
      };
    }

    const response = await this.#fetch(candidate.source);
    if (!response.ok)
      throw new Error(`artifact download failed with ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256.toLowerCase() !== candidate.sha256.toLowerCase()) {
      throw new Error("artifact integrity check failed");
    }

    const key = packageKey(candidate);
    const previous = state.installed[key] ?? null;
    const artifactPath = join(
      this.#artifactRoot,
      candidate.kind,
      candidate.id,
      `${candidate.version}.artifact`,
    );
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, bytes);
    state.rollback[key] = previous;
    state.installed[key] = candidate;
    await this.#writeState(state);
    return {
      installed: true,
      action: previous ? "update" : "install",
      package: candidate,
    };
  }

  async rollback(kind: RegistryPackageVersion["kind"], id: string) {
    const state = await this.#readState();
    const key = `${kind}:${id}`;
    if (!(key in state.rollback))
      throw new Error("rollback record was not found");
    const previous = state.rollback[key];
    const current = state.installed[key] ?? null;
    if (previous) state.installed[key] = previous;
    else delete state.installed[key];
    delete state.rollback[key];
    await this.#writeState(state);
    return {
      schema: ROLLBACK_SCHEMA,
      packageKey: key,
      fromVersion: current?.version ?? null,
      toVersion: previous?.version ?? null,
      installed: previous,
    };
  }
}

export class RemoteNodeManager {
  readonly #nodes = new Map<string, RemoteNodeRecord>();
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  async #json(url: URL, init?: RequestInit): Promise<unknown> {
    const response = await this.#fetch(url, init);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        `${(body as { error?: string }).error ?? "remote_node_request_failed"} (${response.status})`,
      );
    }
    return body;
  }

  async register(id: string, rawUrl: string) {
    const url = new URL(rawUrl);
    const descriptor = (await this.#json(
      new URL("/descriptor", url),
    )) as RemoteNodeDescriptor;
    if (descriptor.schema !== "totem.node/v0") {
      throw new Error("remote node uses an unsupported descriptor schema");
    }
    if (descriptor.id !== id)
      throw new Error("remote node id does not match descriptor");
    if (!Array.isArray(descriptor.capabilities)) {
      throw new Error("remote node capabilities are invalid");
    }
    const record = {
      id,
      url: url.toString(),
      descriptor,
      registeredAt: new Date().toISOString(),
    };
    this.#nodes.set(id, record);
    return record;
  }

  async list() {
    return Promise.all(
      [...this.#nodes.values()].map(async (record) => {
        try {
          const health = await this.#json(new URL("/health", record.url));
          return { ...record, status: "online", health };
        } catch (error) {
          return {
            ...record,
            status: "offline",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  }

  remove(id: string): boolean {
    return this.#nodes.delete(id);
  }

  async invoke(id: string, capability: string, input: unknown) {
    const node = this.#nodes.get(id);
    if (!node) throw new Error("remote node is not registered");
    if (!node.descriptor.capabilities.includes(capability)) {
      throw new Error("capability is not advertised by the remote node");
    }
    return this.#json(new URL("/invoke", node.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability, input }),
    });
  }
}

export function parseRegistryTrustedKeys(
  raw: string | undefined,
): Readonly<Record<string, string>> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TOTEM_REGISTRY_TRUSTED_KEYS must be a JSON object");
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== "string" || !value.trim()) {
      throw new Error(
        "TOTEM_REGISTRY_TRUSTED_KEYS values must be non-empty PEM strings",
      );
    }
  }
  return parsed as Record<string, string>;
}

export function registerEcosystemRoutes(
  app: FastifyInstance,
  registry: RegistryManager,
  nodes: RemoteNodeManager,
): void {
  app.get<{ Querystring: { q?: string; kind?: string } }>(
    "/api/registry",
    async (request) => registry.snapshot(request.query),
  );
  app.put<{ Body: SignedRegistryIndex }>(
    "/api/registry/catalog",
    async (request, reply) => {
      try {
        await registry.setCatalog(request.body);
        return registry.snapshot();
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "registry_invalid", message: String(error) });
      }
    },
  );
  app.post<{
    Body: {
      kind: RegistryPackageVersion["kind"];
      id: string;
      version?: string;
      grantedPermissions?: string[];
    };
  }>("/api/registry/install", async (request, reply) => {
    try {
      return await registry.install(request.body);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: "registry_install_failed", message: String(error) });
    }
  });
  app.post<{ Body: { kind: RegistryPackageVersion["kind"]; id: string } }>(
    "/api/registry/rollback",
    async (request, reply) => {
      try {
        return await registry.rollback(request.body.kind, request.body.id);
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "registry_rollback_failed", message: String(error) });
      }
    },
  );

  app.get("/api/nodes", async () => ({ nodes: await nodes.list() }));
  app.put<{ Params: { nodeId: string }; Body: { url?: string } }>(
    "/api/nodes/:nodeId",
    async (request, reply) => {
      if (
        typeof request.body?.url !== "string" ||
        request.body.url.trim() === ""
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "'url' is required" });
      }
      try {
        return {
          node: await nodes.register(request.params.nodeId, request.body.url),
        };
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "node_registration_failed", message: String(error) });
      }
    },
  );
  app.delete<{ Params: { nodeId: string } }>(
    "/api/nodes/:nodeId",
    async (request, reply) => {
      if (!nodes.remove(request.params.nodeId)) {
        return reply.code(404).send({ error: "node_not_found" });
      }
      return { removed: true, nodeId: request.params.nodeId };
    },
  );
  app.post<{
    Params: { nodeId: string };
    Body: { capability?: string; input?: unknown };
  }>("/api/nodes/:nodeId/invoke", async (request, reply) => {
    if (
      typeof request.body?.capability !== "string" ||
      request.body.capability.trim() === ""
    ) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "'capability' is required",
      });
    }
    try {
      return await nodes.invoke(
        request.params.nodeId,
        request.body.capability,
        request.body.input ?? {},
      );
    } catch (error) {
      return reply
        .code(400)
        .send({ error: "node_invoke_failed", message: String(error) });
    }
  });
}
