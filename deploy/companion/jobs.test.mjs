import assert from "node:assert/strict";
import { test } from "node:test";
import { jobUnits, observeJobs } from "./jobs.mjs";
import { Companion } from "./state.mjs";

const base = {
  Id: "academic-ops-sync.service",
  Type: "oneshot",
  LoadState: "loaded",
  ActiveState: "inactive",
  Result: "success",
  ExecMainStatus: "0",
  ExecMainStartTimestampMonotonic: "90",
  ExecMainExitTimestampMonotonic: "100",
};
test("read-only job observation skips baseline, ignores active runs and deduplicates completion across restart", () => {
  const c = new Companion();
  observeJobs(c, [base], "boot-1");
  assert.equal(c.state.events.length, 0);
  observeJobs(
    c,
    [
      {
        ...base,
        ActiveState: "active",
        ExecMainStartTimestampMonotonic: "110",
      },
    ],
    "boot-1",
  );
  assert.equal(c.state.events.length, 0);
  observeJobs(
    c,
    [
      {
        ...base,
        ExecMainStartTimestampMonotonic: "110",
        ExecMainExitTimestampMonotonic: "120",
      },
    ],
    "boot-1",
  );
  assert.equal(c.state.events[0].severity, "info");
  assert.equal(c.state.outbox.length, 0);
  const restored = new Companion(JSON.parse(JSON.stringify(c.state)), c.clock);
  observeJobs(
    restored,
    [
      {
        ...base,
        ExecMainStartTimestampMonotonic: "110",
        ExecMainExitTimestampMonotonic: "120",
      },
    ],
    "boot-1",
  );
  assert.equal(restored.state.events.length, 1);
  observeJobs(restored, [base], "boot-2");
  assert.equal(restored.state.events.length, 1);
});
test("job failure and later recovery feed the shared notification/outbox contract", () => {
  const c = new Companion();
  observeJobs(c, [base], "boot-1");
  observeJobs(
    c,
    [
      {
        ...base,
        ActiveState: "failed",
        Result: "exit-code",
        ExecMainStatus: "1",
        ExecMainExitTimestampMonotonic: "120",
      },
    ],
    "boot-1",
  );
  assert.equal(c.state.outbox[0].severity, "urgent");
  observeJobs(
    c,
    [
      {
        ...base,
        ExecMainStartTimestampMonotonic: "130",
        ExecMainExitTimestampMonotonic: "140",
      },
    ],
    "boot-1",
  );
  assert.equal(c.state.outbox[1].type, "job.recovered");
  assert.deepEqual(
    jobUnits("academic-ops-sync.service,academic-ops-sync.service"),
    [base.Id],
  );
  for (const invalid of ["--all", "a.service;id", "../a.service"])
    assert.throws(() => jobUnits(invalid));
});

test("already failed monitored jobs are surfaced once at startup", () => {
  const c = new Companion();
  const failed = {
    ...base,
    ActiveState: "failed",
    Result: "exit-code",
    ExecMainStatus: "1",
  };
  observeJobs(c, [failed], "boot-1");
  observeJobs(c, [failed], "boot-1");
  assert.equal(c.state.events.length, 1);
  assert.equal(c.state.outbox[0].severity, "urgent");
});
