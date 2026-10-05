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
