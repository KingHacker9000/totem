import assert from "node:assert/strict";
import { test } from "node:test";
import { observeHealthEvents } from "./health-events.mjs";
import { Companion } from "./state.mjs";

test("health acknowledgements silence an incident, but recovery permits a new fault immediately", () => {
  const companion = new Companion();
  const failed = {
    "touch-unavailable": { title: "Touch unavailable", severity: "critical" },
  };
  observeHealthEvents(companion, failed);
  const first = companion.state.events[0];
  observeHealthEvents(companion, failed);
  assert.equal(companion.state.events.length, 1);
  companion.command("totem.dismiss", { id: first.id });
  const restored = new Companion(JSON.parse(JSON.stringify(companion.state)));
  observeHealthEvents(restored, failed);
  assert.equal(restored.state.events.length, 0);
  observeHealthEvents(restored, { "touch-unavailable": null });
  observeHealthEvents(restored, failed);
  assert.equal(restored.state.events.length, 1);
  assert.notEqual(restored.state.events[0].dedupeKey, first.dedupeKey);
  assert.equal(restored.state.outbox.length, 1);
});

test("health migration adopts visible legacy alerts and does not silently clear critical problems", () => {
  const companion = new Companion();
  const legacy = companion.event(
    {
      source: "system",
      dedupeKey: "touch-unavailable",
      title: "Touch unavailable",
      severity: "critical",
    },
    "system",
  );
  observeHealthEvents(companion, {
    "touch-unavailable": { title: "Touch unavailable", severity: "critical" },
  });
  assert.equal(companion.state.events.length, 1);
  observeHealthEvents(companion, { "touch-unavailable": null });
  assert.equal(companion.state.events[0].id, legacy.id);
});
