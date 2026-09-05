import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  Kysely,
  Migrator,
  SqliteDialect,
  type Migration,
  type MigrationProvider,
} from "kysely";
import {
  parseTotemEvent,
  serializeTotemEvent,
  type JsonValue,
  type NormalizedFailure,
  type TotemEvent,
  validateTotemEvent,
} from "@totem/protocol";
import {
  assertTaskTransition,
  expectedLifecycleEventType,
  isTerminalTaskStatus,
  type AgentSessionRecord,
  type SessionStatus,
  type TaskRecord,
  type TaskStatus,
} from "@totem/tasks";
import * as initialMigration from "./migrations/001_initial.js";

interface TasksTable {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  session_id: string | null;
  provider_id: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_json: string | null;
  result_json: string | null;
}

interface TaskEventsTable {
  task_id: string;
  task_sequence: number;
  event_id: string;
  event_type: string;
  occurred_at: string;
  envelope_json: string;
}

interface AgentSessionsTable {
  id: string;
  provider_id: string;
  provider_session_ref: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface TotemDatabase {
  tasks: TasksTable;
  task_events: TaskEventsTable;
  agent_sessions: AgentSessionsTable;
}

const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "001_initial": initialMigration,
};

class TotemMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...MIGRATIONS };
  }
}

export interface OpenDatabaseOptions {
  filename: string;
}

export function openTotemDatabase(
  options: OpenDatabaseOptions,
): Kysely<TotemDatabase> {
  if (options.filename !== ":memory:") {
    mkdirSync(dirname(options.filename), { recursive: true });
  }

  const sqlite = new Database(options.filename);
  sqlite.pragma("foreign_keys = ON");
  if (options.filename !== ":memory:") sqlite.pragma("journal_mode = WAL");

  return new Kysely<TotemDatabase>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
}

export async function migrateToLatest(
  db: Kysely<TotemDatabase>,
): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new TotemMigrationProvider(),
  });
  const { error, results } = await migrator.migrateToLatest();

  if (error) throw error;
  const failed = results?.find((result) => result.status === "Error");
  if (failed) {
    throw new Error(`Totem migration '${failed.migrationName}' failed`);
  }
}

export interface CreateTaskInput {
  id: string;
  kind: string;
  title?: string;
  sessionId?: string;
  providerId?: string;
  correlationId?: string;
}

export interface CreateSessionInput {
  id: string;
  providerId: string;
  providerSessionRef?: string;
  at: string;
}

export interface TaskTransitionOptions {
  result?: JsonValue;
  failure?: NormalizedFailure;
}

export interface StoredTaskEvent {
  taskSequence: number;
  event: TotemEvent;
}

const LIFECYCLE_EVENT_TYPES = new Set([
  "task.created",
  "task.started",
  "task.waiting_for_input",
  "task.resumed",
  "task.cancelling",
  "task.cancelled",
  "task.succeeded",
  "task.failed",
]);

