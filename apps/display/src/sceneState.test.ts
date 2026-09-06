import { describe, expect, it } from "vitest";
import {
  SceneArbiter,
  ledChangedEvent,
  normalizeLedState,
  sceneChangedEvent,
} from "./sceneState.js";

describe("scene arbitration", () => {
  it("temporarily overrides lower-priority scenes and restores them", () => {
    const arbiter = new SceneArbiter();

    expect(
      arbiter.request({
        id: "ambient",
        sceneId: "ambient",
        priority: 0,
        requestedAt: 1,
      }).active?.sceneId,
    ).toBe("ambient");

    expect(
      arbiter.request({
        id: "notification",
        sceneId: "notification",
        priority: 50,
        requestedAt: 2,
      }).active?.sceneId,
    ).toBe("notification");

    expect(
      arbiter.request({
        id: "critical",
        sceneId: "critical-alert",
        priority: 100,
        requestedAt: 3,
      }).active?.sceneId,
    ).toBe("critical-alert");

    expect(arbiter.release("critical").active?.sceneId).toBe("notification");
    expect(arbiter.release("notification").active?.sceneId).toBe("ambient");
  });

  it("uses the newest request when priorities tie", () => {
    const arbiter = new SceneArbiter();
    arbiter.request({
      id: "first",
      sceneId: "one",
      priority: 10,
      requestedAt: 1,
    });
    const snapshot = arbiter.request({
      id: "second",
      sceneId: "two",
      priority: 10,
      requestedAt: 2,
    });

    expect(snapshot.active?.id).toBe("second");
  });
});

describe("display runtime events", () => {
  it("emits normalized scene and LED event envelopes", () => {
    const arbiter = new SceneArbiter();
    const snapshot = arbiter.request({
      id: "ambient",
      sceneId: "ambient",
      priority: 0,
      requestedAt: 1,
    });

    const sceneEvent = sceneChangedEvent(snapshot, "2026-09-06T03:20:00.000Z");
    expect(sceneEvent).toMatchObject({
      schema: "totem.event/v0",
      type: "display.scene_changed",
      occurredAt: "2026-09-06T03:20:00.000Z",
      source: { kind: "core", id: "display-runtime" },
      payload: { activeSceneId: "ambient", priority: 0 },
    });

    const ledEvent = ledChangedEvent(
      { semantic: "attention", effect: "pulse", intensity: 0.8 },
      "2026-09-06T03:20:01.000Z",
    );
    expect(ledEvent).toMatchObject({
      schema: "totem.event/v0",
      type: "display.led_changed",
      source: { kind: "core", id: "display-runtime" },
      payload: { semantic: "attention", effect: "pulse", intensity: 0.8 },
    });
  });

  it("clamps virtual LED intensity", () => {
    expect(
      normalizeLedState({ semantic: "success", effect: "solid", intensity: 4 }),
    ).toEqual({ semantic: "success", effect: "solid", intensity: 1 });
    expect(
      normalizeLedState({ semantic: "idle", effect: "off", intensity: -1 }),
    ).toEqual({ semantic: "idle", effect: "off", intensity: 0 });
  });
});
