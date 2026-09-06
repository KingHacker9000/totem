#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  access,
  constants,
  mkdir,
  readFile,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const offline = args.has("--offline");
const strict = args.has("--strict");
const port = Number(process.env.TOTEM_PORT ?? "3000");
const stateDir =
  process.env.TOTEM_STATE_DIR ??
  process.env.TOTEM_DATA_DIR ??
  "/var/lib/totem";
const baseUrl = process.env.TOTEM_BASE_URL ?? `http://127.0.0.1:${port}`;
const results = [];

function add(id, status, summary, details = {}) {
  results.push({ id, status, summary, details });
}

function command(name, argv = []) {
  return spawnSync(name, argv, { encoding: "utf8", timeout: 5000 });
}

async function probeJson(route) {
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(3500),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

add("host", "PASS", "Host/runtime detected", {
  platform: process.platform,
  arch: process.arch,
  kernel: `${os.type()} ${os.release()}`,
  hostname: os.hostname(),
  node: process.version,
  cpus: os.cpus().length,
  memory_bytes: os.totalmem(),
});

if (process.platform === "linux") {
  const model = await readFile("/proc/device-tree/model", "utf8").catch(
    () => null,
  );
  add(
    "raspberry_pi",
    model?.includes("Raspberry Pi") ? "PASS" : "SKIP",
    model
      ? model.replace(/\0/g, "").trim()
      : "Raspberry Pi model metadata unavailable",
    { model: model?.replace(/\0/g, "").trim() ?? null },
  );
} else {
  add(
    "raspberry_pi",
    "SKIP",
    "Not running on Linux/Pi; host-independent checks only",
  );
}

try {
  await mkdir(stateDir, { recursive: true });
  await access(stateDir, constants.R_OK | constants.W_OK);
  const probe = path.join(stateDir, `.totem-self-test-${process.pid}`);
  await writeFile(probe, "ok\n", { flag: "wx" });
  await unlink(probe);
  const fs = await statfs(stateDir);
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  const minFree = Number(
    process.env.TOTEM_MIN_FREE_BYTES ?? 512 * 1024 * 1024,
  );
  add(
    "storage",
    freeBytes >= minFree ? "PASS" : "FAIL",
    freeBytes >= minFree
      ? "State directory is writable with sufficient free space"
      : "State directory is writable but low on free space",
    {
      state_dir: stateDir,
      free_bytes: freeBytes,
      minimum_free_bytes: minFree,
    },
  );
  const mount = command("findmnt", [
    "-T",
    stateDir,
    "-J",
    "-o",
    "TARGET,SOURCE,FSTYPE,OPTIONS",
  ]);
  if (mount.status === 0) {
    let mountInfo = mount.stdout.trim();
    try {
      mountInfo = JSON.parse(mountInfo);
    } catch {
      // Keep the raw output so diagnostics still remain useful.
    }
    add("state_mount", "PASS", "State-directory backing mount resolved", {
      mount: mountInfo,
    });
  } else {
    add(
      "state_mount",
      "SKIP",
      "findmnt unavailable; mount identity not verified",
      { state_dir: stateDir },
    );
  }
} catch (error) {
  add("storage", "FAIL", "State directory is not safely writable", {
    state_dir: stateDir,
    error: error instanceof Error ? error.message : String(error),
  });
}

const currentRelease = "/opt/totem/current";
try {
  const releaseStat = await stat(currentRelease);
  add(
    "release",
    releaseStat.isDirectory() ? "PASS" : "FAIL",
    releaseStat.isDirectory()
      ? "Current release path exists"
      : "Current release path is not a directory",
    { path: currentRelease },
  );
} catch {
  add(
    "release",
    offline ? "SKIP" : "FAIL",
    offline
      ? "Release path not required in offline CI mode"
      : "Current release path is missing",
    { path: currentRelease },
  );
}

if (process.platform === "linux" && !offline) {
  const systemctl = command("systemctl", ["is-active", "totem.service"]);
  if (systemctl.status === 0 && systemctl.stdout.trim() === "active") {
    add("service", "PASS", "totem.service is active");
  } else if (systemctl.error?.code === "ENOENT") {
    add("service", "SKIP", "systemctl unavailable on this Linux host");
  } else {
    add("service", "FAIL", "totem.service is not active", {
      output: `${systemctl.stdout}${systemctl.stderr}`.trim(),
      exit_code: systemctl.status,
    });
  }
} else {
  add(
    "service",
    "SKIP",
    offline
      ? "Service check skipped in offline mode"
      : "systemd service check only applies on Linux",
  );
}

if (!offline) {
  const health = await probeJson("/health");
  add(
    "health",
    health.ok ? "PASS" : "FAIL",
    health.ok
      ? "Core health endpoint responds"
      : "Core health endpoint is unavailable",
    health,
  );

  const status = await probeJson("/api/status");
  add(
    "core_status",
    status.ok ? "PASS" : "FAIL",
    status.ok
      ? "Core status endpoint responds"
      : "Core status endpoint is unavailable",
    status,
  );

  for (const [id, route] of [
    ["extensions", "/api/extensions/runtime"],
    ["themes", "/api/themes/runtime"],
    ["providers", "/api/providers"],
  ]) {
    const probe = await probeJson(route);
    add(
      id,
      probe.ok ? "PASS" : probe.status === 404 ? "SKIP" : "FAIL",
      probe.ok
        ? `${id} API responds`
        : probe.status === 404
          ? `${id} capability is not exposed by this build`
          : `${id} API failed`,
      probe,
    );
  }

  for (const [id, route] of [
    ["speech", "/api/speech/status"],
    ["display", "/api/display/status"],
    ["permissions", "/api/security/status"],
  ]) {
    const probe = await probeJson(route);
    add(
      id,
      probe.ok ? "PASS" : "SKIP",
      probe.ok
        ? `${id} capability/status is available`
        : `${id} capability is absent or not yet exposed; treated as optional`,
      probe,
    );
  }
} else {
  for (const id of [
    "health",
    "core_status",
    "extensions",
    "themes",
    "providers",
    "speech",
    "display",
    "permissions",
  ]) {
    add(id, "SKIP", "Live core check skipped in offline mode");
  }
}

if (process.platform === "linux") {
  const tempRaw = await readFile(
    "/sys/class/thermal/thermal_zone0/temp",
    "utf8",
  ).catch(() => null);
  const throttle = command("vcgencmd", ["get_throttled"]);
  const details = {};
  if (tempRaw) {
    details.cpu_temp_c = Number(tempRaw.trim()) / 1000;
  }
  if (throttle.status === 0) {
    details.throttled = throttle.stdout.trim();
  }
  add(
    "thermals",
    Object.keys(details).length ? "PASS" : "SKIP",
    Object.keys(details).length
      ? "Thermal telemetry available"
      : "Thermal telemetry unavailable on this host",
    details,
  );
} else {
  add("thermals", "SKIP", "Pi/Linux thermal telemetry not applicable");
}

const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const result of results) {
  counts[result.status] += 1;
}
const report = {
  schema: "totem.pi-self-test/v1",
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  state_dir: stateDir,
  offline,
  counts,
  overall: counts.FAIL === 0 ? "PASS" : "FAIL",
  results,
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Totem Pi readiness self-test");
  for (const item of results) {
    console.log(
      `${item.status.padEnd(4)} ${item.id.padEnd(15)} ${item.summary}`,
    );
  }
  console.log(
    `\nOverall: ${report.overall} (${counts.PASS} pass, ${counts.SKIP} skip, ${counts.FAIL} fail)`,
  );
  console.log("Use --json for a machine-readable report.");
}

if (counts.FAIL > 0 || (strict && counts.SKIP > 0)) {
  process.exitCode = 1;
}
