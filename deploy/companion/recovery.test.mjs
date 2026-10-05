import assert from "node:assert/strict";
import { test } from "node:test";
import { displayRecoveryDecision, recordDisplayRecovery } from "./recovery.mjs";
import { Companion, initial } from "./state.mjs";

test("automatic display recovery requires opt-in, stale rendering and startup/cooldown grace", () => {
  const s = initial();
  const base = { enabled: true, now: 100000, started: 0, lastBeat: 0 };
  assert.equal(displayRecoveryDecision(s, { ...base, enabled: false }), "wait");
  assert.equal(displayRecoveryDecision(s, { ...base, started: 20000 }), "wait");
  assert.equal(
    displayRecoveryDecision(s, { ...base, lastBeat: 50000 }),
    "wait",
  );
  assert.equal(displayRecoveryDecision(s, base), "restart");
  recordDisplayRecovery(s, base.now);
  assert.equal(displayRecoveryDecision(s, { ...base, now: 150000 }), "wait");
});
test("two-per-hour display limit survives state reload and general audit eviction", () => {
  const base = { enabled: true, now: 100000, started: 0, lastBeat: 0 };
  let s = initial();
  displayRecoveryDecision(s, base);
  recordDisplayRecovery(s, 100000);
  s = JSON.parse(JSON.stringify(s));
  s.audit = [];
  assert.equal(displayRecoveryDecision(s, { ...base, now: 200000 }), "restart");
  recordDisplayRecovery(s, 200000);
  s.audit = [];
  assert.equal(
    displayRecoveryDecision(s, { ...base, now: 300000 }),
    "escalate",
  );
  assert.equal(
    displayRecoveryDecision(s, { ...base, now: 300000, lastBeat: 290000 }),
    "wait",
  );
  assert.equal(
    displayRecoveryDecision(s, { ...base, now: 3800000 }),
    "restart",
  );
});

test("legacy recovery audit migrates and corrupt counters cannot authorize recovery", () => {
  const legacy = initial();
  delete legacy.displayRecovery;
  legacy.audit = [
    { action: "auto-restart-display", at: 100000 },
    { action: "auto-restart-display", at: 200000 },
  ];
  const restored = new Companion(legacy, () => 300000);
  assert.equal(
    displayRecoveryDecision(restored.state, {
      enabled: true,
      now: 300000,
      started: 0,
      lastBeat: 0,
    }),
    "escalate",
  );
  const corrupt = initial();
  corrupt.displayRecovery.attempts = ["invalid"];
  assert.throws(() => new Companion(corrupt), /invalid display recovery state/);
});
