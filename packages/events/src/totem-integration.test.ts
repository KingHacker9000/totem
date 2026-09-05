import { describe, expect, it, vi } from "vitest";
import {
  EVENT_SCHEMA,
  type TotemEvent,
  validateTotemEvent,
} from "../../protocol/src/index.js";
import { EventBus } from "./index.js";

describe("Totem protocol/event-bus composition", () => {
  it("publishes only validated normalized Totem events", () => {
    const bus = new EventBus<TotemEvent>(validateTotemEvent);
    const listener = vi.fn();
    bus.subscribe(listener);

    const event = {
      schema: EVENT_SCHEMA,
      id: "evt_ready_001",
      type: "system.ready",
      occurredAt: "2026-09-05T23:00:00.000Z",
      source: { kind: "core", id: "core" },
      payload: { stage: "phase-1" },
    };

    bus.publish(event);
    expect(listener).toHaveBeenCalledWith(event);

    expect(() =>
      bus.publish({
        ...event,
        type: "ext.spotify.playback_changed",
      }),
    ).toThrow(/only extension sources may publish/);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
