import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAudit,
  normalizeAudit,
  validatePolicy,
} from "./release-dependency-audit.mjs";

const basePolicy = {
  schema: "totem.release-dependency-advisory-policy/v1",
  minimumSeverity: "high",
  exceptions: [],
};

const audit = {
  vulnerabilities: {
    fastify: {
      severity: "high",
      via: [
        {
          source: 123,
          title: "Synthetic high severity issue",
          severity: "high",
          url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        },
      ],
    },
    tiny: {
      severity: "low",
      via: [
        {
          source: 456,
          title: "Synthetic low severity issue",
          severity: "low",
          url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
        },
      ],
    },
  },
};

test("normalizes npm/pnpm vulnerability JSON deterministically", () => {
  assert.deepEqual(
    normalizeAudit(audit).map(({ advisoryId, package: pkg, severity }) => ({
      advisoryId,
      pkg,
      severity,
    })),
    [
      {
        advisoryId: "GHSA-AAAA-BBBB-CCCC",
        pkg: "fastify",
        severity: "high",
      },
      {
        advisoryId: "GHSA-DDDD-EEEE-FFFF",
        pkg: "tiny",
        severity: "low",
      },
    ],
  );
});

test("fails actionable advisories at or above the threshold", () => {
  const result = evaluateAudit({
    audit,
    policy: basePolicy,
    now: new Date("2026-09-07T00:00:00Z"),
  });
  assert.equal(result.actionable.length, 1);
  assert.equal(result.actionable[0].advisoryId, "GHSA-AAAA-BBBB-CCCC");
  assert.equal(result.actionable[0].reason, "no-exception");
});

test("accepts only exact, unexpired advisory and package exceptions", () => {
  const policy = {
    ...basePolicy,
    exceptions: [
      {
        advisoryId: "GHSA-AAAA-BBBB-CCCC",
        package: "fastify",
        rationale: "Synthetic fixture only.",
        compensatingControl: "Synthetic compensating control.",
        expiresOn: "2026-09-30",
      },
    ],
  };
  const result = evaluateAudit({
    audit,
    policy,
    now: new Date("2026-09-07T00:00:00Z"),
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.actionable.length, 0);
});

test("expired exceptions fail closed", () => {
  const policy = {
    ...basePolicy,
    exceptions: [
      {
        advisoryId: "GHSA-AAAA-BBBB-CCCC",
        package: "fastify",
        rationale: "Synthetic fixture only.",
        compensatingControl: "Synthetic compensating control.",
        expiresOn: "2026-09-06",
      },
    ],
  };
  const result = evaluateAudit({
    audit,
    policy,
    now: new Date("2026-09-07T00:00:00Z"),
  });
  assert.equal(result.actionable.length, 1);
  assert.match(result.actionable[0].reason, /^exception-expired:/);
});

test("policy rejects blanket or malformed exceptions", () => {
  assert.throws(
    () => validatePolicy({ ...basePolicy, exceptions: [{ advisoryId: "x" }] }),
    /package must be a non-empty string/,
  );
  assert.throws(
    () =>
      validatePolicy({
        ...basePolicy,
        exceptions: [
          {
            advisoryId: "GHSA-X",
            package: "pkg",
            rationale: "reason",
            compensatingControl: "control",
            expiresOn: "forever",
          },
        ],
      }),
    /ISO date/,
  );
});
