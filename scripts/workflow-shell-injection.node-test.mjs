import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectWorkflowShellExpressions,
  validateRepository,
} from "./workflow-shell-injection.mjs";

test("rejects attacker-influenced expressions interpolated into run scripts", () => {
  const workflow = `name: unsafe
on:
  pull_request:
  workflow_dispatch:
    inputs:
      target:
        required: true
        type: string
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ github.event.pull_request.title }}"
      - run: |
          echo "\${{ github.head_ref }}"
          deploy "\${{ inputs.target }}"
`;
  const result = inspectWorkflowShellExpressions(workflow, ".github/workflows/unsafe.yml");
  assert.equal(result.failures.length, 3);
  assert.match(result.failures[0], /github\.event\.pull_request\.title/);
  assert.match(result.failures[1], /github\.head_ref/);
  assert.match(result.failures[2], /inputs\.target/);
});

test("allows safe data-channel usage and non-attacker expressions", () => {
  const workflow = `name: safe
on:
  pull_request:
jobs:
  test:
    strategy:
      matrix:
        node: [22.20.0]
    runs-on: ubuntu-latest
    steps:
      - name: Safe PR title
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: printf '%s\\n' "$PR_TITLE"
      - run: echo "\${{ github.sha }}"
      - run: node --version \${{ matrix.node }}
`;
  const result = inspectWorkflowShellExpressions(workflow, ".github/workflows/safe.yml");
  assert.deepEqual(result.failures, []);
  assert.equal(result.runBlocks, 3);
  assert.equal(result.expressions, 2);
});

test("scans every workflow in a repository and reports deterministic paths", () => {
  const root = mkdtempSync(join(tmpdir(), "totem-workflow-shell-"));
  try {
    const workflows = join(root, ".github", "workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      join(workflows, "ci.yml"),
      "name: ci\non: [pull_request]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo '${{ github.ref_name }}'\n",
    );
    writeFileSync(
      join(workflows, "safe.yaml"),
      "name: safe\non: [push]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
    );

    const result = validateRepository(root);
    assert.equal(result.workflows, 2);
    assert.equal(result.run_blocks, 2);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /^\.github[/\\]workflows[/\\]ci\.yml:7:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
