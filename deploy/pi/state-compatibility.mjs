#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STATE_COMPATIBILITY_SCHEMA = "totem.state-compatibility/v1";
export const DESCRIPTOR_RELATIVE_PATH = "deploy/pi/state-compatibility.json";

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function validateStateCompatibilityDescriptor(descriptor) {
  if (!descriptor || descriptor.schema !== STATE_COMPATIBILITY_SCHEMA) {
    throw new Error(
      `Unsupported state compatibility descriptor; expected ${STATE_COMPATIBILITY_SCHEMA}.`,
    );
  }

  const stateFormat = assertString(descriptor.stateFormat, "stateFormat");
  const writes = assertString(descriptor.writes, "writes");
  const migration = assertString(descriptor.migration, "migration");
  if (!Array.isArray(descriptor.reads) || descriptor.reads.length === 0) {
    throw new Error("reads must contain at least one supported state format.");
  }
  const reads = descriptor.reads.map((value, index) =>
    assertString(value, `reads[${index}]`),
  );
  if (!reads.includes(stateFormat)) {
    throw new Error("reads must include the release stateFormat.");
  }
  if (writes !== stateFormat) {
    throw new Error(
      "writes must match stateFormat until an explicit migration implementation exists.",
    );
  }
  if (migration !== "none") {
    throw new Error(
      `Unsupported state migration '${migration}'. Totem has no implicit migration path.`,
    );
  }

  const legacyUnversionedFormat = descriptor.legacyUnversionedFormat;
  if (
    legacyUnversionedFormat !== undefined &&
    (typeof legacyUnversionedFormat !== "string" ||
      !reads.includes(legacyUnversionedFormat))
  ) {
    throw new Error(
      "legacyUnversionedFormat must be omitted or name a format accepted by reads.",
    );
  }

  return {
    schema: STATE_COMPATIBILITY_SCHEMA,
    stateFormat,
    reads,
    writes,
    migration,
    legacyUnversionedFormat: legacyUnversionedFormat ?? null,
  };
}

async function readDescriptorFile(releaseDir) {
  const path = resolve(releaseDir, DESCRIPTOR_RELATIVE_PATH);
  try {
    const descriptor = JSON.parse(await readFile(path, "utf8"));
    return {
      releaseDir: resolve(releaseDir),
      descriptor: validateStateCompatibilityDescriptor(descriptor),
      source: "descriptor",
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(
      `State compatibility descriptor is unreadable for ${releaseDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function legacyDescriptor(format, releaseDir) {
  return {
    releaseDir: resolve(releaseDir),
    source: "legacy-unversioned",
    descriptor: {
      schema: STATE_COMPATIBILITY_SCHEMA,
      stateFormat: format,
      reads: [format],
      writes: format,
      migration: "none",
      legacyUnversionedFormat: format,
    },
  };
}

export async function loadReleaseCompatibility(
  releaseDir,
  fallbackFormat = null,
) {
  const loaded = await readDescriptorFile(releaseDir);
  if (loaded) return loaded;
  if (fallbackFormat) return legacyDescriptor(fallbackFormat, releaseDir);
  throw new Error(
    `Release ${resolve(releaseDir)} has no ${DESCRIPTOR_RELATIVE_PATH}; compatibility cannot be proven without an explicit legacy baseline.`,
  );
}

export async function assertReleaseTransition({ fromRelease, toRelease }) {
  if (!fromRelease || !toRelease) {
    throw new Error("fromRelease and toRelease are required.");
  }

  const explicitFrom = await readDescriptorFile(fromRelease);
  const explicitTo = await readDescriptorFile(toRelease);
  if (!explicitFrom && !explicitTo) {
    throw new Error(
      "Neither release has a state compatibility descriptor; transition compatibility cannot be proven.",
    );
  }

  const fallbackFormat =
    explicitTo?.descriptor.legacyUnversionedFormat ??
    explicitFrom?.descriptor.legacyUnversionedFormat ??
    null;
  if (!fallbackFormat && (!explicitFrom || !explicitTo)) {
    throw new Error(
      "A release is missing its state descriptor and the explicit release does not declare a legacyUnversionedFormat.",
    );
  }

  const from = explicitFrom ?? legacyDescriptor(fallbackFormat, fromRelease);
  const to = explicitTo ?? legacyDescriptor(fallbackFormat, toRelease);
  if (!to.descriptor.reads.includes(from.descriptor.writes)) {
    throw new Error(
      `Unsafe state transition: target reads [${to.descriptor.reads.join(", ")}] but source writes '${from.descriptor.writes}'. Back up state and use a release with an explicit compatible migration/recovery path.`,
    );
  }

  return {
    schema: "totem.state-transition/v1",
    compatible: true,
    from: {
      release: from.releaseDir,
      source: from.source,
      writes: from.descriptor.writes,
    },
    to: {
      release: to.releaseDir,
      source: to.source,
      reads: to.descriptor.reads,
      writes: to.descriptor.writes,
    },
    migration: "none",
    stateMutation: "none",
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument sequence near '${key ?? "<end>"}'.`);
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "validate") {
    if (!options.release) {
      throw new Error("validate requires --release <directory>.");
    }
    const loaded = await loadReleaseCompatibility(options.release);
    console.log(
      JSON.stringify(
        {
          ok: true,
          release: loaded.releaseDir,
          source: loaded.source,
          descriptor: loaded.descriptor,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "assert-transition") {
    if (!options["from-release"] || !options["to-release"]) {
      throw new Error(
        "assert-transition requires --from-release <directory> --to-release <directory>.",
      );
    }
    const result = await assertReleaseTransition({
      fromRelease: options["from-release"],
      toRelease: options["to-release"],
    });
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    return;
  }
  throw new Error(
    "Usage: state-compatibility.mjs <validate|assert-transition> [options]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
