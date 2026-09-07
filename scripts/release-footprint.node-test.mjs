import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFootprint,
  validateBudget,
} from "./release-footprint.mjs";

const baseBudget = {
  schema: "totem.release-footprint-budget/v1",
  maxTotalBytes: 1000,
  maxFileCount: 3,
  maxFileBytes: 500,
  topContributors: 2,
  exceptions: [],
};

test("passes and reports deterministic largest contributors", () => {
  const result = evaluateFootprint(
    [
      { path: "b.txt", bytes: 200 },
      { path: "a.txt", bytes: 200 },
      { path: "small.txt", bytes: 5 },
    ],
    validateBudget(baseBudget),
  );
  assert.equal(result.totalBytes, 405);
  assert.equal(result.fileCount, 3);
  assert.equal(result.largestFilePath, "a.txt");
  assert.deepEqual(result.topFiles, [
    { path: "a.txt", bytes: 200 },
    { path: "b.txt", bytes: 200 },
  ]);
  assert.deepEqual(result.violations, []);
});

test("fails total, file-count and unexpected large-file regressions", () => {
  const result = evaluateFootprint(
    [
      { path: "huge.bin", bytes: 700 },
      { path: "a", bytes: 200 },
      { path: "b", bytes: 200 },
      { path: "c", bytes: 1 },
    ],
    validateBudget(baseBudget),
  );
  assert.equal(result.violations.length, 3);
  assert.match(result.violations.join("\n"), /total bytes/);
  assert.match(result.violations.join("\n"), /file count/);
  assert.match(result.violations.join("\n"), /huge\.bin/);
});

test("allows only exact bounded exceptions and rejects stale exception drift", () => {
  const budget = validateBudget({
    ...baseBudget,
    exceptions: [
      {
        path: "assets/model.bin",
        maxBytes: 800,
        reason: "Required runtime model payload",
      },
    ],
  });
  assert.deepEqual(
    evaluateFootprint([{ path: "assets/model.bin", bytes: 700 }], budget)
      .violations,
    [],
  );
  assert.match(
    evaluateFootprint([{ path: "assets/other.bin", bytes: 100 }], budget)
      .violations[0],
    /stale or absent/,
  );
});

test("rejects wildcard, traversal, duplicate and unjustified exceptions", () => {
  for (const exceptions of [
    [
      {
        path: "assets/*",
        maxBytes: 800,
        reason: "Required runtime model payload",
      },
    ],
    [
      {
        path: "../asset",
        maxBytes: 800,
        reason: "Required runtime model payload",
      },
    ],
    [
      {
        path: "asset",
        maxBytes: 800,
        reason: "Required runtime model payload",
      },
      {
        path: "asset",
        maxBytes: 900,
        reason: "Second duplicate allowance",
      },
    ],
    [{ path: "asset", maxBytes: 800, reason: "too short" }],
  ]) {
    assert.throws(() => validateBudget({ ...baseBudget, exceptions }));
  }
});
