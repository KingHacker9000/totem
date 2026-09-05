import { describe, expect, it } from "vitest";
import {
  assertTaskTransition,
  canTransitionTask,
  expectedLifecycleEventType,
  isTerminalTaskStatus,
  TaskTransitionError,
} from "./index.js";

describe("task lifecycle", () => {
  it("matches the Phase 1 transition contract", () => {
    expect(canTransitionTask("queued", "running")).toBe(true);
    expect(canTransitionTask("queued", "cancelled")).toBe(true);
    expect(canTransitionTask("running", "waiting_for_input")).toBe(true);
    expect(canTransitionTask("waiting_for_input", "running")).toBe(true);
    expect(canTransitionTask("running", "cancelling")).toBe(true);
    expect(canTransitionTask("cancelling", "cancelled")).toBe(true);
    expect(canTransitionTask("succeeded", "running")).toBe(false);
  });

  it("maps accepted transitions to normalized lifecycle events", () => {
    expect(expectedLifecycleEventType("queued", "running")).toBe("task.started");
    expect(expectedLifecycleEventType("waiting_for_input", "running")).toBe(
      "task.resumed",
    );
    expect(expectedLifecycleEventType("running", "succeeded")).toBe(
      "task.succeeded",
    );
    expect(expectedLifecycleEventType("running", "failed")).toBe("task.failed");
  });

  it("rejects transitions out of terminal states", () => {
    expect(isTerminalTaskStatus("succeeded")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("cancelled")).toBe(true);
    expect(() => assertTaskTransition("cancelled", "running")).toThrow(
      TaskTransitionError,
    );
  });
});
