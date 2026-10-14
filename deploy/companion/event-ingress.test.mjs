import assert from "node:assert/strict";
import { test } from "node:test";
import { publishEvent } from "./event-ingress.mjs";
import { Companion } from "./state.mjs";

test("local job and printing adapters share display/outbox state, stable dedupe and acknowledgement", () => {
  const c = new Companion(undefined, () => new Date(2026, 9, 5, 12).getTime());
  for (const source of ["jobs", "printing"]) {
    const event = {
      source,
      type: "job.completed",
      title: "Completed",
      severity: "attention",
      dedupeKey: "run-1",
    };
    const result = publishEvent(c, event);
    assert.equal(
      c.state.outbox.some((e) => e.id === result.id),
      true,
    );
    assert.equal(
      c.snapshot().events.find((e) => e.id === result.id).origin,
      "local-event",
    );
    const restored = new Companion(
      JSON.parse(JSON.stringify(c.state)),
      c.clock,
    );
    assert.equal(publishEvent(restored, event).deduplicated, true);
    c.command("totem.dismiss", { id: result.id }, "muse");
    assert.equal(
      c.state.outbox.some((e) => e.id === result.id),
      false,
    );
    assert.equal(publishEvent(c, event).deduplicated, true);
  }
});
test("producer ingress denies commands, unknown sources, executable actions and stale/future timestamps atomically", () => {
  const c = new Companion();
  const valid = { source: "jobs", title: "Finished", dedupeKey: "run-2" };
  for (const bad of [
    { ...valid, command: "system.run" },
    { ...valid, source: "system" },
    { ...valid, actions: [{ command: "totem.restart_core" }] },
    { ...valid, timestamp: "invalid" },
    { ...valid, timestamp: [new Date().toISOString()] },
    { ...valid, timestamp: new Date(Date.now() + 120000).toISOString() },
    { ...valid, timestamp: new Date(Date.now() - 86401000).toISOString() },
  ])
    assert.throws(() => publishEvent(c, bad));
  assert.equal(c.state.events.length, 0);
  assert.equal(c.state.outbox.length, 0);
});
