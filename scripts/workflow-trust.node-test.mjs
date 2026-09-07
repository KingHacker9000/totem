import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowTrust } from "./workflow-trust.mjs";

test("accepts ordinary push and pull_request workflows", () => {
  const result = inspectWorkflowTrust(
    `name: CI\non:\n  push:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n`,
  );
  assert.deepEqual(result.events, ["push", "pull_request"]);
  assert.deepEqual(result.failures, []);
});

test("rejects privileged pull_request_target and workflow_run triggers", () => {
  for (const event of ["pull_request_target", "workflow_run", "issue_comment"]) {
    const result = inspectWorkflowTrust(
      `name: unsafe\non:\n  ${event}:\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
    );
    assert.ok(
      result.failures.some((failure) => failure.includes(`event ${event}`)),
    );
  }
});

test("rejects attacker-controlled checkout refs and inherited secrets", () => {
  const result = inspectWorkflowTrust(
    `name: unsafe\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  check:\n    secrets: inherit\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n`,
  );
  assert.ok(result.failures.some((failure) => /secrets: inherit/.test(failure)));
  assert.ok(result.failures.some((failure) => /attacker-controlled/.test(failure)));
});

test("rejects ambiguous inline triggers", () => {
  const result = inspectWorkflowTrust(
    `name: ambiguous\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
  );
  assert.ok(result.failures.some((failure) => /inline workflow triggers/.test(failure)));
});
