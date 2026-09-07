import assert from "node:assert/strict";
import test from "node:test";
import { inspectReleaseWorkflowRuntime } from "./workflow-node-runtime.mjs";

const allowed = ["22.20.0", "24.18.0"];

function inspect(body) {
  return inspectReleaseWorkflowRuntime(body, allowed, "release-integrity.yml");
}

test("accepts allowed explicit setup-node runtimes", () => {
  const result = inspect(`jobs:
  integrity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@deadbeef
        with:
          node-version: 22.20.0
      - run: node scripts/release-integrity.mjs verify
  handoff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@deadbeef
        with:
          node-version: "24.18.0"
      - run: pnpm release:candidate:verify
`);
  assert.deepEqual(result.failures, []);
  assert.equal(result.jobs.length, 2);
});

test("rejects runner-default Node execution", () => {
  const result = inspect(`jobs:
  handoff:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/release-integrity.mjs verify
`);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /without actions\/setup-node/);
});

test("rejects Node outside the release toolchain contract", () => {
  const result = inspect(`jobs:
  handoff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@deadbeef
        with:
          node-version: 21.7.3
      - run: node scripts/release-integrity.mjs verify
`);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /not allowed by the release toolchain contract/);
});

test("rejects setup-node after repository JavaScript", () => {
  const result = inspect(`jobs:
  handoff:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/release-integrity.mjs verify
      - uses: actions/setup-node@deadbeef
        with:
          node-version: 22.20.0
`);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /before actions\/setup-node/);
});

test("rejects setup-node without node-version", () => {
  const result = inspect(`jobs:
  handoff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@deadbeef
      - run: node scripts/release-integrity.mjs verify
`);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /must declare node-version explicitly/);
});

test("ignores jobs without repository JavaScript", () => {
  const result = inspect(`jobs:
  upload-only:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@deadbeef
      - run: test -f dist/release.tar.gz
`);
  assert.deepEqual(result.failures, []);
  assert.equal(result.jobs.length, 0);
});
