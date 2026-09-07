import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortablePathSet,
  assertPortableReleasePath,
  portablePathKey,
} from "./release-portable-path.mjs";

test("accepts current-style portable release paths", () => {
  assert.equal(
    assertPortableReleasePath("scripts/release-bundle.mjs"),
    "scripts/release-bundle.mjs",
  );
  assert.equal(portablePathKey("Docs/Readme.md"), "docs/readme.md");
});

test("rejects case-fold collisions", () => {
  assert.throws(
    () => assertPortablePathSet(["docs/README.md", "docs/readme.md"]),
    /case-fold collision: docs\/README\.md <-> docs\/readme\.md/,
  );
});

test("rejects Windows reserved device names including extensions", () => {
  for (const path of ["CON", "docs/aux.txt", "config/COM1.json", "Lpt9.md"]) {
    assert.throws(
      () => assertPortableReleasePath(path),
      /Windows-reserved device name/,
    );
  }
});

test("rejects trailing dots/spaces and Windows-invalid characters", () => {
  for (const path of [
    "docs/name. ",
    "docs/name.",
    "docs/bad:name.md",
    "docs/bad?.md",
  ]) {
    assert.throws(() => assertPortableReleasePath(path));
  }
});

test("rejects unsafe component structure and backslashes", () => {
  for (const path of [
    "../secret",
    "docs/../secret",
    "docs\\file.md",
    "/abs/path",
  ]) {
    assert.throws(() => assertPortableReleasePath(path));
  }
});
