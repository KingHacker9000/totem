import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AgentProviderRegistry } from "@totem/agents";

interface ProviderConstructor {
  new (runner?: ProcessRunner): HostProvider;
}

interface ProviderModule {
  CodexCliProvider: ProviderConstructor;
  ClaudeCodeCliProvider: ProviderConstructor;
}

interface HostProvider {
  readonly id: string;
  probeCapabilities(): Promise<{
    streaming: boolean;
    resume: boolean;
    interrupt: boolean;
    workspaces: boolean;
    mcp: boolean;
  }>;
  getStatus(): Promise<{ id: string; available: boolean }>;
  startSession(options?: {
    workspace?: { path: string; access: "read-only" | "read-write" };
    mcpServers?: Array<{ id: string; command: string; args?: string[] }>;
  }): Promise<{
    id: string;
    providerId: string;
    status: "active" | "interrupted" | "terminated";
  }>;
  resumeSession(sessionId: string): Promise<unknown>;
  sendMessage(
    sessionId: string,
    request: { content: string; taskId: string; correlationId?: string },
  ): Promise<void>;
  streamEvents(sessionId: string): AsyncIterable<unknown>;
  interrupt(sessionId: string): Promise<void>;
  terminate(sessionId: string): Promise<void>;
  attachWorkspace(
    sessionId: string,
    workspace: { path: string; access: "read-only" | "read-write" },
  ): Promise<void>;
  registerMcpServers(
    sessionId: string,
    servers: Array<{ id: string; command: string; args?: string[] }>,
  ): Promise<void>;
}

interface RunningProcess {
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  exit: Promise<number | null>;
  interrupt(): void;
  terminate(): void;
}

type ProcessRunner = (spec: {
  command: string;
  args: string[];
  cwd?: string;
}) => RunningProcess;

function fail(message: string): never {
  throw new Error(`agent-provider-integration: ${message}`);
}

function assertProviderModule(value: unknown): asserts value is ProviderModule {
  if (!value || typeof value !== "object")
    fail("provider module is not an object");
  const candidate = value as Record<string, unknown>;
  for (const exportName of ["CodexCliProvider", "ClaudeCodeCliProvider"]) {
    if (typeof candidate[exportName] !== "function") {
      fail(`missing required provider export ${exportName}`);
    }
  }
}

async function* emptyLines(): AsyncIterable<string> {}

const providerRoot = path.resolve(process.argv[2] ?? "");
const expectedRevision = process.argv[3];
if (
  !process.argv[2] ||
  !expectedRevision ||
  !/^[0-9a-f]{40}$/.test(expectedRevision)
) {
  fail(
    "usage: agent-provider-integration.ts <provider-root> <40-char-revision>",
  );
}

const actualRevision = execFileSync(
  "git",
  ["-C", providerRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (actualRevision !== expectedRevision) {
  fail(
    `provider revision mismatch: expected ${expectedRevision}, got ${actualRevision}`,
  );
}

const packageJson = JSON.parse(
  await readFile(path.join(providerRoot, "package.json"), "utf8"),
) as Record<string, unknown>;
if (packageJson.name !== "@totem/agent-providers")
  fail("unexpected package identity");
if (packageJson.exports !== "./dist/index.js")
  fail("unexpected package runtime export");
if (packageJson.types !== "./dist/index.d.ts")
  fail("unexpected package type export");

const moduleUrl = pathToFileURL(
  path.join(providerRoot, "dist", "index.js"),
).href;
const loaded: unknown = await import(moduleUrl);
assertProviderModule(loaded);

let malformedRejected = false;
try {
  assertProviderModule({ CodexCliProvider: loaded.CodexCliProvider });
} catch {
  malformedRejected = true;
}
if (!malformedRejected) fail("incompatible provider module was accepted");

const invocations: Array<{ command: string; args: string[]; cwd?: string }> =
  [];
const runner: ProcessRunner = (spec) => {
  invocations.push(structuredClone(spec));
  return {
    stdout: emptyLines(),
    stderr: emptyLines(),
    exit: Promise.resolve(0),
    interrupt() {},
    terminate() {},
  };
};

const registry = new AgentProviderRegistry<unknown>();
const codex = new loaded.CodexCliProvider(runner);
const claude = new loaded.ClaudeCodeCliProvider(runner);
registry.register(codex);
registry.register(claude);

const ids = registry
  .list()
  .map((provider) => provider.id)
  .sort();
if (JSON.stringify(ids) !== JSON.stringify(["claude-code", "codex"])) {
  fail(`unexpected registered provider IDs: ${ids.join(", ")}`);
}

for (const provider of [codex, claude]) {
  if (registry.get(provider.id) !== provider)
    fail(`registry lookup failed for ${provider.id}`);
  const capabilities = await provider.probeCapabilities();
  for (const capability of [
    "streaming",
    "resume",
    "interrupt",
    "workspaces",
    "mcp",
  ] as const) {
    if (capabilities[capability] !== true) {
      fail(`${provider.id} capability ${capability} is not enabled`);
    }
  }
  const status = await provider.getStatus();
  if (status.id !== provider.id || status.available !== true) {
    fail(`${provider.id} credential-free status probe contract failed`);
  }
  const session = await provider.startSession({
    workspace: { path: providerRoot, access: "read-only" },
    mcpServers: [
      { id: "fixture", command: "fixture-mcp", args: ["--offline"] },
    ],
  });
  if (session.providerId !== provider.id || session.status !== "active") {
    fail(`${provider.id} session contract mismatch`);
  }
  await provider.terminate(session.id);
}

if (invocations.length !== 2)
  fail(`expected two status probes, got ${invocations.length}`);
if (
  invocations[0]?.command !== "codex" ||
  invocations[1]?.command !== "claude"
) {
  fail(
    `unexpected probe commands: ${invocations.map((entry) => entry.command).join(", ")}`,
  );
}

console.log(
  JSON.stringify({
    schema: "totem.agent-provider-host-integration/v1",
    provider_revision: expectedRevision,
    package: "@totem/agent-providers",
    provider_ids: ids,
    credential_free: true,
    malformed_module_rejected: true,
  }),
);
