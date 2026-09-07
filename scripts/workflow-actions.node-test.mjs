import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowText } from "./workflow-actions.mjs";

test("accepts immutable external action refs and ignores local/docker actions", () => {
  const result = inspectWorkflowText(`steps:\n  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n  - uses: ./local-action\n  - uses: docker://alpine:3.20\n`);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.failures, []);
});

test("rejects mutable tags and missing refs", () => {
  const result = inspectWorkflowText(`steps:\n  - uses: actions/setup-node@v4\n  - uses: owner/action\n`);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /mutable/);
  assert.match(result.failures[1], /missing an immutable ref/);
});
