import type { JsonValue, NormalizedFailure } from "@totem/protocol";

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_for_input",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SESSION_STATUSES = ["active", "closed", "failed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface TaskRecord {
  id: string;
  kind: string;
  status: TaskStatus;
  title?: string;
  sessionId?: string;
  providerId?: string;
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: NormalizedFailure;
  result?: JsonValue;
}

export interface AgentSessionRecord {
  id: string;
  providerId: string;
  providerSessionRef?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ["running", "cancelled", "failed"],
  running: ["waiting_for_input", "cancelling", "succeeded", "failed"],
  waiting_for_input: ["running", "cancelling", "failed"],
  cancelling: ["cancelled", "failed"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class TaskTransitionError extends Error {
  readonly from: TaskStatus;
  readonly to: TaskStatus;

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid Totem task transition: ${from} -> ${to}`);
    this.name = "TaskTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) throw new TaskTransitionError(from, to);
}

export function expectedLifecycleEventType(
  from: TaskStatus,
  to: TaskStatus,
): string {
  assertTaskTransition(from, to);

  if (to === "running") {
    return from === "queued" ? "task.started" : "task.resumed";
  }
  if (to === "waiting_for_input") return "task.waiting_for_input";
  if (to === "cancelling") return "task.cancelling";
  if (to === "succeeded") return "task.succeeded";
  if (to === "failed") return "task.failed";
  if (to === "cancelled") return "task.cancelled";

  throw new TaskTransitionError(from, to);
}
