#!/usr/bin/env node

import process from "node:process";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export function parseArgs(argv) {
  const options = {
    baseUrl: process.env.TOTEM_BASE_URL ?? "http://127.0.0.1:3000",
    providers: [],
    workspace: process.env.TOTEM_LIVE_WORKSPACE,
    timeoutMs: 120_000,
    pollMs: 1_000,
    services: [],
    exerciseInterrupt: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--provider") options.providers.push(argv[++index]);
    else if (arg === "--workspace") options.workspace = argv[++index];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--poll-ms") options.pollMs = Number(argv[++index]);
    else if (arg === "--service") options.services.push(argv[++index]);
    else if (arg === "--exercise-interrupt") options.exerciseInterrupt = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) {
    throw new Error("--poll-ms must be a positive number");
  }
  return options;
}

export function parseServiceSpec(spec, env = process.env) {
  const [id, url, tokenEnv] = String(spec).split("|");
  if (!id || !url) {
    throw new Error(
      "--service must use id|url or id|url|TOKEN_ENV; secrets are read from TOKEN_ENV only",
    );
  }
  const token = tokenEnv ? env[tokenEnv] : undefined;
  return {
    id,
    url,
    ...(tokenEnv ? { tokenEnv } : {}),
    ...(token ? { token } : {}),
  };
}

export function summarize(results) {
  const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
  for (const result of results) counts[result.status] += 1;
  return {
    schema: "totem.live-validation/v1",
    generatedAt: new Date().toISOString(),
    counts,
    ok: counts.FAIL === 0,
    results,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!response.ok) {
    const message =
      body?.message ??
      body?.error ??
      `${response.status} ${response.statusText}`;
    throw new Error(String(message));
  }
  return body;
}

