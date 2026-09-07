import { describe, expect, it } from "vitest";
import { MIB, assertFreeSpace, chooseRetention, parsePositiveInteger } from "./release-policy.mjs";

const release = (name, mtimeMs) => ({ path: `/opt/totem/releases/${name}`, mtimeMs });

describe("Pi release retention", () => {
  it("protects the active release and newest rollback while pruning older releases", () => {
    const releases = [release("r4", 4), release("r3", 3), release("r2", 2), release("r1", 1)];
    const result = chooseRetention({ releases, current: releases[1].path, retain: 2 });

    expect(result.rollback).toBe(releases[0].path);
    expect(result.protected.map((entry) => entry.path)).toEqual([releases[0].path, releases[1].path]);
    expect(result.prune.map((entry) => entry.path)).toEqual([releases[2].path, releases[3].path]);
  });

  it("keeps additional newest releases when retention is raised", () => {
    const releases = [release("r4", 4), release("r3", 3), release("r2", 2), release("r1", 1)];
    const result = chooseRetention({ releases, current: releases[0].path, retain: 3 });

    expect(result.protected.map((entry) => entry.path)).toEqual([
      releases[0].path,
      releases[1].path,
      releases[2].path,
    ]);
    expect(result.prune.map((entry) => entry.path)).toEqual([releases[3].path]);
  });

  it("never permits retention below current plus one rollback", () => {
    expect(() => chooseRetention({ releases: [], current: null, retain: 1 })).toThrow(/at least 2/);
  });
});

describe("Pi disk preflight", () => {
  it("passes when free space covers release estimate plus reserve", () => {
    expect(
      assertFreeSpace({ availableBytes: 4096 * MIB, minFreeBytes: 2048 * MIB, estimatedReleaseBytes: 1024 * MIB }),
    ).toEqual({ availableBytes: 4096 * MIB, requiredBytes: 3072 * MIB });
  });

  it("fails before install when the configured reserve would be consumed", () => {
    expect(() =>
      assertFreeSpace({ availableBytes: 2500 * MIB, minFreeBytes: 2048 * MIB, estimatedReleaseBytes: 1024 * MIB }),
    ).toThrow(/insufficient free space/);
  });
});

describe("release policy configuration", () => {
  it("uses fallback for an unset value and rejects invalid integers", () => {
    expect(parsePositiveInteger(undefined, 2, "retention")).toBe(2);
    expect(parsePositiveInteger("4", 2, "retention")).toBe(4);
    expect(() => parsePositiveInteger("nope", 2, "retention")).toThrow(/non-negative integer/);
  });
});
