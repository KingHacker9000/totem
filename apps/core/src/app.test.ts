import { migrateToLatest, openTotemDatabase, TaskStore } from "@totem/storage";
import { describe, expect, it } from "vitest";
import { createApp, type TaskDataSource } from "./app.js";
import type { TotemConfig } from "./config.js";
import { RuntimeEventHub } from "./events.js";
import { TaskOrchestrator } from "./orchestrator.js";

const testConfig: TotemConfig = {
  host: "127.0.0.1",
  port: 3000,
  logLevel: "silent",
  environment: "test",
  paths: {
    root: "/tmp/totem-test",
    state: "/tmp/totem-test/state",
    extensions: "/tmp/totem-test/extensions",
    themes: "/tmp/totem-test/themes",
    logs: "/tmp/totem-test/logs",
  },
  discovery: {
    extensionRoots: ["/tmp/totem-test/extensions"],
    themeRoots: ["/tmp/totem-test/themes"],
  },
  speech: {
    stt: { provider: "none" },
    tts: { provider: "none" },
    agentProviderId: "mock",
    vadThreshold: 0.015,
  },
};

const durableTask = {
  id: "task-1",
  kind: "mock",
  status: "running",
  title: "Mock durable task",
  createdAt: "2026-09-06T04:00:00.000Z",
  updatedAt: "2026-09-06T04:01:00.000Z",
};

const taskStore: TaskDataSource = {
  async listTasks() {
    return [durableTask];
  },
  async getTask(taskId) {
    return taskId === durableTask.id ? durableTask : undefined;
  },
  async listTaskEvents(taskId) {
    return taskId === durableTask.id
      ? [
          {
            taskSequence: 1,
            event: {
              schema: "totem.event/v0",
              id: "event-1",
              type: "task.created",
              source: "core",
              occurredAt: durableTask.createdAt,
              taskId: durableTask.id,
              data: {},
            },
          },
        ]
      : [];
  },
};

describe("core HTTP surface", () => {
  it("serves identity, health, runtime status, discovery, and durable tasks", async () => {
    const startedAt = "2026-09-05T22:00:00.000Z";
    const app = createApp({
      config: testConfig,
      startedAt,
      logger: false,
      taskStore,
    });

    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(root.json()).toEqual({
        name: "Totem",
        stage: "phase-1",
        status: "ok",
      });

      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok" });

      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        status: "ok",
        name: "Totem",
        stage: "phase-1",
        environment: "test",
        startedAt,
        dataDir: testConfig.paths.root,
      });
      expect(status.json().uptimeSeconds).toBeGreaterThanOrEqual(0);

      const tasks = await app.inject({ method: "GET", url: "/api/tasks" });
      expect(tasks.statusCode).toBe(200);
      expect(tasks.json()).toEqual({ tasks: [durableTask] });

      const task = await app.inject({
        method: "GET",
        url: `/api/tasks/${durableTask.id}`,
      });
      expect(task.statusCode).toBe(200);
      expect(task.json()).toMatchObject({
        task: durableTask,
        events: [{ taskSequence: 1 }],
      });

      const missingTask = await app.inject({
        method: "GET",
        url: "/api/tasks/missing",
      });
      expect(missingTask.statusCode).toBe(404);
      expect(missingTask.json()).toMatchObject({ error: "task_not_found" });

      const extensions = await app.inject({
        method: "GET",
        url: "/api/extensions",
      });
      expect(extensions.statusCode).toBe(200);
      expect(extensions.json()).toEqual({ packages: [], rootDiagnostics: [] });

      const themes = await app.inject({ method: "GET", url: "/api/themes" });
      expect(themes.statusCode).toBe(200);
      expect(themes.json()).toEqual({
        packages: [],
        rootDiagnostics: [],
        activeTheme: { source: "fallback", id: null, packagePath: null },
      });

      expect(
        (await app.inject({ method: "GET", url: "/missing" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("starts a mocked task from the HTTP input surface and persists it", async () => {
    const database = openTotemDatabase({ filename: ":memory:" });
    await migrateToLatest(database);
    const store = new TaskStore(database);
    const hub = new RuntimeEventHub();
    const orchestrator = new TaskOrchestrator({ taskStore: store, hub });
    const app = createApp({
      config: testConfig,
      logger: false,
      taskStore: store,
      eventHub: hub,
      orchestrator,
    });

    try {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { prompt: "   " },
      });
      expect(rejected.statusCode).toBe(400);

      const started = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { prompt: "run the mock", scenario: "success" },
      });
      expect(started.statusCode).toBe(202);
      const { taskId } = started.json() as { taskId: string };
      expect(taskId).toBeTruthy();

      await orchestrator.waitForTask(taskId);

      const detail = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        task: { id: taskId, status: "succeeded" },
      });
    } finally {
      await app.close();
      await database.destroy();
    }
  }, 15_000);

  it("reports the orchestrator as unavailable when none is attached", async () => {
    const app = createApp({ config: testConfig, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { prompt: "hello" },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: "orchestrator_unavailable",
      });
    } finally {
      await app.close();
    }
  });

  it("reports task storage as unavailable when no durable store is attached", async () => {
    const app = createApp({ config: testConfig, logger: false });

    try {
      const response = await app.inject({ method: "GET", url: "/api/tasks" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: "task_store_unavailable",
      });
    } finally {
      await app.close();
    }
  });
});
