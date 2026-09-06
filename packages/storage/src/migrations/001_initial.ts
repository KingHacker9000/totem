import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("agent_sessions")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("provider_id", "text", (column) => column.notNull())
    .addColumn("provider_session_ref", "text")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .addColumn("closed_at", "text")
    .addCheckConstraint(
      "agent_sessions_status_check",
      sql`status in ('active', 'closed', 'failed')`,
    )
    .execute();

  await db.schema
    .createTable("tasks")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("title", "text")
    .addColumn("session_id", "text", (column) =>
      column.references("agent_sessions.id").onDelete("set null"),
    )
    .addColumn("provider_id", "text")
    .addColumn("correlation_id", "text")
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .addColumn("started_at", "text")
    .addColumn("completed_at", "text")
    .addColumn("failure_json", "text")
    .addColumn("result_json", "text")
    .addCheckConstraint(
      "tasks_status_check",
      sql`status in ('queued', 'running', 'waiting_for_input', 'cancelling', 'succeeded', 'failed', 'cancelled')`,
    )
    .execute();

  await db.schema
    .createIndex("tasks_status_idx")
    .on("tasks")
    .column("status")
    .execute();

  await db.schema
    .createIndex("tasks_session_idx")
    .on("tasks")
    .column("session_id")
    .execute();

  await db.schema
    .createTable("task_events")
    .addColumn("task_id", "text", (column) =>
      column.notNull().references("tasks.id").onDelete("cascade"),
    )
    .addColumn("task_sequence", "integer", (column) => column.notNull())
    .addColumn("event_id", "text", (column) => column.notNull().unique())
    .addColumn("event_type", "text", (column) => column.notNull())
    .addColumn("occurred_at", "text", (column) => column.notNull())
    .addColumn("envelope_json", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("task_events_pk", ["task_id", "task_sequence"])
    .execute();

  await db.schema
    .createIndex("task_events_task_idx")
    .on("task_events")
    .columns(["task_id", "task_sequence"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("task_events").ifExists().execute();
  await db.schema.dropTable("tasks").ifExists().execute();
  await db.schema.dropTable("agent_sessions").ifExists().execute();
}
