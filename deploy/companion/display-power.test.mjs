import assert from "node:assert/strict";
import { test } from "node:test";
import { setDisplayPower } from "./display-power.mjs";

test("screen power uses only fixed targets and rejects malformed requests", async () => {
  const calls = [];
  const recover = async (target) => calls.push(target);
  assert.deepEqual(await setDisplayPower({ sleep: true }, recover), {
    ok: true,
    sleeping: true,
  });
  assert.deepEqual(await setDisplayPower({ sleep: false }, recover), {
    ok: true,
    sleeping: false,
  });
  for (const args of [
    {},
    { sleep: "false" },
    { sleep: 0 },
    { sleep: true, command: "id" },
  ]) {
    await assert.rejects(setDisplayPower(args, recover));
  }
  assert.deepEqual(calls, ["screen:off", "screen:on"]);
});

test("screen power reports hardware failure", async () => {
  await assert.rejects(
    setDisplayPower({ sleep: true }, async () => {
      throw new Error("unavailable");
    }),
    /unavailable/,
  );
});
