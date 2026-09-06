import { migrateToLatest, openTotemDatabase, TaskStore } from "@totem/storage";
import type { TotemEvent } from "@totem/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeEventHub } from "./events.js";
import { TaskOrchestrator } from "./orchestrator.js";

let database: ReturnType<typeof openTotemDatabase>;
let taskStore: TaskStore;
let hub: RuntimeEventHub;
let captured: TotemEvent[];
let orchestrator: TaskOrchestrator;

async function waitForStatus(taskId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await taskStore.getTask(taskId);
    if (task?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`task ${taskId} never reached status ${status}`);
}

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${String(next).padStart(4, "0")}`;
  };
}

beforeEach(async () => {
  database = openTotemDatabase({ filename: ":memory:" });
  await migrateToLatest(database);
  taskStore = new TaskStore(database);
  hub = new RuntimeEventHub();
  captured = [];
  hub.subscribe((event) => captured.push(event));

  let tick = Date.parse("2026-09-06T00:00:00.000Z");
  const now = () => {
    tick += 1000;
    return new Date(tick);
  };
  orchestrator = new TaskOrchestrator({
    taskStore,
    hub,
    now,
    newId: deterministicIds(),
  });
});

afterEach(async () => {
  await database.destroy();
});

describe("TaskOrchestrator", () => {
  it("runs a mocked task end to end and persists the normalized event log", async () => {
    const { taskId } = await orchestrator.startMockTask({
      prompt: "say hello",
    });
    await orchestrator.waitForTask(taskId);

    const task = await taskStore.getTask(taskId);
    expect(task).toMatchObject({
      status: "succeeded",
      kind: "mock-agent",
      providerId: "mock",
      result: { text: "Mock response: say hello" },
    });

    const events = await taskStore.listTaskEvents(taskId);
    expect(events.map((entry) => entry.event.type)).toEqual([
      "task.created",
      "agent.message",
      "task.started",
      "agent.progress",
      "task.progress",
      "agent.message",
      "task.succeeded",
    ]);
    expect(events.map((entry) => entry.taskSequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);

    // The runtime hub also carries derived display state for the simulator.
    const hubTypes = captured.map((event) => event.type);
    expect(hubTypes).toContain("agent.session_created");
    expect(hubTypes).toContain("task.succeeded");
    expect(hubTypes).toContain("display.scene_changed");
    expect(hubTypes).toContain("display.led_changed");
    expect(
      captured.find((event) => event.type === "display.led_changed"),
    ).toMatchObject({ payload: { semantic: "attention" } });
  });

  it("persists a deterministic failure with a normalized failure payload", async () => {
    const { taskId } = await orchestrator.startMockTask({
      prompt: "please fail",
      scenario: "failure",
    });
    await orchestrator.waitForTask(taskId);

    const task = await taskStore.getTask(taskId);
    expect(task).toMatchObject({
      status: "failed",
      failure: { code: "mock_failure", retryable: false },
    });
    const events = await taskStore.listTaskEvents(taskId);
    expect(events.at(-1)?.event.type).toBe("task.failed");
    expect(events.map((entry) => entry.event.type)).toContain("agent.error");
  });

  it("cancels a waiting task through the interrupt path", async () => {
    const { taskId } = await orchestrator.startMockTask({
      prompt: "hang on",
      scenario: "wait",
    });
    // The wait scenario leaves the task running until interrupted.
    await waitForStatus(taskId, "running");

    await orchestrator.interruptTask(taskId);
    await orchestrator.waitForTask(taskId);

    expect((await taskStore.getTask(taskId))?.status).toBe("cancelled");
    const events = await taskStore.listTaskEvents(taskId);
    expect(events.map((entry) => entry.event.type)).toEqual([
      "task.created",
      "agent.message",
      "task.started",
      "agent.progress",
      "task.progress",
      "agent.interrupted",
      "task.cancelling",
      "task.cancelled",
    ]);
  });

  it("keeps durable task history readable after a simulated core reconnect", async () => {
    const { taskId } = await orchestrator.startMockTask({
      prompt: "persist me",
    });
    await orchestrator.waitForTask(taskId);

    // A fresh store over the same database stands in for a restarted core.
    const reconnected = new TaskStore(database);
    const task = await reconnected.getTask(taskId);
    expect(task?.status).toBe("succeeded");
    const events = await reconnected.listTaskEvents(taskId);
    expect(events).toHaveLength(7);
    expect(events.at(-1)?.event.payload).toEqual({
      result: { text: "Mock response: persist me" },
    });

    const session = await reconnected.getSession(task?.sessionId ?? "");
    expect(session?.status).toBe("closed");
  });

  it("rejects an empty prompt", async () => {
    await expect(
      orchestrator.startMockTask({ prompt: "   " }),
    ).rejects.toMatchObject({ code: "prompt_required" });
  });
});
