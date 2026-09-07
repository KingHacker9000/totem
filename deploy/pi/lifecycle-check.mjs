#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readinessOptions, waitForCoreReady } from "./readiness.mjs";

const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const readyOnly = args.has("--ready-only");
const restart = args.has("--restart");
const deployedEnv = readSimpleEnv(
  process.env.TOTEM_ENV_FILE ?? "/etc/totem/totem.env",
);
const port = Number(process.env.TOTEM_PORT ?? deployedEnv.TOTEM_PORT ?? "3000");
const baseUrl =
  process.env.TOTEM_BASE_URL ??
  deployedEnv.TOTEM_BASE_URL ??
  `http://127.0.0.1:${port}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];

function readSimpleEnv(file) {
  try {
    const values = {};
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function record(step, ok, details = {}) {
  results.push({ step, ok, details });
  if (!jsonOnly) {
    console.log(`${ok ? "PASS" : "FAIL"} ${step}`);
  }
}

async function ready(step) {
  const result = await waitForCoreReady({ baseUrl, ...readinessOptions() });
  record(step, result.ok, result);
  return result.ok;
}

async function probe(route) {
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(2500),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!(await ready("core-ready"))) {
  process.exitCode = 1;
} else if (!readyOnly) {
  const tasks = await probe("/api/tasks");
  record("task-store-read", tasks.ok, tasks);

  const capabilities = await probe("/api/operator/capabilities");
  record("operator-capabilities", capabilities.ok, capabilities);

  const selfTest = spawnSync(process.execPath, [path.join(here, "self-test.mjs")], {
    encoding: "utf8",
    env: { ...process.env, TOTEM_BASE_URL: baseUrl },
  });
  record("self-test", selfTest.status === 0, {
    exitCode: selfTest.status,
    stdout: selfTest.stdout?.trim() || null,
    stderr: selfTest.stderr?.trim() || null,
  });

  if (restart) {
    if (process.platform !== "linux") {
      record("service-restart", false, { error: "--restart requires Linux/systemd" });
    } else {
      const command = spawnSync("systemctl", ["restart", "totem.service"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      record("service-restart", command.status === 0, {
        exitCode: command.status,
        output: `${command.stdout ?? ""}${command.stderr ?? ""}`.trim() || null,
      });
      if (command.status === 0) {
        await ready("core-ready-after-restart");
        const after = await probe("/api/tasks");
        record("task-store-read-after-restart", after.ok, after);
      }
    }
  }
}

const ok = results.every((item) => item.ok);
const report = {
  schema: "totem.pi-lifecycle-check/v1",
  generatedAt: new Date().toISOString(),
  baseUrl,
  ok,
  results,
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
}
if (!ok) process.exitCode = 1;
