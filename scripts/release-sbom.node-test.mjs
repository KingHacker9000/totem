import assert from "node:assert/strict";
import test from "node:test";

import { assertSbomMatches, buildCycloneDx } from "./release-sbom.mjs";

function fixtures() {
  const bundleManifest = {
    schema: "totem.public-release-bundle/v1",
    repository: "KingHacker9000/totem",
    source: {
      revision: "0123456789abcdef0123456789abcdef01234567",
      tree: "a".repeat(64),
    },
    digest: { algorithm: "sha256", value: "b".repeat(64) },
  };
  const thirdPartyManifest = {
    schema: "totem.third-party-release-manifest/v1",
    source: {
      repository: "KingHacker9000/totem",
      revision: bundleManifest.source.revision,
      lockfileSha256: "c".repeat(64),
    },
    dependencies: {
      runtimeOrBundledCandidates: [
        {
          name: "zod",
          version: "4.1.5",
          identity: "zod@4.1.5",
          directSpec: "4.1.5",
        },
        {
          name: "@fastify/cors",
          version: "11.1.0",
          identity: "@fastify/cors@11.1.0",
          directSpec: null,
        },
      ],
      buildOrDevelopmentOnly: [
        {
          name: "typescript",
          version: "5.9.3",
          identity: "typescript@5.9.3",
          directSpec: "5.9.3",
        },
      ],
    },
    boundaries: {
      publicReleaseOnly: true,
      excludedPrivateRepositories: [
        "KingHacker9000/totem-portal-theme",
        "KingHacker9000/totem-portal-hardware",
      ],
    },
  };
  return { bundleManifest, thirdPartyManifest };
}

test("buildCycloneDx emits deterministic runtime-only CycloneDX 1.6", () => {
  const input = fixtures();
  const first = buildCycloneDx(input);
  const second = buildCycloneDx(input);

  assert.deepEqual(first, second);
  assert.equal(first.bomFormat, "CycloneDX");
  assert.equal(first.specVersion, "1.6");
  assert.equal(first.components.length, 2);
  assert.deepEqual(
    first.components.map((component) => component.name),
    ["@fastify/cors", "zod"],
  );
  assert.equal(
    first.components.some((component) => component.name === "typescript"),
    false,
  );
  assert.equal(first.components[0].purl, "pkg:npm/%40fastify/cors@11.1.0");
  assert.equal(
    first.metadata.component.version,
    input.bundleManifest.source.revision,
  );
  assert.equal(
    first.metadata.component.properties.some(
      (entry) =>
        entry.name === "totem:release-bundle-sha256" &&
        entry.value === "b".repeat(64),
    ),
    true,
  );
});

test("buildCycloneDx rejects source revision drift", () => {
  const input = fixtures();
  input.thirdPartyManifest.source.revision = "f".repeat(40);
  assert.throws(() => buildCycloneDx(input), /source revision differs/i);
});

test("buildCycloneDx rejects missing public/private release boundary", () => {
  const input = fixtures();
  input.thirdPartyManifest.boundaries.excludedPrivateRepositories = [];
  assert.throws(
    () => buildCycloneDx(input),
    /private Portal exclusion boundary/i,
  );
});

test("buildCycloneDx rejects unknown package versions", () => {
  const input = fixtures();
  input.thirdPartyManifest.dependencies.runtimeOrBundledCandidates[0].version =
    "unknown";
  assert.throws(() => buildCycloneDx(input), /unknown version/i);
});

test("assertSbomMatches fails closed on artifact identity drift", () => {
  const input = fixtures();
  const expected = buildCycloneDx(input);
  const actual = structuredClone(expected);
  actual.metadata.component.properties =
    actual.metadata.component.properties.map((entry) =>
      entry.name === "totem:release-bundle-sha256"
        ? { ...entry, value: "d".repeat(64) }
        : entry,
    );
  assert.throws(
    () => assertSbomMatches(expected, actual),
    /stale|does not match/i,
  );
});