async function pollTask(baseUrl, taskId, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await requestJson(
      `${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`,
    );
    const task = snapshot.task ?? snapshot;
    if (TERMINAL.has(task.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `task ${taskId} did not reach a terminal state within ${timeoutMs}ms`,
  );
}

function result(capability, status, detail, extra = {}) {
  return { capability, status, detail, ...extra };
}

async function providerLifecycle(baseUrl, provider, options) {
  const results = [];
  const providerId = provider.id;
  if (!provider.status?.available) {
    results.push(
      result(
        `provider:${providerId}:availability`,
        "SKIP",
        provider.status?.detail ?? "provider unavailable",
      ),
    );
    return results;
  }

  results.push(
    result(
      `provider:${providerId}:availability`,
      "PASS",
      provider.status?.detail ?? "provider available",
    ),
  );

  const startBody = {
    providerId,
    prompt: "Reply with exactly TOTEM_LIVE_SMOKE_OK and no other text.",
    kind: "live-validation",
    title: `Live validation: ${providerId}`,
    ...(options.workspace
      ? { workspace: { path: options.workspace, access: "read-only" } }
      : {}),
  };

  let started;
  let firstSucceeded = false;
  try {
    started = await requestJson(`${baseUrl}/api/provider-tasks`, {
      method: "POST",
      body: JSON.stringify(startBody),
    });
    const terminal = await pollTask(
      baseUrl,
      started.taskId,
      options.timeoutMs,
      options.pollMs,
    );
    const task = terminal.task ?? terminal;
    firstSucceeded = task.status === "succeeded";
    results.push(
      result(
        `provider:${providerId}:task`,
        firstSucceeded ? "PASS" : "FAIL",
        `durable task ${started.taskId} finished as ${task.status}`,
        { taskId: started.taskId, sessionId: started.sessionId },
      ),
    );
  } catch (error) {
    results.push(
      result(
        `provider:${providerId}:task`,
        "FAIL",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  if (!provider.capabilities?.resume) {
    results.push(
      result(`provider:${providerId}:resume`, "SKIP", "resume not advertised"),
    );
  } else if (!started || !firstSucceeded) {
    results.push(
      result(
        `provider:${providerId}:resume`,
        "SKIP",
        "initial live task did not succeed, so resume was not attempted",
      ),
    );
  } else {
    try {
      const resumed = await requestJson(
        `${baseUrl}/api/provider-tasks/${encodeURIComponent(started.taskId)}/resume`,
        {
          method: "POST",
          body: JSON.stringify({
            prompt:
              "Reply with exactly TOTEM_LIVE_RESUME_OK and no other text.",
            kind: "live-validation",
            title: `Live resume validation: ${providerId}`,
          }),
        },
      );
      const terminal = await pollTask(
        baseUrl,
        resumed.taskId,
        options.timeoutMs,
        options.pollMs,
      );
      const task = terminal.task ?? terminal;
      const sameSession = resumed.sessionId === started.sessionId;
      results.push(
        result(
          `provider:${providerId}:resume`,
          task.status === "succeeded" && sameSession ? "PASS" : "FAIL",
          `resumed task ${resumed.taskId} finished as ${task.status}; same durable session=${sameSession}`,
          {
            taskId: resumed.taskId,
            sessionId: resumed.sessionId,
            resumedFromTaskId: started.taskId,
          },
        ),
      );
    } catch (error) {
      results.push(
        result(
          `provider:${providerId}:resume`,
          "FAIL",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  if (!options.exerciseInterrupt) {
    results.push(
      result(
        `provider:${providerId}:interrupt`,
        "SKIP",
        "pass --exercise-interrupt to run a destructive live interruption smoke",
      ),
    );
    return results;
  }

  if (!provider.capabilities?.interrupt) {
    results.push(
      result(
        `provider:${providerId}:interrupt`,
        "SKIP",
        "interrupt not advertised",
      ),
    );
    return results;
  }

  try {
    const interruptStarted = await requestJson(
      `${baseUrl}/api/provider-tasks`,
      {
        method: "POST",
        body: JSON.stringify({
          ...startBody,
          prompt:
            "Perform a deliberate multi-step reasoning task. Do not finish immediately; emit progress before the final answer.",
          title: `Live interrupt validation: ${providerId}`,
        }),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await requestJson(
      `${baseUrl}/api/provider-tasks/${encodeURIComponent(interruptStarted.taskId)}/interrupt`,
      { method: "POST" },
    );
    const terminal = await pollTask(
      baseUrl,
      interruptStarted.taskId,
      options.timeoutMs,
      options.pollMs,
    );
    const task = terminal.task ?? terminal;
    results.push(
      result(
        `provider:${providerId}:interrupt`,
        task.status === "cancelled" ? "PASS" : "FAIL",
        `interrupted task ${interruptStarted.taskId} finished as ${task.status}`,
        { taskId: interruptStarted.taskId },
      ),
    );
  } catch (error) {
    results.push(
      result(
        `provider:${providerId}:interrupt`,
        "FAIL",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  return results;
}

async function serviceSmoke(service) {
  if (service.tokenEnv && !service.token) {
    return result(
      `service:${service.id}`,
      "SKIP",
      `credential env ${service.tokenEnv} is not set`,
    );
  }
  try {
    const response = await fetch(service.url, {
      headers: {
        accept: "application/json, text/plain, */*",
        ...(service.token ? { authorization: `Bearer ${service.token}` } : {}),
      },
    });
    return result(
      `service:${service.id}`,
      response.ok ? "PASS" : "FAIL",
      `HTTP ${response.status}`,
    );
  } catch (error) {
    return result(
      `service:${service.id}`,
      "FAIL",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runLiveValidation(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const results = [];
  let providersPayload;
  try {
    providersPayload = await requestJson(`${baseUrl}/api/providers`);
    results.push(
      result(
        "core:providers-api",
        "PASS",
        `${baseUrl}/api/providers reachable`,
      ),
    );
  } catch (error) {
    results.push(
      result(
        "core:providers-api",
        "FAIL",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return summarize(results);
  }

  const selected = (providersPayload.providers ?? []).filter(
    (provider) =>
      provider.id !== "mock" &&
      (options.providers.length === 0 ||
        options.providers.includes(provider.id)),
  );
  if (selected.length === 0) {
    results.push(
      result(
        "providers:selected",
        "SKIP",
        "no matching real providers registered",
      ),
    );
  }
  for (const provider of selected) {
    results.push(...(await providerLifecycle(baseUrl, provider, options)));
  }

  for (const spec of options.services) {
    results.push(await serviceSmoke(parseServiceSpec(spec)));
  }
  return summarize(results);
}

function help() {
  return `Totem live validation harness\n\nUsage:\n  pnpm validate:live -- [options]\n\nOptions:\n  --base-url URL             Core URL (default TOTEM_BASE_URL or http://127.0.0.1:3000)\n  --provider ID              Limit to one provider; may be repeated\n  --workspace PATH           Read-only workspace for provider smoke tasks\n  --service ID|URL|TOKEN_ENV Opt-in service probe; TOKEN_ENV is read at runtime and never printed\n  --exercise-interrupt       Run an actual interruption smoke task\n  --timeout-ms N             Per-task timeout (default 120000)\n  --poll-ms N                Poll interval (default 1000)\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(help());
    } else {
      const summary = await runLiveValidation(options);
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = summary.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        schema: "totem.live-validation/v1",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}
