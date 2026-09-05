export const EVENT_SCHEMA = "totem.event/v0" as const;

export const CORE_EVENT_PREFIXES = [
  "input",
  "speech",
  "agent",
  "task",
  "extension",
  "theme",
  "display",
  "audio",
  "system",
  "notification",
] as const;

export const CORE_EVENT_TYPES = [
  "task.created",
  "task.started",
  "task.progress",
  "task.waiting_for_input",
  "task.resumed",
  "task.cancel_requested",
  "task.cancelling",
  "task.cancelled",
  "task.succeeded",
  "task.failed",
  "agent.session_created",
  "agent.session_resumed",
  "agent.message",
  "agent.progress",
  "agent.interrupted",
  "system.ready",
  "system.stopping",
] as const;

export type CoreEventPrefix = (typeof CORE_EVENT_PREFIXES)[number];
export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

export type EventSourceKind =
  | "core"
  | "client"
  | "extension"
  | "provider"
  | "speech"
  | "device";

export interface EventSource {
  kind: EventSourceKind;
  id: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface TotemEvent<T = unknown> {
  schema: typeof EVENT_SCHEMA;
  id: string;
  type: string;
  occurredAt: string;
  source: EventSource;
  taskId?: string;
  sessionId?: string;
  correlationId?: string;
  causationId?: string;
  payload: T;
}

export interface TaskProgressPayload {
  message?: string;
  progress?: number;
}

export interface NormalizedFailure {
  code: string;
  message: string;
  retryable?: boolean;
  details?: JsonValue;
}

export class EventValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Totem event: ${issues.join("; ")}`);
    this.name = "EventValidationError";
    this.issues = issues;
  }
}

const EVENT_KEYS = new Set([
  "schema",
  "id",
  "type",
  "occurredAt",
  "source",
  "taskId",
  "sessionId",
  "correlationId",
  "causationId",
  "payload",
]);

const SOURCE_KEYS = new Set(["kind", "id"]);
const SOURCE_KINDS = new Set<EventSourceKind>([
  "core",
  "client",
  "extension",
  "provider",
  "speech",
  "device",
]);

const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  issues: string[],
): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      issues.push(`${field} contains unknown field '${key}'`);
  }
}

function validateJsonValue(
  value: unknown,
  path: string,
  issues: string[],
  seen: Set<object>,
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value))
      issues.push(`${path} must contain finite numbers`);
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      issues.push(`${path} must not contain circular references`);
      return;
    }
    seen.add(value);
    for (const [index, item] of value.entries()) {
      validateJsonValue(item, `${path}[${index}]`, issues, seen);
    }
    seen.delete(value);
    return;
  }

  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(`${path} must contain only plain JSON objects`);
      return;
    }
    if (seen.has(value)) {
      issues.push(`${path} must not contain circular references`);
      return;
    }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      validateJsonValue(child, `${path}.${key}`, issues, seen);
    }
    seen.delete(value);
    return;
  }

  issues.push(`${path} must be JSON-serializable`);
}

function validateSource(
  source: unknown,
  issues: string[],
): source is EventSource {
  const issueCountBefore = issues.length;

  if (!isRecord(source)) {
    issues.push("source must be an object");
    return false;
  }

  rejectUnknownKeys(source, SOURCE_KEYS, "source", issues);

  const kind = source.kind;
  if (typeof kind !== "string" || !SOURCE_KINDS.has(kind as EventSourceKind)) {
    issues.push(
      "source.kind must be core, client, extension, provider, speech, or device",
    );
  }

  const hasId = requireNonEmptyString(source.id, "source.id", issues);
  if (
    kind === "extension" &&
    hasId &&
    !EXTENSION_ID_PATTERN.test(source.id as string)
  ) {
    issues.push("source.id must be a valid extension id for extension events");
  }

  return issues.length === issueCountBefore;
}

export function isCoreNamespace(type: string): boolean {
  const prefix = type.split(".", 1)[0];
  return CORE_EVENT_PREFIXES.includes(prefix as CoreEventPrefix);
}

export function validateEventNamespace(
  type: string,
  source: EventSource,
): string[] {
  const issues: string[] = [];

  if (!EVENT_TYPE_PATTERN.test(type)) {
    issues.push("type must be a dot-separated lowercase event name");
    return issues;
  }

  if (source.kind === "extension") {
    const expectedPrefix = `ext.${source.id}.`;
    if (!type.startsWith(expectedPrefix)) {
      issues.push(
        `extension '${source.id}' may only publish under '${expectedPrefix}*'`,
      );
    }
    return issues;
  }

  if (type.startsWith("ext.")) {
    issues.push(
      "only extension sources may publish ext.<extension-id>.* events",
    );
    return issues;
  }

  if (!isCoreNamespace(type)) {
    issues.push("runtime event type must use a reserved Totem core namespace");
  }

  return issues;
}

function validateTaskProgressPayload(payload: unknown, issues: string[]): void {
  if (!isRecord(payload)) {
    issues.push("task.progress payload must be an object");
    return;
  }

  if (
    "message" in payload &&
    payload.message !== undefined &&
    typeof payload.message !== "string"
  ) {
    issues.push("task.progress payload.message must be a string when present");
  }

  if ("progress" in payload && payload.progress !== undefined) {
    if (
      typeof payload.progress !== "number" ||
      !Number.isFinite(payload.progress) ||
      payload.progress < 0 ||
      payload.progress > 1
    ) {
      issues.push("task.progress payload.progress must be between 0 and 1");
    }
  }
}

export function validateTotemEvent<T = unknown>(input: unknown): TotemEvent<T> {
  const issues: string[] = [];

  if (!isRecord(input)) {
    throw new EventValidationError(["event must be an object"]);
  }

  rejectUnknownKeys(input, EVENT_KEYS, "event", issues);

  if (input.schema !== EVENT_SCHEMA) {
    issues.push(`schema must be exactly '${EVENT_SCHEMA}'`);
  }

  requireNonEmptyString(input.id, "id", issues);
  const hasType = requireNonEmptyString(input.type, "type", issues);
  const hasOccurredAt = requireNonEmptyString(
    input.occurredAt,
    "occurredAt",
    issues,
  );
  const hasSource = validateSource(input.source, issues);

  for (const field of [
    "taskId",
    "sessionId",
    "correlationId",
    "causationId",
  ] as const) {
    if (input[field] !== undefined) {
      requireNonEmptyString(input[field], field, issues);
    }
  }

  if (!("payload" in input)) {
    issues.push("payload is required");
  } else {
    validateJsonValue(input.payload, "payload", issues, new Set());
  }

  if (
    hasOccurredAt &&
    typeof input.occurredAt === "string" &&
    (!input.occurredAt.endsWith("Z") ||
      !Number.isFinite(Date.parse(input.occurredAt)))
  ) {
    issues.push(
      "occurredAt must be a valid UTC ISO-8601 timestamp ending in Z",
    );
  }

  if (hasType && hasSource) {
    issues.push(
      ...validateEventNamespace(
        input.type as string,
        input.source as EventSource,
      ),
    );
  }

  if (hasType && (input.type as string).startsWith("task.")) {
    requireNonEmptyString(input.taskId, "taskId", issues);
  }

  if (input.type === "task.progress") {
    validateTaskProgressPayload(input.payload, issues);
  }

  if (issues.length > 0) throw new EventValidationError(issues);
  return input as unknown as TotemEvent<T>;
}

export function serializeTotemEvent(event: unknown): string {
  return JSON.stringify(validateTotemEvent(event));
}

export function parseTotemEvent<T = unknown>(
  serialized: string,
): TotemEvent<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new EventValidationError([
      "serialized event must contain valid JSON",
    ]);
  }
  return validateTotemEvent<T>(parsed);
}
