import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCheckoutIdentity,
  assertExactRevision,
  resolvePinnedEntries,
} from "./pinned-repository-checkout.mjs";

const exactRevision = "0123456789abcdef0123456789abcdef01234567";

test("accepts exact lowercase 40-character revisions", () => {
  assert.equal(assertExactRevision("KingHacker9000/example", exactRevision), exactRevision);
});

test("rejects missing or non-exact revisions", () => {
  assert.throws(
    () => assertExactRevision("KingHacker9000/example", undefined),
    /exact 40-character lowercase commit revision/,
  );
  assert.throws(
    () => assertExactRevision("KingHacker9000/example", exactRevision.toUpperCase()),
    /exact 40-character lowercase commit revision/,
  );
  assert.throws(
    () => assertExactRevision("KingHacker9000/example", "main"),
    /exact 40-character lowercase commit revision/,
  );
});

test("rejects requested repositories absent from the declared input set", () => {
  assert.throws(
    () => resolvePinnedEntries({ repositories: [] }, ["KingHacker9000/missing"]),
    /not declared in repo-family validation/,
  );
});

test("rejects mismatched checked-out HEAD identity", () => {
  assert.throws(
    () =>
      assertCheckoutIdentity(
        "KingHacker9000/example",
        exactRevision,
        "89abcdef0123456789abcdef0123456789abcdef",
      ),
    /checkout identity mismatch/,
  );
});
