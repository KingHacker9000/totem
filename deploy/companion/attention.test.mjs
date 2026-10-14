import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attentionPath,
  normalizeAttention,
  sourceReference,
} from "./attention.mjs";

test("normalizes distinct adapters into the same semantic event contract", () => {
  for (const source of ["academic", "github", "swinglab"]) {
    const record = {
      connectorId: source,
      id: `${source}:test`,
      severity: "error",
      title: "Attention",
      body: "Detail",
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    };
    const event = normalizeAttention(record);
    assert.equal(event.source, source);
    assert.equal(event.severity, "urgent");
    assert.ok(event.ttlSeconds > 3 && event.ttlSeconds <= 30);
    assert.equal(
      attentionPath(sourceReference(record)),
      `/desk/attention/${source}/${source}%3Atest`,
    );
  }
});
test("rejects invalid expiry and path references before connector control", () => {
  assert.throws(() => normalizeAttention({ expiresAt: "broken" }));
  for (const reference of [
    { connectorId: "../system", id: "x" },
    { connectorId: "github", id: "/etc/passwd" },
    { connectorId: 42, id: "x" },
  ])
    assert.throws(() => sourceReference(reference));
});
