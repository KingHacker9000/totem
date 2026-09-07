import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowPermissions } from "./workflow-permissions.mjs";

test("accepts explicit contents read and rejects missing permissions", () => {
  const accepted = inspectWorkflowPermissions(
    `name: CI\non:\n  push:\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
  );
  assert.deepEqual(accepted.failures, []);
  assert.deepEqual(accepted.permissions, { contents: "read" });

  const missing = inspectWorkflowPermissions(
    `name: CI\non:\n  push:\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
  );
  assert.equal(missing.failures.length, 1);
  assert.match(missing.failures[0], /missing top-level permissions/);
});

test("rejects write access and unexpected scopes", () => {
  const result = inspectWorkflowPermissions(
    `name: CI\non:\n  push:\npermissions:\n  contents: write\n  actions: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
  );
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.some((failure) => /contents: write/.test(failure)));
  assert.ok(
    result.failures.some((failure) => /scope actions: read/.test(failure)),
  );
});

test("rejects ambiguous syntax and duplicate declarations", () => {
  const ambiguous = inspectWorkflowPermissions(
    `name: CI\non:\n  push:\npermissions: read-all\njobs:\n  check:\n    runs-on: ubuntu-latest\n`,
  );
  assert.match(ambiguous.failures[0], /missing top-level permissions/);

  const duplicate = inspectWorkflowPermissions(
    `permissions:\n  contents: read\npermissions:\n  contents: read\n`,
  );
  assert.ok(
    duplicate.failures.some((failure) => /duplicate top-level/.test(failure)),
  );
});
