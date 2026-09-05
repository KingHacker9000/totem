import { describe, expect, it } from "vitest";
import {
  EVENT_SCHEMA,
  EventValidationError,
  parseTotemEvent,
  serializeTotemEvent,
  validateEventNamespace,
  validateTotemEvent,
} from "./index.js";

function systemEvent(overrides: Record<string, unknown> = {}) {
  return {
    schema: EVENT_SCHEMA,
    id: "evt_001",
    type: "system.ready",
    occurredAt: "2026-09-05T23:00:00.000Z",
    source: { kind: "core", id: "core" },
    payload: { version: "0.0.0" },
    ...overrides,
  };
}

describe("Totem event protocol", () => {
  it("accepts and round-trips a normalized core event", () => {
    const event = validateTotemEvent(systemEvent());
    expect(event.type).toBe("system.ready");

    const serialized = serializeTotemEvent(event);
    expect(parseTotemEvent(serialized)).toEqual(event);
  });

  it("allows an extension only inside its own ext namespace", () => {
    const valid = systemEvent({
      type: "ext.spotify.playback_changed",
      source: { kind: "extension", id: "spotify" },
    });
    expect(validateTotemEvent(valid).type).toBe("ext.spotify.playback_changed");

    expect(() =>
      validateTotemEvent(
        systemEvent({
          type: "system.ready",
          source: { kind: "extension", id: "spotify" },
        }),
      ),
    ).toThrow(EventValidationError);

    expect(
      validateEventNamespace("ext.spotify.playback_changed", {
        kind: "extension",
        id: "weather",
      }),
    ).toContain("extension 'weather' may only publish under 'ext.weather.*'");
  });

  it("prevents non-extension sources from impersonating extensions", () => {
    expect(() =>
      validateTotemEvent(
        systemEvent({
          type: "ext.spotify.playback_changed",
          source: { kind: "core", id: "core" },
        }),
      ),
    ).toThrow(/only extension sources may publish/);
  });

  it("requires task ids and validates task progress", () => {
    expect(() =>
      validateTotemEvent(
        systemEvent({
          type: "task.progress",
          source: { kind: "provider", id: "mock" },
          payload: { message: "Working", progress: 0.5 },
        }),
      ),
    ).toThrow(/taskId/);

    expect(
      validateTotemEvent(
        systemEvent({
          type: "task.progress",
          source: { kind: "provider", id: "mock" },
          taskId: "task_001",
          payload: { message: "Working", progress: 0.5 },
        }),
      ).payload,
    ).toEqual({ message: "Working", progress: 0.5 });

    expect(() =>
      validateTotemEvent(
        systemEvent({
          type: "task.progress",
          source: { kind: "provider", id: "mock" },
          taskId: "task_001",
          payload: { progress: 1.25 },
        }),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it("rejects unknown envelope fields and non-JSON payloads", () => {
    expect(() =>
      validateTotemEvent(systemEvent({ nativeProviderEvent: true })),
    ).toThrow(/unknown field/);

    expect(() =>
      validateTotemEvent(systemEvent({ payload: { value: undefined } })),
    ).toThrow(/JSON-serializable/);
  });

  it("rejects invalid timestamps and invalid serialized input", () => {
    expect(() =>
      validateTotemEvent(systemEvent({ occurredAt: "2026-09-05 23:00:00" })),
    ).toThrow(/UTC ISO-8601/);

    expect(() => parseTotemEvent("not json")).toThrow(
      /serialized event must contain valid JSON/,
    );
  });
});
