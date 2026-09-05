import { describe, expect, it, vi } from "vitest";
import { EventBus, EventDispatchError } from "./index.js";

interface TestEvent {
  type: string;
  value: number;
}

function validate(input: unknown): TestEvent {
  if (
    typeof input !== "object" ||
    input === null ||
    !("type" in input) ||
    typeof input.type !== "string" ||
    !("value" in input) ||
    typeof input.value !== "number"
  ) {
    throw new Error("invalid event");
  }
  return input as TestEvent;
}

describe("EventBus", () => {
  it("validates before dispatch and delivers in registration order", () => {
    const bus = new EventBus<TestEvent>(validate);
    const calls: string[] = [];

    bus.subscribe(() => calls.push("first"));
    bus.subscribe(() => calls.push("second"));

    expect(bus.publish({ type: "system.ready", value: 1 })).toEqual({
      type: "system.ready",
      value: 1,
    });
    expect(calls).toEqual(["first", "second"]);

    expect(() => bus.publish({ type: "system.ready" })).toThrow(
      "invalid event",
    );
    expect(calls).toEqual(["first", "second"]);
  });

  it("supports exact-type subscriptions and idempotent unsubscribe", () => {
    const bus = new EventBus<TestEvent>(validate);
    const all = vi.fn();
    const ready = vi.fn();

    bus.subscribe(all);
    const unsubscribe = bus.subscribeType("system.ready", ready);

    bus.publish({ type: "system.ready", value: 1 });
    bus.publish({ type: "system.stopping", value: 2 });
    expect(all).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    expect(bus.subscriberCount).toBe(1);

    bus.publish({ type: "system.ready", value: 3 });
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("finishes dispatch before reporting listener failures", () => {
    const bus = new EventBus<TestEvent>(validate);
    const calls: string[] = [];

    bus.subscribe(() => {
      calls.push("first");
      throw new Error("listener failed");
    });
    bus.subscribe(() => calls.push("second"));

    try {
      bus.publish({ type: "system.ready", value: 1 });
      throw new Error("expected publish to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EventDispatchError);
      expect((error as EventDispatchError<TestEvent>).errors).toHaveLength(1);
    }

    expect(calls).toEqual(["first", "second"]);
  });

  it("uses a dispatch snapshot when subscriptions change mid-event", () => {
    const bus = new EventBus<TestEvent>(validate);
    const calls: string[] = [];
    let unsubscribeSecond = () => {};

    bus.subscribe(() => {
      calls.push("first");
      unsubscribeSecond();
    });
    unsubscribeSecond = bus.subscribe(() => calls.push("second"));

    bus.publish({ type: "system.ready", value: 1 });
    expect(calls).toEqual(["first", "second"]);

    calls.length = 0;
    bus.publish({ type: "system.ready", value: 2 });
    expect(calls).toEqual(["first"]);
  });
});
