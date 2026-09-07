#!/usr/bin/env node
import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
export const PURGE_CONFIRMATION = "PURGE-TOTEM-STATE";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function performDecommission({
  prefix = "/opt/totem",
  stateDir = "/var/lib/totem",
  configDir = "/etc/totem",
  serviceFile = "/etc/systemd/system/totem.service",
  purgeState = false,
  purgeConfig = false,
  confirmation = null,
  dryRun = false,
  runSystemctl = async (args) => execFileAsync("systemctl", args),
} = {}) {
  if ((purgeState || purgeConfig) && confirmation !== PURGE_CONFIRMATION) {
    throw new Error(
      `Destructive purge requires --confirm ${PURGE_CONFIRMATION}. No data was removed.`,
    );
  }

  const actions = [];
  const record = (action, target, status) => actions.push({ action, target, status });

  for (const args of [
    ["stop", "totem.service"],
    ["disable", "totem.service"],
  ]) {
    if (dryRun) {
      record("systemctl", args.join(" "), "planned");
      continue;
    }
    try {
      await runSystemctl(args);
      record("systemctl", args.join(" "), "done");
    } catch (error) {
      const message = `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`;
      if (/not loaded|not found|does not exist|no such file/i.test(message)) {
        record("systemctl", args.join(" "), "already-absent");
      } else {
        throw new Error(`systemctl ${args.join(" ")} failed: ${message.trim()}`);
      }
    }
  }

  const removals = [
    { target: serviceFile, action: "remove-service", enabled: true },
    { target: prefix, action: "remove-runtime", enabled: true },
    { target: stateDir, action: "purge-state", enabled: purgeState },
    { target: configDir, action: "purge-config", enabled: purgeConfig },
  ];

  for (const item of removals) {
    if (!item.enabled) {
      record(item.action, item.target, "preserved");
      continue;
    }
    if (!(await exists(item.target))) {
      record(item.action, item.target, "already-absent");
      continue;
    }
    if (dryRun) {
      record(item.action, item.target, "planned");
      continue;
    }
    await rm(item.target, { recursive: true, force: true });
    record(item.action, item.target, "removed");
  }

  if (!dryRun) {
    try {
      await runSystemctl(["daemon-reload"]);
      record("systemctl", "daemon-reload", "done");
    } catch (error) {
      throw new Error(
        `systemctl daemon-reload failed: ${error?.message ?? String(error)}`,
      );
    }
  } else {
    record("systemctl", "daemon-reload", "planned");
  }

  return {
    schema: "totem.pi-decommission/v1",
    mode: dryRun ? "dry-run" : "execute",
    state: purgeState ? "purged" : "preserved",
    config: purgeConfig ? "purged" : "preserved",
    actions,
  };
}

function parseArgs(argv) {
  const options = {
    purgeState: false,
    purgeConfig: false,
    dryRun: false,
    confirmation: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--purge-state") options.purgeState = true;
    else if (arg === "--purge-config") options.purgeConfig = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--confirm") options.confirmation = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dryRun && process.getuid?.() !== 0) {
    throw new Error("decommission.mjs must run as root (use sudo), or use --dry-run.");
  }
  const result = await performDecommission({
    prefix: process.env.TOTEM_PREFIX ?? "/opt/totem",
    stateDir: process.env.TOTEM_STATE_DIR ?? "/var/lib/totem",
    configDir: process.env.TOTEM_CONFIG_DIR ?? "/etc/totem",
    serviceFile:
      process.env.TOTEM_SERVICE_FILE ?? "/etc/systemd/system/totem.service",
    ...options,
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Totem decommission: ${result.mode}`);
    for (const item of result.actions) {
      console.log(`${item.status.padEnd(14)} ${item.action}: ${item.target}`);
    }
    console.log(`Durable state: ${result.state}`);
    console.log(`Configuration: ${result.config}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
