import { checkObject, text } from "./state.mjs";

export const SOURCES = [
  "academic",
  "calendar",
  "github",
  "swinglab",
  "printing",
  "jobs",
  "webhook",
];

// Trusted local producers share a small event contract, never the command API.
export function publishEvent(companion, input) {
  checkObject(input, [
    "source",
    "type",
    "severity",
    "title",
    "detail",
    "dedupeKey",
    "timestamp",
    "ttlSeconds",
    "proactive",
    "actions",
  ]);
  if (!SOURCES.includes(input.source)) throw new Error("unknown event source");
  const dedupeKey = text(input.dedupeKey, 100);
  const now = companion.clock();
  if (input.timestamp !== undefined && typeof input.timestamp !== "string")
    throw new Error("invalid event timestamp");
  const timestamp =
    input.timestamp === undefined ? now : Date.parse(input.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now + 60000 ||
    timestamp < now - 86400000
  )
    throw new Error("event timestamp outside delivery window");
  // No executable actions are accepted before their presentation/control contract exists.
  if (
    input.actions !== undefined &&
    (!Array.isArray(input.actions) || input.actions.length)
  )
    throw new Error("event actions unsupported");
  const { timestamp: ignored, actions, ...event } = input;
  const result = companion.event({ ...event, dedupeKey }, "local-event");
  if (result.id && !result.deduplicated) {
    const stored = companion.state.events.find((e) => e.id === result.id);
    stored.occurredAt = timestamp;
    const queued = companion.state.outbox.find((e) => e.id === result.id);
    if (queued) queued.occurredAt = timestamp;
  }
  return result;
}