function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} must not be empty`);
}

function serializeJsonField(value: JsonValue | NormalizedFailure): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Value must be JSON-serializable");
  return serialized;
}

function parseJsonField<T>(value: string | null): T | undefined {
  if (value === null) return undefined;
  return JSON.parse(value) as T;
}

function toTaskRecord(row: TasksTable): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as TaskStatus,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.provider_id === null ? {} : { providerId: row.provider_id }),
    ...(row.correlation_id === null
      ? {}
      : { correlationId: row.correlation_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.failure_json === null
      ? {}
      : { failure: parseJsonField<NormalizedFailure>(row.failure_json) }),
    ...(row.result_json === null
      ? {}
      : { result: parseJsonField<JsonValue>(row.result_json) }),
  };
}

function toSessionRecord(row: AgentSessionsTable): AgentSessionRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    ...(row.provider_session_ref === null
      ? {}
      : { providerSessionRef: row.provider_session_ref }),
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
  };
}

function assertTaskEvent(event: unknown, taskId: string): TotemEvent {
  const validated = validateTotemEvent(event);
  if (validated.taskId !== taskId) {
    throw new Error(`Event taskId must equal '${taskId}'`);
  }
  return validated;
}

export class TaskStore {
  constructor(readonly db: Kysely<TotemDatabase>) {}

  async createTask(
    input: CreateTaskInput,
    event: unknown,
  ): Promise<TaskRecord> {
    requireNonEmpty(input.id, "task id");
    requireNonEmpty(input.kind, "task kind");
    const createdEvent = assertTaskEvent(event, input.id);
    if (createdEvent.type !== "task.created") {
      throw new Error("Task creation requires a task.created event");
    }

    return this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("tasks")
        .values({
          id: input.id,
          kind: input.kind,
          status: "queued",
          title: input.title ?? null,
          session_id: input.sessionId ?? null,
          provider_id: input.providerId ?? null,
          correlation_id: input.correlationId ?? null,
          created_at: createdEvent.occurredAt,
          updated_at: createdEvent.occurredAt,
          started_at: null,
          completed_at: null,
          failure_json: null,
          result_json: null,
        })
        .executeTakeFirstOrThrow();

      await this.insertEvent(trx, input.id, createdEvent);
      const row = await trx
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirstOrThrow();
      return toTaskRecord(row);
    });
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const row = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirst();
    return row ? toTaskRecord(row) : undefined;
  }

  async listTasks(): Promise<TaskRecord[]> {
    const rows = await this.db
      .selectFrom("tasks")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(toTaskRecord);
  }

  async transitionTask(
    taskId: string,
    to: TaskStatus,
    event: unknown,
    options: TaskTransitionOptions = {},
  ): Promise<TaskRecord> {
    const transitionEvent = assertTaskEvent(event, taskId);

    return this.db.transaction().execute(async (trx) => {
      const currentRow = await trx
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", taskId)
        .executeTakeFirstOrThrow();
      const from = currentRow.status as TaskStatus;
      assertTaskTransition(from, to);

      const expectedType = expectedLifecycleEventType(from, to);
      if (transitionEvent.type !== expectedType) {
        throw new Error(
          `Transition ${from} -> ${to} requires '${expectedType}', got '${transitionEvent.type}'`,
        );
      }
      if (to === "failed" && !options.failure) {
        throw new Error(
          "A failed task transition requires a normalized failure",
        );
      }
      if (to !== "failed" && options.failure) {
        throw new Error("failure is only valid for a failed task transition");
      }
      if (to !== "succeeded" && options.result !== undefined) {
        throw new Error("result is only valid for a succeeded task transition");
      }

      const now = transitionEvent.occurredAt;
      const terminal = isTerminalTaskStatus(to);
      await trx
        .updateTable("tasks")
        .set({
          status: to,
          updated_at: now,
          started_at:
            to === "running" && currentRow.started_at === null
              ? now
              : currentRow.started_at,
          completed_at: terminal ? now : currentRow.completed_at,
          failure_json:
            to === "failed" && options.failure
              ? serializeJsonField(options.failure)
              : null,
          result_json:
            to === "succeeded" && options.result !== undefined
              ? serializeJsonField(options.result)
              : null,
        })
        .where("id", "=", taskId)
        .executeTakeFirstOrThrow();

      await this.insertEvent(trx, taskId, transitionEvent);
      const updated = await trx
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", taskId)
        .executeTakeFirstOrThrow();
      return toTaskRecord(updated);
    });
  }

  async appendTaskEvent(taskId: string, event: unknown): Promise<number> {
    const validated = assertTaskEvent(event, taskId);
    if (LIFECYCLE_EVENT_TYPES.has(validated.type)) {
      throw new Error(
        `Lifecycle event '${validated.type}' must be written through createTask/transitionTask`,
      );
    }

    return this.db
      .transaction()
      .execute((trx) => this.insertEvent(trx, taskId, validated));
  }

  async listTaskEvents(taskId: string): Promise<StoredTaskEvent[]> {
    const rows = await this.db
      .selectFrom("task_events")
      .select(["task_sequence", "envelope_json"])
      .where("task_id", "=", taskId)
      .orderBy("task_sequence", "asc")
      .execute();

    return rows.map((row) => ({
      taskSequence: row.task_sequence,
      event: parseTotemEvent(row.envelope_json),
    }));
  }

  async createSession(input: CreateSessionInput): Promise<AgentSessionRecord> {
    requireNonEmpty(input.id, "session id");
    requireNonEmpty(input.providerId, "provider id");
    await this.db
      .insertInto("agent_sessions")
      .values({
        id: input.id,
        provider_id: input.providerId,
        provider_session_ref: input.providerSessionRef ?? null,
        status: "active",
        created_at: input.at,
        updated_at: input.at,
        closed_at: null,
      })
      .executeTakeFirstOrThrow();
    return (await this.getSession(input.id)) as AgentSessionRecord;
  }

  async getSession(sessionId: string): Promise<AgentSessionRecord | undefined> {
    const row = await this.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .executeTakeFirst();
    return row ? toSessionRecord(row) : undefined;
  }

  async updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    at: string,
    providerSessionRef?: string,
  ): Promise<AgentSessionRecord> {
    const existing = await this.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();

    if (existing.status === "closed" || existing.status === "failed") {
      if (existing.status !== status) {
        throw new Error(`Session '${sessionId}' is already terminal`);
      }
      return toSessionRecord(existing);
    }

    await this.db
      .updateTable("agent_sessions")
      .set({
        status,
        updated_at: at,
        closed_at: status === "active" ? null : at,
        provider_session_ref:
          providerSessionRef === undefined
            ? existing.provider_session_ref
            : providerSessionRef,
      })
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();

    return (await this.getSession(sessionId)) as AgentSessionRecord;
  }

  private async insertEvent(
    db: Kysely<TotemDatabase>,
    taskId: string,
    event: TotemEvent,
  ): Promise<number> {
    const envelope = serializeTotemEvent(event);
    const existing = await db
      .selectFrom("task_events")
      .select(["task_id", "task_sequence", "envelope_json"])
      .where("event_id", "=", event.id)
      .executeTakeFirst();

    if (existing) {
      if (existing.task_id === taskId && existing.envelope_json === envelope) {
        return existing.task_sequence;
      }
      throw new Error(
        `Event id '${event.id}' is already used by another event`,
      );
    }

    const last = await db
      .selectFrom("task_events")
      .select("task_sequence")
      .where("task_id", "=", taskId)
      .orderBy("task_sequence", "desc")
      .limit(1)
      .executeTakeFirst();
    const taskSequence = (last?.task_sequence ?? 0) + 1;

    await db
      .insertInto("task_events")
      .values({
        task_id: taskId,
        task_sequence: taskSequence,
        event_id: event.id,
        event_type: event.type,
        occurred_at: event.occurredAt,
        envelope_json: envelope,
      })
      .executeTakeFirstOrThrow();
    return taskSequence;
  }
}
