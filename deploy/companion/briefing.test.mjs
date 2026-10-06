import assert from "node:assert/strict";
import { test } from "node:test";
import {
  briefingDetail,
  commitments,
  maybeBriefing,
  scheduleWindow,
} from "./briefing.mjs";
import { Companion } from "./state.mjs";

const now = Date.parse("2026-10-05T13:05:00Z");
const navigation = {
  widgets: [
    {
      id: "academic:due-this-week",
      health: "ok",
      updatedAt: new Date(now).toISOString(),
      primary: "9",
      data: {
        nextDueAt: "2026-10-06T20:00:00Z",
        nextCourse: "Math",
        nextName: "Assignment",
      },
    },
    {
      id: "calendar:next-event",
      health: "ok",
      updatedAt: new Date(now).toISOString(),
      title: "Meeting",
      primary: "10:00",
      data: { start: "2026-10-05T14:00:00Z" },
    },
  ],
};
test("next action compares actual commitment timestamps and rejects stale summaries", () => {
  assert.equal(commitments(navigation, now).items[0].title, "Meeting");
  const next = briefingDetail(navigation, {
    now,
    timezone: "America/New_York",
    next: true,
  });
  assert.match(next, /Meeting/);
  assert.doesNotMatch(next, /Assignment/);
  const daily = briefingDetail(navigation, {
    now,
    timezone: "America/New_York",
  });
  assert.match(daily, /Meeting/);
  assert.match(daily, /Math · Assignment/);
  const failed = {
    ...navigation,
    catalog: [{ id: "calendar", enabled: true, health: "err" }],
  };
  assert.equal(commitments(failed, now).items[0].title, "Math · Assignment");
  assert.match(briefingDetail(failed, { now }), /calendar data unavailable/);
  const stale = briefingDetail(navigation, { now: now + 3 * 3600000 });
  assert.equal(stale, "Upcoming commitments unavailable.");
  const empty = {
    widgets: navigation.widgets.map((w) => ({ ...w, data: {} })),
  };
  assert.equal(
    briefingDetail(empty, { now }),
    "No upcoming commitments reported.",
  );
});
test("daily briefing is once per service-local date across restart and DST, with bounded catch-up", () => {
  let clock = now;
  const companion = new Companion(undefined, () => clock);
  assert.equal(
    scheduleWindow(clock, "09:00", "America/New_York"),
    "2026-10-05",
  );
  assert.equal(scheduleWindow(clock, "25:00", "America/New_York"), null);
  assert.equal(
    maybeBriefing(companion, navigation, "09:00", "America/New_York"),
    true,
  );
  const restored = new Companion(
    JSON.parse(JSON.stringify(companion.state)),
    () => clock,
  );
  assert.equal(
    maybeBriefing(restored, navigation, "09:00", "America/New_York"),
    false,
  );
  assert.equal(
    restored.state.outbox.length,
    0,
    "ordinary daily briefing stays local",
  );
  clock = Date.parse("2026-11-02T14:05:00Z");
  assert.equal(
    scheduleWindow(clock, "09:00", "America/New_York"),
    "2026-11-02",
  );
  assert.equal(
    scheduleWindow(clock + 90 * 60000, "09:00", "America/New_York"),
    null,
  );
});
test("focus or unavailable connectors defer scheduling without consuming the daily marker", () => {
  const companion = new Companion(undefined, () => now);
  assert.equal(
    maybeBriefing(companion, {}, "09:00", "America/New_York"),
    false,
  );
  companion.command("totem.focus", { minutes: 10 });
  assert.equal(
    maybeBriefing(companion, navigation, "09:00", "America/New_York"),
    false,
  );
  assert.equal(companion.state.briefing, undefined);
  companion.command("totem.focus", { minutes: 0 });
  assert.equal(
    maybeBriefing(companion, navigation, "09:00", "America/New_York"),
    true,
  );
});
