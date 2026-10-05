import assert from "node:assert/strict";
import { test } from "node:test";
import { Companion } from "./state.mjs";

const make = () => {
  let time = new Date("2026-10-05T12:00:00").getTime();
  return { c: new Companion(null, () => time), advance: (ms) => (time += ms) };
};
test("deny unknown commands, injected fields and invalid argument ranges", () => {
  const { c } = make();
  for (const [name, args] of [
    ["system.run", { command: "id" }],
    ["totem.avatar.set_state", { shell: "id" }],
    ["totem.avatar.look_at", { x: 2, y: 0 }],
    ["totem.focus", { minutes: "25" }],
    ["totem.notify", { title: "x", proactive: "yes" }],
  ])
    assert.throws(() => c.command(name, args));
});
test("critical notices persist and acknowledgement survives reload/deduplication", () => {
  const { c, advance } = make();
  const args = {
    source: "job",
    title: "Failed",
    severity: "critical",
    dedupeKey: "job-1",
  };
  const event = c.command("totem.notify", args, "job");
  advance(100000);
  assert.equal(c.snapshot().card.id, event.id);
  c.command("totem.dismiss", { id: event.id }, "muse");
  const restored = new Companion(JSON.parse(JSON.stringify(c.state)), c.clock);
  assert.equal(
    restored.command("totem.notify", args, "job").deduplicated,
    true,
  );
  assert.equal(restored.snapshot().events.length, 0);
  assert.equal(restored.state.outbox.length, 0);
});
test("transient thinking times out without transport and accessory persists", () => {
  const { c, advance } = make();
  c.command(
    "totem.avatar.set_state",
    { activity: "thinking", accessory: "sunglasses" },
    "muse",
  );
  advance(31000);
  assert.equal(c.snapshot().avatar.activity, "idle");
  assert.equal(c.snapshot().avatar.accessory, "sunglasses");
});
test("focus suppresses ordinary notices but keeps urgent alerts and completes once", () => {
  const { c, advance } = make();
  c.command("totem.focus", { minutes: 1 });
  c.command("totem.notify", { title: "Ordinary", severity: "attention" });
  assert.equal(c.snapshot().card, null);
  const urgent = c.command("totem.notify", {
    title: "Urgent",
    severity: "urgent",
  });
  assert.equal(c.snapshot().card.id, urgent.id);
  advance(61000);
  c.tick();
  c.tick();
  assert.equal(c.state.focus, null);
  assert.equal(c.state.events.filter((e) => e.source === "timer").length, 1);
});
test("remote notices do not echo back to Muse; delivery limits survive restart", () => {
  const { c } = make();
  c.command("totem.notify", { title: "Phone notice" }, "muse");
  assert.equal(c.state.outbox.length, 0);
  for (let i = 0; i < 3; i++) {
    c.command(
      "totem.notify",
      { title: "Job", source: "job", dedupeKey: `job-${i}` },
      "job",
    );
    const e = c.nextDelivery();
    if (e) c.delivered(e.id);
  }
  assert.equal(c.state.deliveries.length, 2);
  const restored = new Companion(JSON.parse(JSON.stringify(c.state)), c.clock);
  assert.equal(restored.nextDelivery(), null);
});
test("invalid multi-field state is atomic", () => {
  const { c } = make();
  const old = JSON.stringify(c.state.avatar);
  assert.throws(() =>
    c.command("totem.avatar.set_state", { mood: "pleased", accessory: "bad" }),
  );
  assert.equal(JSON.stringify(c.state.avatar), old);
});
test("expired connector events cannot create repeated outbox deliveries", () => {
  const { c, advance } = make();
  const args = {
    source: "github",
    title: "Job done",
    dedupeKey: "build-1",
    ttlSeconds: 3,
  };
  c.command("totem.notify", args, "adapter");
  advance(4000);
  c.tick();
  assert.equal(c.command("totem.notify", args, "adapter").deduplicated, true);
  assert.equal(c.state.outbox.length, 1);
});
test("wake reaction exits sleep and one noisy source cannot fill the queue", () => {
  const { c } = make();
  c.command("totem.avatar.set_state", { activity: "sleeping" });
  c.command("totem.avatar.react", { reaction: "wake" });
  assert.equal(c.state.avatar.activity, "idle");
  for (let i = 0; i < 16; i++)
    assert.equal(
      c.command(
        "totem.notify",
        { source: "noisy", title: "Notice", dedupeKey: `${i}` },
        "adapter",
      ).ok,
      true,
    );
  assert.equal(
    c.command(
      "totem.notify",
      { source: "noisy", title: "Notice", dedupeKey: "overflow" },
      "adapter",
    ).ok,
    false,
  );
  assert.equal(
    c.command(
      "totem.notify",
      { source: "other", title: "Important", severity: "critical" },
      "adapter",
    ).ok,
    true,
  );
});
test("remote reaction is preserved and focus supersedes a transient activity", () => {
  const { c, advance } = make();
  c.command("totem.avatar.react", { reaction: "boop" }, "muse");
  assert.equal(c.state.reaction.name, "boop");
  c.command("totem.avatar.set_state", { activity: "thinking" });
  c.command("totem.focus", { minutes: 2 });
  advance(31000);
  c.tick();
  assert.equal(c.state.avatar.activity, "focus");
  assert.ok(c.state.focus);
});
test("proactive delivery chooses critical events before ordinary queued events", () => {
  const { c } = make();
  c.command(
    "totem.notify",
    { source: "build", title: "Done", severity: "attention" },
    "adapter",
  );
  const critical = c.command(
    "totem.notify",
    { source: "system", title: "Failed", severity: "critical" },
    "system",
  );
  assert.equal(c.nextDelivery().id, critical.id);
});

