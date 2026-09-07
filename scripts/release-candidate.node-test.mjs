import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCandidateMatches,
  buildCandidateDocument,
  validateCandidateDocument,
} from "./release-candidate.mjs";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const integrityDocument = {
  schema: "totem.release-integrity/v1",
  algorithm: "sha256",
  repository: "KingHacker9000/totem",
  source: { revision: "abc123", tree: "def456" },
  releaseBundleDigest: DIGEST_A,
  files: [{ path: "package.json", bytes: 2, sha256: DIGEST_B }],
};
const integrityBytes = Buffer.from(
  '{"schema":"totem.release-integrity/v1"}\n',
);
const archiveBytes = Buffer.from("archive bytes\n");

function candidate() {
  return buildCandidateDocument({
    integrityDocument,
    integrityBytes,
    integrityName: "totem-public.integrity.json",
    archiveBytes,
    archiveName: "totem-public.tar.gz",
  });
}

test(
  "buildCandidateDocument deterministically binds source, integrity, and archive bytes",
  () => {
    const first = candidate();
    const second = candidate();
    assert.deepEqual(first, second);
    assert.equal(first.schema, "totem.release-candidate/v1");
    assert.equal(first.algorithm, "sha256");
    assert.equal(first.repository, "KingHacker9000/totem");
    assert.deepEqual(first.source, { revision: "abc123", tree: "def456" });
    assert.equal(first.releaseBundleDigest, DIGEST_A);
    assert.equal(first.integrity.bytes, integrityBytes.length);
    assert.equal(first.archive.bytes, archiveBytes.length);
    assert.match(first.integrity.sha256, /^[0-9a-f]{64}$/);
    assert.match(first.archive.sha256, /^[0-9a-f]{64}$/);
  },
);

test("assertCandidateMatches rejects tampered archive bytes", () => {
  assert.throws(
    () =>
      assertCandidateMatches({
        candidate: candidate(),
        integrityDocument,
        integrityBytes,
        integrityName: "totem-public.integrity.json",
        archiveBytes: Buffer.from("tampered archive\n"),
        archiveName: "totem-public.tar.gz",
      }),
    /does not match the verified release artifacts/,
  );
});

test("assertCandidateMatches rejects mismatched integrity identity", () => {
  const changedIntegrity = {
    ...integrityDocument,
    source: { revision: "different", tree: "def456" },
  };
  assert.throws(
    () =>
      assertCandidateMatches({
        candidate: candidate(),
        integrityDocument: changedIntegrity,
        integrityBytes,
        integrityName: "totem-public.integrity.json",
        archiveBytes,
        archiveName: "totem-public.tar.gz",
      }),
    /does not match the verified release artifacts/,
  );
});

test("validateCandidateDocument rejects malformed digests and unsafe names", () => {
  assert.throws(
    () =>
      validateCandidateDocument({
        ...candidate(),
        archive: { ...candidate().archive, sha256: "not-a-digest" },
      }),
    /archive digest must be a lowercase sha256 digest/,
  );
  assert.throws(
    () =>
      validateCandidateDocument({
        ...candidate(),
        integrity: { ...candidate().integrity, name: "../integrity.json" },
      }),
    /integrity metadata name must be a plain file name/,
  );
});
