import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveryMessage,
  deliveryStatus,
  reconnectOutbox,
} from "./muse-delivery.mjs";
test("proactive alerts target the paired main chat and preserve remote acknowledgement ID", () => {
  const packet = deliveryMessage({
    id: "alert-42",
    title: "Job done",
    detail: "Ready",
    severity: "attention",
    source: "jobs",
  });
  assert.equal(packet.session_id, undefined);
  assert.match(packet.message, /Alert ID: alert-42/);
  assert.match(packet.message, /totem.dismiss/);
});
test("delivery diagnostics report rejection without exposing the response body", () => {
  const status = deliveryStatus(
    {
      ok: false,
      status: 400,
      response: {
        error: { code: "invalid_params", message: "private detail" },
      },
    },
    123,
  );
  assert.deepEqual(status, {
    status: "failed",
    at: 123,
    httpStatus: 400,
    code: "invalid_params",
  });
  assert.equal(deliveryStatus({ ok: true, status: 200 }).status, "accepted");
});

test("reconnect retries queued alerts promptly without resetting rate or attempt accounting", () => {
  const event = { nextAttempt: 900, attempts: 9 };
  reconnectOutbox([event], false, true, 100);
  assert.deepEqual(event, { nextAttempt: 100, attempts: 9 });
  event.nextAttempt = 900;
  reconnectOutbox([event], true, true, 100);
  assert.equal(event.nextAttempt, 900);
  reconnectOutbox([event], false, false, 100);
  assert.equal(event.nextAttempt, 900);
});
