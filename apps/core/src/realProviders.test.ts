import {
  CodexCliProvider,
  type RunningProcess,
  type SpawnSpec,
} from "@totem/agents";
import { migrateToLatest, openTotemDatabase, TaskStore } from "@totem/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeEventHub } from "./events.js";
import { RealProviderCoordinator } from "./realProviders.js";

let database: ReturnType<typeof openTotemDatabase>;
let taskStore: TaskStore;
let hub: RuntimeEventHub;

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${String(next).padStart(4, "0")}`;
  };
}

function processFor(spec: SpawnSpec): RunningProcess {
  if (spec.args.includes("--version")) {
    return {
      stdout: (async function* () {})(),
      stderr: (async function* () {})(),
      exit: Promise.resolve(0),
      interrupt() {},
      terminate() {},
    };
  }

  const resumed = spec.args.includes("resume");
  return {
    stdout: (async function* () {
      yield JSON.stringify({
        type: "message",
        thread_id: "codex-native-42",
        message: resumed ? "Provider resumed response" : "Provider response",
      });
    })(),
    stderr: (async function* () {})(),
    exit: Promise.resolve(0),
    interrupt() {},
    terminate() {},
  };
}

beforeEach(async () => {
  database = openTotemDatabase({ filename: ":memory:" });
  await migrateToLatest(database);
  taskStore = new TaskStore(database);
  hub = new RuntimeEventHub();
});

afterEach(async () => {
  await database.destroy();
});

describe("RealProviderCoordinator", () => {
  it("runs and resumes provider-selected durable tasks on one native session", async () => {
    let tick = Date.parse("2026-09-06T11:00:00.000Z");
    const now = () => {
      tick += 1000;
      return new Date(tick);
    };
    const coordinator = new RealProviderCoordinator({
      taskStore,
      hub,
      providers: [new CodexCliProvider(processFor)],
      newId: deterministicIds(),
      now,
    });

    const started = await coordinator.startTask({
      prompt: "Explain the current task",
      providerId: "codex",
      workspace: { path: "/workspace", access: "read-only" },
    });
    await coordinator.waitForTask(started.taskId);

    expect(started.providerId).toBe("codex");
    expect((await taskStore.getTask(started.taskId))?.status).toBe("succeeded");
    expect((await taskStore.getTask(started.taskId))?.result).toEqual({
      text: "Provider response",
    });

    const session = await taskStore.getSession(started.sessionId);
    expect(session).toMatchObject({
      providerId: "codex",
      providerSessionRef: "codex-native-42",
      status: "active",
    });

    const resumed = await coordinator.resumeTask(started.taskId, {
      prompt: "Continue the same task",
    });
    expect(resumed.sessionId).toBe(started.sessionId);
    expect(resumed.taskId).not.toBe(started.taskId);
    await coordinator.waitForTask(resumed.taskId);
    expect((await taskStore.getTask(resumed.taskId))?.status).toBe("succeeded");
    expect((await taskStore.getTask(resumed.taskId))?.result).toEqual({
      text: "Provider resumed response",
    });
    expect(await taskStore.getSession(started.sessionId)).toMatchObject({
      providerSessionRef: "codex-native-42",
      status: "active",
    });

    const events = await taskStore.listTaskEvents(started.taskId);
    expect(events.map((entry) => entry.event.type)).toEqual([
      "task.created",
      "task.started",
      "agent.started",
      "agent.message",
      "agent.completed",
      "task.succeeded",
    ]);
  });

  it("rejects resume when a prior task is not a successful retained session", async () => {
    const coordinator = new RealProviderCoordinator({
      taskStore,
      hub,
      providers: [new CodexCliProvider(processFor)],
      newId: deterministicIds(),
    });

    await expect(
      coordinator.resumeTask("missing", { prompt: "continue" }),
    ).rejects.toMatchObject({ code: "task_not_found" });
  });

  it("reports deterministic capability and availability snapshots", async () => {
    const coordinator = new RealProviderCoordinator({
      taskStore,
      hub,
      providers: [new CodexCliProvider(processFor)],
    });

    await expect(coordinator.providerSnapshots()).resolves.toEqual([
      {
        id: "codex",
        status: { id: "codex", available: true, detail: "CLI available" },
        capabilities: {
          streaming: true,
          resume: true,
          interrupt: true,
          workspaces: true,
          mcp: true,
        },
      },
    ]);
  });
});
