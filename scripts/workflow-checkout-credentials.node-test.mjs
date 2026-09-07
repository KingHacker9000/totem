import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowCheckoutCredentials } from "./workflow-checkout-credentials.mjs";

test("accepts checkout with explicitly disabled credential persistence", () => {
  const result = inspectWorkflowCheckoutCredentials(
    `name: CI\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789 # v4\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n      - run: echo ok\n`,
  );
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(result.entries[0].persistCredentials, "false");
});

test("rejects default credential persistence", () => {
  const result = inspectWorkflowCheckoutCredentials(
    `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n      - run: echo unsafe\n`,
    ".github/workflows/ci.yml",
  );
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /must explicitly set persist-credentials: false/);
});

test("rejects true or expression-valued credential persistence", () => {
  for (const value of ["true", "${{ github.event_name == 'push' }}"]) {
    const result = inspectWorkflowCheckoutCredentials(
      `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n        with:\n          persist-credentials: ${value}\n`,
    );
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /persist-credentials must be false/);
  }
});

test("validates each checkout independently and rejects duplicates", () => {
  const result = inspectWorkflowCheckoutCredentials(
    `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n        with:\n          persist-credentials: false\n          persist-credentials: false\n      - uses: actions/checkout@abcdefabcdefabcdefabcdefabcdefabcdefabcd\n        with:\n          persist-credentials: false\n`,
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /duplicate actions\/checkout persist-credentials/);
});
