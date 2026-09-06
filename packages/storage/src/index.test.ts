import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EVENT_SCHEMA, validateTotemEvent } from "@totem/protocol";
import {
  migrateToLatest,
  openTotemDatabase,
  TaskStore,
  type TotemDatabase,
} from "./index.js";
import type { Kysely } from "kysely";

const directories: string[] = [];
const databases: Kysely<TotemDatabase>[] = [];
let sequence = 0;

function event(
  type: string,
  taskId: string,
  occurredAt: string,
  payload: unknown = {},
) {
  sequence += 1;
  return validateTotemEvent({
    schema: EVENT_SCHEMA,
    id: `storage-event-${sequence}`,
    type,
    occurredAt,
    source: { kind: "core", id: "core" },
    taskId,
    payload,
  });
}

async function createFileDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "totem-storage-"));
  directories.push(directory);
  const filename = join(directory, "totem.db");
  const db = openTotemDatabase({ filename });
  databases.push(db);
  await migrateToLatest(db);
  return { db, filename, store: new TaskStore(db) };
}

afterEach(async () => {
  while (databases.length > 0) {
    const db = databases.pop();
    await db?.destroy();
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe("TaskStore", () => {
  it("persists sessions, tasks, progress, and terminal history across restart", async () => {
    const first = await createFileDatabase();
    await first.store.createSession({
      id: "session-1",
      providerId: "mock",
      providerSessionRef: "provider-ref-1",
      at: "2026-09-05T23:50:00.000Z",
    });

    await first.store.createTask(
      {
        id: "task-1",
        kind: "mock",
        title: "Persistent mock task",
        sessionId: "session-1",
        providerId: "mock",
        correlationId: "corr-1",
      },
      event("task.created", "task-1", "2026-09-05T23:50:01.000Z"),
    );
    await first.store.transitionTask(
      "task-1",
      "running",
      event("task.started", "task-1", "2026-09-05T23:50:02.000Z"),
    );
    await first.store.appendTaskEvent(
      "task-1",
      event("task.progress", "task-1", "2026-09-05T23:50:03.000Z", {
        message: "halfway",
        progress: 0.5,
      }),
    );

    await first.db.destroy();
    databases.splice(databases.indexOf(first.db), 1);

    const reopened = openTotemDatabase({ filename: first.filename });
    databases.push(reopened);
    await migrateToLatest(reopened);
    const store = new TaskStore(reopened);

    expect(await store.getSession("session-1")).toMatchObject({
      id: "session-1",
      providerId: "mock",
      providerSessionRef: "provider-ref-1",
      status: "active",
    });
    expect(await store.getTask("task-1")).toMatchObject({
      id: "task-1",
      status: "running",
      startedAt: "2026-09-05T23:50:02.000Z",
    });

    const completed = await store.transitionTask(
      "task-1",
      "succeeded",
      event("task.succeeded", "task-1", "2026-09-05T23:50:04.000Z"),
      { result: { text: "done" } },
    );
    expect(completed).toMatchObject({
      status: "succeeded",
      completedAt: "2026-09-05T23:50:04.000Z",
      result: { text: "done" },
    });

    const history = await store.listTaskEvents("task-1");
    expect(history.map((item) => item.taskSequence)).toEqual([1, 2, 3, 4]);
    expect(history.map((item) => item.event.type)).toEqual([
      "task.created",
      "task.started",
      "task.progress",
      "task.succeeded",
    ]);
  });

  it("keeps snapshot and lifecycle history consistent when a transition is rejected", async () => {
    const { store } = await createFileDatabase();
    await store.createTask(
      { id: "task-atomic", kind: "mock" },
      event("task.created", "task-atomic", "2026-09-05T23:51:00.000Z"),
    );

    await expect(
      store.transitionTask(
        "task-atomic",
        "running",
        event("task.succeeded", "task-atomic", "2026-09-05T23:51:01.000Z"),
      ),
    ).rejects.toThrow(/requires 'task.started'/);

    expect(await store.getTask("task-atomic")).toMatchObject({
      status: "queued",
    });
    expect(
      (await store.listTaskEvents("task-atomic")).map(
        (item) => item.event.type,
      ),
    ).toEqual(["task.created"]);
  });

  it("persists active cancellation and prevents resurrection of terminal tasks", async () => {
    const { store } = await createFileDatabase();
    await store.createTask(
      { id: "task-cancel", kind: "mock" },
      event("task.created", "task-cancel", "2026-09-05T23:52:00.000Z"),
    );
    await store.transitionTask(
      "task-cancel",
      "running",
      event("task.started", "task-cancel", "2026-09-05T23:52:01.000Z"),
    );
    await store.appendTaskEvent(
      "task-cancel",
      event("task.cancel_requested", "task-cancel", "2026-09-05T23:52:02.000Z"),
    );
    await store.transitionTask(
      "task-cancel",
      "cancelling",
      event("task.cancelling", "task-cancel", "2026-09-05T23:52:03.000Z"),
    );
    const cancelled = await store.transitionTask(
      "task-cancel",
      "cancelled",
      event("task.cancelled", "task-cancel", "2026-09-05T23:52:04.000Z"),
    );

    expect(cancelled).toMatchObject({
      status: "cancelled",
      completedAt: "2026-09-05T23:52:04.000Z",
    });
    await expect(
      store.transitionTask(
        "task-cancel",
        "running",
        event("task.resumed", "task-cancel", "2026-09-05T23:52:05.000Z"),
      ),
    ).rejects.toThrow(/Invalid Totem task transition/);
  });

  it("requires normalized failure data for failed snapshots", async () => {
    const { store } = await createFileDatabase();
    await store.createTask(
      { id: "task-fail", kind: "mock" },
      event("task.created", "task-fail", "2026-09-05T23:53:00.000Z"),
    );

    await expect(
      store.transitionTask(
        "task-fail",
        "failed",
        event("task.failed", "task-fail", "2026-09-05T23:53:01.000Z"),
      ),
    ).rejects.toThrow(/requires a normalized failure/);

    const failed = await store.transitionTask(
      "task-fail",
      "failed",
      event("task.failed", "task-fail", "2026-09-05T23:53:02.000Z"),
      {
        failure: {
          code: "mock_failure",
          message: "expected test failure",
          retryable: false,
        },
      },
    );
    expect(failed.failure).toEqual({
      code: "mock_failure",
      message: "expected test failure",
      retryable: false,
    });
  });
});
