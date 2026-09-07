import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_KIND,
  SCHEMA,
  assertManifestMatches,
  assertPublicBoundary,
  classifyDependencyGraphs,
} from "./third-party-manifest.mjs";

function manifest(overrides = {}) {
  return {
    schema: SCHEMA,
    artifact: {
      kind: ARTIFACT_KIND,
      sourceSnapshotSha256: "a".repeat(64),
      sourceFileCount: 10,
    },
    source: {
      revision: "0123456789abcdef",
      lockfileSha256: "b".repeat(64),
    },
    dependencies: {
      runtimeOrBundledCandidates: [],
      buildOrDevelopmentOnly: [],
    },
    externallySupplied: [{ id: "codex-cli", bundled: false }],
    boundaries: {
      publicReleaseOnly: true,
      excludedPrivateRepositories: [],
    },
    policy: {
      licenseSelection: "UNRESOLVED_T913",
    },
    ...overrides,
  };
}

test("classifies runtime graph separately from build/dev-only dependencies", () => {
  const runtimeListing = [
    {
      name: "@totem/core",
      dependencies: {
        fastify: {
          version: "5.12.3",
          dependencies: {
            "find-my-way": { version: "9.3.0" },
          },
        },
        "@totem/storage": {
          version: "link:../../packages/storage",
          dependencies: {
            kysely: { version: "0.28.5" },
          },
        },
      },
    },
  ];
  const fullListing = [
    ...runtimeListing,
    {
      name: "totem",
      devDependencies: {
        typescript: { version: "5.9.3" },
        vitest: { version: "3.2.7" },
      },
    },
  ];

  const result = classifyDependencyGraphs({
    runtimeListing,
    fullListing,
    workspaceNames: new Set(["@totem/core", "@totem/storage"]),
    directSpecs: new Map([
      ["fastify", "5.12.3"],
      ["typescript", "5.9.3"],
    ]),
  });

  assert.deepEqual(
    result.runtimePackages.map((entry) => entry.identity),
    ["fastify@5.12.3", "find-my-way@9.3.0", "kysely@0.28.5"],
  );
  assert.deepEqual(
    result.buildDevPackages.map((entry) => entry.identity),
    ["typescript@5.9.3", "vitest@3.2.7"],
  );
  assert.equal(result.runtimePackages[0].directSpec, "5.12.3");
  assert.equal(result.runtimePackages[1].directSpec, null);
});

test("rejects public manifests that depend on private Portal repositories", () => {
  assert.throws(
    () =>
      assertPublicBoundary([
        {
          path: "apps/core",
          manifest: {
            dependencies: {
              "portal-theme":
                "github:KingHacker9000/totem-portal-theme#deadbeef",
            },
          },
        },
      ]),
    /Private Portal dependency crossed the public release boundary/,
  );
});

test("stale artifact or dependency metadata fails verification", () => {
  const expected = manifest();
  const changedArtifact = manifest({
    artifact: {
      kind: ARTIFACT_KIND,
      sourceSnapshotSha256: "c".repeat(64),
      sourceFileCount: 10,
    },
  });

  assert.throws(
    () => assertManifestMatches(expected, changedArtifact),
    /stale or mismatched/,
  );

  const changedDependencies = manifest({
    dependencies: {
      runtimeOrBundledCandidates: [
        {
          name: "fastify",
          version: "5.12.3",
          directSpec: "5.12.3",
          identity: "fastify@5.12.3",
        },
      ],
      buildOrDevelopmentOnly: [],
    },
  });
  assert.throws(
    () => assertManifestMatches(expected, changedDependencies),
    /stale or mismatched/,
  );
});

test("externally supplied tools cannot be represented as bundled", () => {
  const expected = manifest();
  const invalid = manifest({
    externallySupplied: [{ id: "codex-cli", bundled: true }],
  });
  assert.throws(
    () => assertManifestMatches(expected, invalid),
    /must not be marked as bundled/,
  );
});
