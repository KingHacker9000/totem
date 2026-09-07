#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadContract, validateEnvironment } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate a local test port")));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function credentialFreeEnvironment(port, dataDir) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("TOTEM_")) continue;
    if (/(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: "production",
    TOTEM_ENV: "production",
    TOTEM_HOST: "127.0.0.1",
    TOTEM_PORT: String(port),
    TOTEM_DATA_DIR: dataDir,
  };
}

async function waitForHealth(baseUrl, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`core exited before readiness with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      last = { status: response.status, body: await response.text() };
      if (response.ok) return last;
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`credential-free core did not become healthy: ${JSON.stringify(last)}`);
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "totem-credential-free-"));
const port = await freePort();
const env = credentialFreeEnvironment(port, dataDir);
const contract = await loadContract();
const issues = validateEnvironment(contract, env);
if (issues.length) throw new Error(`smoke environment violates release contract:\n- ${issues.join("\n- ")}`);

const child = spawn(process.execPath, [path.join(root, "apps/core/dist/main.js")], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const health = await waitForHealth(`http://127.0.0.1:${port}`, child);
  console.log(JSON.stringify({
    schema: "totem.credential-free-startup/v1",
    ok: true,
    credential_env_keys: [],
    configured_totem_keys: ["TOTEM_ENV", "TOTEM_HOST", "TOTEM_PORT", "TOTEM_DATA_DIR"],
    health,
  }, null, 2));
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await rm(dataDir, { recursive: true, force: true });
}