test("requested context is available during focus and quiet hours without proactive echo", () => {
  const c = new Companion(undefined, () => new Date(2026, 0, 1, 23).getTime());
  c.command("totem.focus", { minutes: 25 });
  c.command("totem.notify", { title: "Ordinary" }, "muse");
  assert.equal(c.snapshot().card, null);
  const card = c.command(
    "totem.show_card",
    { title: "Requested next action" },
    "muse",
  );
  assert.equal(c.snapshot().card.id, card.id);
  assert.equal(c.state.outbox.length, 0);
});
test("break completion has the correct prompt and a stable completion key", () => {
  const { c, advance } = make();
  c.command("totem.focus", { minutes: 1, kind: "break" });
  const until = c.state.focus.until;
  advance(61000);
  c.tick();
  const notice = c.state.events.find((e) => e.source === "timer");
  assert.equal(notice.title, "Ready to focus");
  assert.equal(notice.dedupeKey, `timer-${until}-break`);
  const restored = new Companion(JSON.parse(JSON.stringify(c.state)), c.clock);
  assert.equal(
    restored.state.events.filter((e) => e.source === "timer").length,
    1,
  );
});

test("a noisy source cannot block its later critical alert with ordinary events", () => {
  const { c } = make();
  const first = c.event(
    { source: "jobs", title: "Routine", dedupeKey: "routine-0" },
    "local-event",
  );
  for (let i = 1; i < 16; i++)
    c.event(
      { source: "jobs", title: "Routine", dedupeKey: `routine-${i}` },
      "local-event",
    );
  const critical = c.event(
    {
      source: "jobs",
      title: "Failure",
      severity: "critical",
      dedupeKey: "failure",
    },
    "local-event",
  );
  assert.equal(critical.ok, true);
  assert.equal(critical.proactiveQueued, true);
  assert.equal(c.state.events.length, 16);
  assert.ok(!c.state.events.some((e) => e.id === first.id));
  assert.ok(!c.state.outbox.some((e) => e.id === first.id));
  assert.equal(
    c.event(
      { source: "jobs", title: "Routine", dedupeKey: "routine-0" },
      "local-event",
    ).deduplicated,
    true,
  );
});
test("offline transport queue bounds each source and reserves admission for higher priority", () => {
  const { c, advance } = make();
  for (let i = 0; i < 17; i++) {
    c.event(
      {
        source: "jobs",
        title: "Routine",
        dedupeKey: `offline-${i}`,
        ttlSeconds: 3,
      },
      "local-event",
    );
    advance(4000);
    c.tick();
  }
  assert.equal(c.state.outbox.length, 16);
  const critical = c.event(
    {
      source: "jobs",
      title: "Failure",
      severity: "critical",
      dedupeKey: "urgent-offline",
    },
    "local-event",
  );
  assert.equal(critical.proactiveQueued, true);
  assert.equal(c.state.outbox.length, 16);
  assert.equal(c.nextDelivery().id, critical.id);
});

test("acknowledgement during an in-flight send cannot erase delivery rate accounting", () => {
  const { c } = make();
  const result = c.event(
    { source: "jobs", title: "Finished", dedupeKey: "inflight" },
    "local-event",
  );
  const sending = c.nextDelivery();
  assert.equal(sending.id, result.id);
  c.command("totem.dismiss", { id: result.id }, "muse");
  c.delivered(sending.id, sending.source);
  assert.equal(c.state.deliveries.length, 1);
  assert.equal(c.state.deliveries[0].source, "jobs");
});

test("legacy offline backlog adopts per-source limits while retaining critical delivery", () => {
  const { c } = make();
  const critical = c.event(
    {
      source: "jobs",
      title: "Critical",
      severity: "critical",
      dedupeKey: "legacy-critical",
    },
    "local-event",
  );
  const saved = JSON.parse(JSON.stringify(c.state));
  const template = saved.outbox[0];
  for (let i = 0; i < 32; i++)
    saved.outbox.push({
      ...template,
      id: `legacy-${i}`,
      dedupeKey: `legacy-${i}`,
      severity: "attention",
    });
  const restored = new Companion(saved, c.clock);
  assert.equal(restored.state.outbox.length, 16);
  assert.ok(restored.state.outbox.some((e) => e.id === critical.id));
});

test("equal-priority alerts rotate sources after acknowledgement and survive reload", () => {
  const { c } = make();
  for (const source of ["jobs", "jobs", "jobs", "calendar", "github"])
    c.command("totem.notify", { title: source, severity: "urgent" }, source);
  const first = c.snapshot().card;
  assert.equal(first.source, "jobs");
  c.command("totem.dismiss", { id: first.id });
  const restored = new Companion(JSON.parse(JSON.stringify(c.state)), c.clock);
  assert.equal(restored.snapshot().card.source, "calendar");
  restored.command("totem.dismiss", { id: restored.snapshot().card.id });
  assert.equal(restored.snapshot().card.source, "github");
  restored.command("totem.dismiss", { id: restored.snapshot().card.id });
  assert.equal(restored.snapshot().card.source, "jobs");
  const critical = restored.command(
    "totem.notify",
    { title: "Critical", severity: "critical" },
    "jobs",
  );
  assert.equal(restored.snapshot().card.id, critical.id);
});
