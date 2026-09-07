import assert from "node:assert/strict";
import test from "node:test";
import { waitForCoreReady } from "./readiness.mjs";

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

test("waitForCoreReady tolerates delayed startup", async () => {
  let clock = 0;
  let attempts = 0;
  const result = await waitForCoreReady({
    baseUrl: "http://totem.test",
    timeoutMs: 1_000,
    initialDelayMs: 100,
    maxDelayMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchImpl: async () => {
      attempts += 1;
      return response(attempts < 3 ? 503 : 200, attempts < 3 ? "starting" : "ok");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.elapsedMs, 200);
});

test("waitForCoreReady fails closed after bounded timeout", async () => {
  let clock = 0;
  const result = await waitForCoreReady({
    baseUrl: "http://totem.test",
    timeoutMs: 250,
    initialDelayMs: 100,
    maxDelayMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchImpl: async () => response(503, "not ready"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.elapsedMs, 250);
  assert.equal(result.last?.status, 503);
});

test("waitForCoreReady treats connection failures as retryable until timeout", async () => {
  let clock = 0;
  let attempts = 0;
  const result = await waitForCoreReady({
    baseUrl: "http://totem.test",
    timeoutMs: 500,
    initialDelayMs: 50,
    maxDelayMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("ECONNREFUSED");
      return response(200, "ok");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.last?.status, 200);
});
