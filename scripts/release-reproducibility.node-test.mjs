import assert from "node:assert/strict";
import test from "node:test";
import { assertReproducibleManifests } from "./release-reproducibility.mjs";

function fixture() {
  return {
    schema: "totem.public-release-bundle/v1",
    repository: "KingHacker9000/totem",
    source: { revision: "abc", tree: "def" },
    policy: { trackedFilesOnly: true },
    files: [
      {
        path: "README.md",
        mode: "100644",
        bytes: 12,
        sha256: "1".repeat(64),
      },
    ],
    digest: { algorithm: "sha256", value: "2".repeat(64) },
  };
}

test("identical manifests pass", () => {
  const left = fixture();
  const right = structuredClone(left);
  assert.doesNotThrow(() => assertReproducibleManifests(left, right));
});

test("representative environment-sensitive drift has a deterministic diagnostic", () => {
  const left = fixture();
  const right = structuredClone(left);
  right.files[0].sha256 = "3".repeat(64);
  assert.throws(
    () => assertReproducibleManifests(left, right),
    /release bundle reproducibility drift: \$\.files\[0\]\.sha256/,
  );
});

test("file-set drift reports the stable length path", () => {
  const left = fixture();
  const right = structuredClone(left);
  right.files.push({
    path: "docs/extra.md",
    mode: "100644",
    bytes: 1,
    sha256: "4".repeat(64),
  });
  assert.throws(
    () => assertReproducibleManifests(left, right),
    /release bundle reproducibility drift: \$\.files\.length/,
  );
});
