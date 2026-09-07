import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoKnownSecretValues,
  buildSupportBundle,
  redactString,
} from "./support-diagnostics.mjs";

test("support bundle exposes configuration shape but never environment values", async () => {
  const env = {
    TOTEM_PORT: "port-secret-fixture-39991",
    TOTEM_DATA_DIR: "/private/user-state",
    OPENAI_API_KEY: "sk-test-super-secret-value-123456789",
    GITHUB_TOKEN: "github_pat_super_secret_fixture_123456789",
    TOTEM_UNKNOWN_PRIVATE_SECRET: "fixture-secret-value",
  };
  const bundle = await buildSupportBundle({
    env,
    baseUrl: "http://127.0.0.1:9",
  });
  const serialized = JSON.stringify(bundle);

  assert.equal(bundle.schema, "totem.support-diagnostics/v1");
  assert.equal(bundle.privacy.environment_values_included, false);
  assert.equal(bundle.privacy.logs_included, false);
  assert.equal(bundle.privacy.durable_user_state_included, false);
  assert.equal(bundle.configuration.values_included, false);
  assert.equal(bundle.configuration.unknown_totem_variable_count, 1);
  assert.ok(bundle.configuration.ambient_sensitive_variable_count >= 2);
  assert.ok(!serialized.includes("port-secret-fixture-39991"));
  assert.ok(!serialized.includes("/private/user-state"));
  assert.ok(!serialized.includes("sk-test-super-secret-value-123456789"));
  assert.ok(!serialized.includes("github_pat_super_secret_fixture_123456789"));
  assert.ok(!serialized.includes("fixture-secret-value"));
  assert.doesNotThrow(() => assertNoKnownSecretValues(bundle, env));
});

test("known secret leak guard fails closed", () => {
  const env = { PROVIDER_TOKEN: "secret-fixture-abcdef" };
  assert.throws(
    () => assertNoKnownSecretValues({ unsafe: env.PROVIDER_TOKEN }, env),
    /leaked sensitive environment values/,
  );
});

test("redaction removes token-shaped text from surfaced errors", () => {
  const text = redactString(
    "request failed bearer abcdefghijklmnopqrstuvwxyz012345 and github_pat_fixture_12345678901234567890",
  );
  assert.ok(!text.includes("abcdefghijklmnopqrstuvwxyz012345"));
  assert.ok(!text.includes("github_pat_fixture_12345678901234567890"));
  assert.match(text, /\[REDACTED\]/);
});
