import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeTagRef,
  verifyPublicationIdentity,
} from "./release-publication.mjs";

const DIGEST = "a".repeat(64);

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "totem-release-publication-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Totem Test");
  git(root, "config", "user.email", "totem-test@example.invalid");
  writeFileSync(join(root, "payload.txt"), "first\n");
  git(root, "add", "payload.txt");
  git(root, "commit", "-q", "-m", "first");
  return root;
}

function sourceIdentity(root) {
  return {
    revision: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
  };
}

function candidateFor(root, overrides = {}) {
  const source = sourceIdentity(root);
  const candidate = {
    schema: "totem.release-candidate/v1",
    algorithm: "sha256",
    repository: "KingHacker9000/totem",
    source,
    releaseBundleDigest: DIGEST,
    integrity: {
      name: "totem-public.integrity.json",
      bytes: 42,
      sha256: DIGEST,
    },
    archive: {
      name: "totem-public.tar.gz",
      bytes: 84,
      sha256: DIGEST,
    },
    ...overrides,
  };
  const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  return { candidate, bytes };
}

function verify(root, releaseRef, overrides = {}) {
  const { candidate, bytes } = candidateFor(root, overrides);
  return verifyPublicationIdentity({
    candidate,
    candidateBytes: bytes,
    releaseRef,
    root,
  });
}

test("accepts lightweight and annotated tags bound to the candidate commit", () => {
  const root = createRepository();
  git(root, "tag", "v1.0.0");
  git(root, "tag", "-a", "v1.0.1", "-m", "release");

  const lightweight = verify(root, "v1.0.0");
  const annotated = verify(root, "refs/tags/v1.0.1");

  assert.equal(lightweight.releaseRef, "refs/tags/v1.0.0");
  assert.equal(lightweight.source.revision, sourceIdentity(root).revision);
  assert.equal(annotated.source.revision, sourceIdentity(root).revision);
  assert.notEqual(annotated.refObject, annotated.source.revision);
});

test("rejects moving branch refs and malformed tag names", () => {
  assert.throws(() => normalizeTagRef("refs/heads/main"), /moving branch refs/);
  assert.throws(() => normalizeTagRef("bad..tag"), /tag name is invalid/);
});

test("rejects missing tags", () => {
  const root = createRepository();
  assert.throws(
    () => verify(root, "v-missing"),
    /does not resolve to a commit/,
  );
});

test("rejects a tag that resolves to a different commit than the candidate", () => {
  const root = createRepository();
  git(root, "tag", "v-old");
  writeFileSync(join(root, "payload.txt"), "second\n");
  git(root, "add", "payload.txt");
  git(root, "commit", "-q", "-m", "second");

  assert.throws(
    () => verify(root, "v-old"),
    /does not match candidate source revision/,
  );
});

test("rejects a tag whose object cannot peel to a commit", () => {
  const root = createRepository();
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  git(root, "tag", "tree-tag", tree);

  assert.throws(() => verify(root, "tree-tag"), /does not resolve to a commit/);
});

test("rejects candidate tree identity that does not match its source commit", () => {
  const root = createRepository();
  git(root, "tag", "v1.0.0");
  const source = sourceIdentity(root);

  assert.throws(
    () =>
      verify(root, "v1.0.0", {
        source: { revision: source.revision, tree: "0".repeat(40) },
      }),
    /does not match commit tree/,
  );
});
