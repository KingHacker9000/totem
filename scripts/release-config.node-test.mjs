import assert from "node:assert/strict";
import test from "node:test";
import {
  checkContract,
  loadContract,
  parseEnvFile,
  validateEnvironment,
} from "./release-config.mjs";

test("release configuration contract covers production references and safe Pi defaults", async () => {
  const result = await checkContract();
  assert.equal(result.schema, "totem.release-config/v1");
  assert.equal(result.credential_free_example, "PASS");
  assert.ok(result.declared >= result.referenced);
});

test("credential-free core defaults require no secret", async () => {
  const contract = await loadContract();
  assert.equal(contract.credential_free, true);
  assert.equal(
    contract.variables.some(
      (entry) => entry.secret && entry.class === "required",
    ),
    false,
  );
  assert.deepEqual(validateEnvironment(contract, {}), []);
});

test("unknown Totem variables fail closed", async () => {
  const contract = await loadContract();
  const issues = validateEnvironment(contract, {
    TOTEM_UNDOCUMENTED_SWITCH: "1",
  });
  assert.match(issues.join("\n"), /unknown TOTEM_ variable/);
});

test("malformed critical values are rejected deterministically", async () => {
  const contract = await loadContract();
  const issues = validateEnvironment(contract, {
    TOTEM_PORT: "70000",
    TOTEM_ENV: "prod",
    TOTEM_SPEECH_VAD_THRESHOLD: "2",
    TOTEM_RELEASE_RETENTION: "0",
    TOTEM_BASE_URL: "not a url",
  });
  assert.equal(issues.length, 5);
});

test("env-file parser keeps credential values opaque", () => {
  assert.deepEqual(
    parseEnvFile("# comment\nTOTEM_ENV=production\nSERVICE_TOKEN='secret-placeholder'\n"),
    { TOTEM_ENV: "production", SERVICE_TOKEN: "secret-placeholder" },
  );
});
