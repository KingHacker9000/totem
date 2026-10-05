import { execFile } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  attentionPath,
  normalizeAttention,
  sourceReference,
} from "./attention.mjs";
import { briefingDetail, maybeBriefing } from "./briefing.mjs";
import { Companion, checkObject, number, text } from "./state.mjs";

const run = promisify(execFile);
const viewToken = randomBytes(32).toString("base64url");
const bootstrapPath =
  process.env.TOTEM_COMPANION_VIEW_BOOTSTRAP ||
  "/run/totem-companion/display-config.js";
const displayUser = process.env.TOTEM_COMPANION_DISPLAY_USER;
function validViewToken(value) {
  if (typeof value !== "string") return false;
  const input = Buffer.from(value),
    expected = Buffer.from(viewToken);
  return input.length === expected.length && timingSafeEqual(input, expected);
}
const port = Number(process.env.TOTEM_COMPANION_PORT || 4181);
const stateDir =
  process.env.TOTEM_COMPANION_STATE || "/srv/pi-hdd/totem-companion-state";
const publicDir = process.env.TOTEM_COMPANION_DISPLAY;
const socketPath =
  process.env.TOTEM_COMPANION_SOCKET || "/run/totem-companion/commands.sock";
const museSocket =
  process.env.MUSEGADGET_SOCKET || "/run/musegadget/musegadget.sock";
const deskBase = process.env.TOTEM_DESK_BASE || "http://127.0.0.1:4174";
let companion;
let stateRecovered = false;
try {
  const saved = JSON.parse(await readFile(`${stateDir}/state.json`, "utf8"));
  companion = new Companion(saved);
} catch (e) {
  if (e.code === "ENOENT") companion = new Companion();
  else {
    stateRecovered = true;
    console.error("companion state invalid; preserving file and trying backup");
    await rename(
      `${stateDir}/state.json`,
      `${stateDir}/state.invalid-${Date.now()}.json`,
    ).catch(() => {});
    try {
      companion = new Companion(
        JSON.parse(await readFile(`${stateDir}/state.backup.json`, "utf8")),
      );
    } catch {
      companion = new Companion();
    }
  }
}
if (stateRecovered)
  companion.event(
    {
      source: "system",
      title: "Companion state recovered",
      detail:
        "Invalid state was preserved. Check timers and acknowledged alerts.",
      severity: "critical",
      dedupeKey: "state-recovered",
    },
    "system",
  );
const clients = new Set();
let health = { status: "starting", muse: "unpaired" },
  navigation = {},
  presentation = { view: "unconnected", capabilities: [] },
  lastDisplayBeat = Date.now(),
  started = Date.now();
let persistence = Promise.resolve();
function persist() {
  const body = JSON.stringify(companion.state);
  persistence = persistence
    .catch(() => {})
    .then(async () => {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await writeFile(`${stateDir}/state.tmp`, body, {
        mode: 0o600,
        flush: true,
      });
      await rename(`${stateDir}/state.tmp`, `${stateDir}/state.json`);
      await writeFile(`${stateDir}/backup.tmp`, body, {
        mode: 0o600,
        flush: true,
      });
      await rename(`${stateDir}/backup.tmp`, `${stateDir}/state.backup.json`);
    });
  return persistence;
}
function snapshot() {
  return { ...companion.snapshot(), health };
}
function broadcast() {
  const event = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(event);
}
function localMessage(payload) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(museSocket);
    let body = "";
    sock.setTimeout(12000);
    sock.on("connect", () => sock.write(`${JSON.stringify(payload)}\n`));
    sock.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        sock.destroy();
        reject(new Error("message too large"));
      } else if (body.includes("\n")) {
        sock.end();
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      }
    });
    sock.on("error", reject);
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("Muse timeout"));
    });
  });
}
async function endpoint(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error("endpoint unavailable");
    return await res.json();
  } catch {
    return null;
  }
}
async function services() {
  const names = [
    "totem.service",
    "totem-portal-host.service",
    "totem-portal-kiosk.service",
    "musegadget.service",
    "lightdm.service",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        try {
          const { stdout } = await run(
            "/usr/bin/systemctl",
            ["is-active", name],
            { timeout: 2500 },
          );
          return [name, stdout.trim()];
        } catch (e) {
          return [name, e.stdout?.trim() || "unavailable"];
        }
      }),
    ),
  );
}
async function restart(unit) {
  await run(
    "/usr/bin/sudo",
    ["-n", "/usr/local/libexec/totem-companion-recover", unit],
    { timeout: 12000 },
  );
}
async function command(name, args = {}, source = "local") {
  if (name === "totem.health") {
    checkObject(args, []);
    return {
      ok: true,
      health,
      events: companion.snapshot().events,
      approvals: companion.snapshot().approvals,
    };
  }
  if (name === "totem.next" || name === "totem.briefing") {
    checkObject(args, []);
    const result = companion.command(
      "totem.show_card",
      {
        source: "briefing",
        title: name === "totem.next" ? "What’s next" : "Your day",
        detail: briefingDetail(navigation, {
          next: name === "totem.next",
          timezone: process.env.TZ,
        }),
        severity: "attention",
        proactive: false,
      },
      source,
    );
    await persist();
    broadcast();
    return { ...result, presentation };
  }
  if (name === "totem.set_brightness") {
    checkObject(args, ["percent"]);
    const percent = number(args.percent, 1, 100);
    if (!Number.isInteger(percent)) throw new Error("percent must be integer");
    await restart(`brightness:${percent}`);
    return { ok: true };
  }
  if (name === "totem.restart_display") {
    checkObject(args, []);
    await restart("totem-portal-kiosk.service");
    companion.state.audit.push({ action: name, source, at: Date.now() });
    await persist();
    return { ok: true };
  }
  if (name === "totem.restart_core") {
    checkObject(args, []);
    if (process.env.TOTEM_COMPANION_APPROVALS !== "1")
      throw new Error("physical approval UI unavailable");
    const item = {
      id: randomUUID(),
      action: name,
      source,
      expiresAt: Date.now() + 60000,
    };
    companion.state.approvals.push(item);
    await persist();
    broadcast();
    return { ok: true, approvalRequired: true, id: item.id };
  }
  if (name === "totem.approve") {
    if (source !== "touch") throw new Error("physical confirmation required");
    checkObject(args, ["id", "approve"]);
    if (typeof args.approve !== "boolean")
      throw new Error("approve must be boolean");
    companion.tick();
    const id = text(args.id, 100),
      item = companion.state.approvals.find((e) => e.id === id);
    if (!item) throw new Error("approval expired or unknown");
    companion.state.approvals = companion.state.approvals.filter(
      (e) => e.id !== id,
    );
    companion.state.audit.push({
      action: item.action,
      approved: args.approve,
      source,
      at: Date.now(),
    });
    await persist();
    if (args.approve) {
      await restart("totem.service");
      companion.state.audit.push({
        action: item.action,
        result: "restarted",
        at: Date.now(),
      });
    }
    await persist();
    broadcast();
    return { ok: true };
  }
  if (name === "totem.dismiss") {
    checkObject(args, ["id"]);
    const id = text(args.id, 100);
    const event = companion.state.events.find((e) => e.id === id);
    if (event?.origin === "adapter" && event.sourceRef) {
      const response = await fetch(deskBase + attentionPath(event.sourceRef), {
        method: "DELETE",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok)
        throw new Error(
          "connector acknowledgement unavailable; alert retained",
        );
    }
  }
  // Never expose arbitrary service, path, shell, URL or file parameters.
  const result = companion.command(name, args, source);
  await persist();
  broadcast();
  return { ...result, presentation };
}
async function body(req) {
  let bytes = 0,
    value = "";
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("request too large");
    value += chunk;
  }
  return JSON.parse(value || "{}");
}
const browserCommands = new Set([
  "totem.avatar.set_state",
  "totem.avatar.react",
  "totem.avatar.look_at",
  "totem.dismiss",
  "totem.focus",
  "totem.next",
  "totem.briefing",
  "totem.approve",
  "totem.set_brightness",
]);
function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  try {
    if (
      ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
    ) {
      json(res, 403, { error: "host denied" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !["null", `http://127.0.0.1:${port}`].includes(origin)) {
      json(res, 403, { error: "origin denied" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,X-Totem-View-Token",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST");
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const supplied =
      req.headers["x-totem-view-token"] ||
      (path === "/events" ? url.searchParams.get("token") : null);
    if (!validViewToken(supplied)) {
      json(res, 401, { ok: false, error: "display authentication required" });
      return;
    }
    if (path === "/state" && req.method === "GET") {
      json(res, 200, snapshot());
      return;
    }
    if (path === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (path === "/heartbeat" && req.method === "POST") {
      const report = await body(req);
      checkObject(report, ["view", "capabilities", "renderedAt"]);
      if (
        typeof report.view !== "string" ||
        report.view.length > 40 ||
        !Array.isArray(report.capabilities) ||
        report.capabilities.length > 20 ||
        report.capabilities.some((c) => typeof c !== "string" || c.length > 40)
      )
        throw new Error("invalid presentation report");
      number(report.renderedAt, 0, Number.MAX_SAFE_INTEGER);
      presentation = { view: report.view, capabilities: report.capabilities };
      lastDisplayBeat = Date.now();
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/command" && req.method === "POST") {
      const input = await body(req);
      checkObject(input, ["command", "args"]);
      if (!browserCommands.has(input.command))
        throw new Error("command unavailable to display");
      json(res, 200, await command(input.command, input.args, "touch"));
      return;
    }
    if (publicDir && req.method === "GET") {
      const file = resolve(
        publicDir,
        path === "/" ? "companion.html" : `.${path}`,
      );
      if (!file.startsWith(`${resolve(publicDir)}/`))
        throw new Error("invalid path");
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          }[extname(file)] || "application/octet-stream",
      });
      res.end(data);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 400, { ok: false, error: e.message });
  }
});
await mkdir(resolve(socketPath, ".."), { recursive: true });
await mkdir(resolve(bootstrapPath, ".."), { recursive: true });
await writeFile(
  bootstrapPath,
  `window.TotemCompanionConfig=${JSON.stringify({ base: `http://127.0.0.1:${port}`, token: viewToken })};\n`,
  { mode: 0o600 },
);
await chmod(bootstrapPath, 0o600);
if (displayUser) {
  await run(
    "/usr/bin/setfacl",
    ["-m", `u:${displayUser}:x`, resolve(bootstrapPath, "..")],
    { timeout: 2500 },
  );
  await run("/usr/bin/setfacl", ["-m", `u:${displayUser}:r`, bootstrapPath], {
    timeout: 2500,
  });
}
try {
  await unlink(socketPath);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let commandQueue = Promise.resolve();
const bridge = net.createServer((sock) => {
  let data = "";
  sock.setTimeout(5000, () => sock.destroy());
  sock.on("data", (chunk) => {
    data += chunk;
    if (data.length > 8192) {
      sock.destroy();
      return;
    }
    if (!data.includes("\n")) return;
    sock.pause();
    commandQueue = commandQueue
      .catch(() => {})
      .then(async () => {
        try {
          const input = JSON.parse(data);
          checkObject(input, ["command", "args"]);
          sock.end(
            JSON.stringify(await command(input.command, input.args, "muse")) +
              "\n",
          );
        } catch (e) {
          sock.end(`${JSON.stringify({ ok: false, error: e.message })}\n`);
        }
      });
  });
  sock.on("error", () => {});
});
await new Promise((resolve) => bridge.listen(socketPath, resolve));
await chmod(socketPath, 0o660);
server.listen(port, "127.0.0.1");
setInterval(() => {
  const before = JSON.stringify(companion.state);
  companion.tick();
  if (before !== JSON.stringify(companion.state))
    void persist().catch((e) => console.error("persistence:", e.message));
  broadcast();
}, 1000).unref();
let monitoring = false;
async function monitor() {
  if (monitoring) return;
  monitoring = true;
  try {
    const [disk, svc, nav, core, input, temp, museStatus] = await Promise.all([
      statfs("/"),
      services(),
      endpoint(`${deskBase}/desk/navigation`),
      endpoint("http://127.0.0.1:3000/health"),
      readFile("/proc/bus/input/devices", "utf8"),
      readFile("/sys/class/thermal/thermal_zone0/temp", "utf8").catch(
        () => null,
      ),
      readFile("/run/musegadget/status.json", "utf8")
        .then(JSON.parse)
        .catch(() => ({ connected: false, paired: false })),
    ]);
    navigation = nav || navigation;
    health = {
      status: core && nav ? "ok" : "attention",
      uptimeSeconds: Math.round(os.uptime()),
      freeDiskBytes: disk.bavail * disk.bsize,
      memoryFreeBytes: os.freemem(),
      load: os.loadavg(),
      temperatureC: temp ? Number(temp) / 1000 : null,
      touchAvailable: /ft5x06|touchscreen/i.test(input),
      services: svc,
      coreAvailable: !!core,
      connectorsAvailable: !!nav,
      muse:
        svc["musegadget.service"] === "active" &&
        Date.now() / 1000 - museStatus.at < 20 &&
        museStatus.connected
          ? "connected"
          : museStatus.paired
            ? "offline"
            : "unpaired",
      presentation,
      displayHeartbeatAgeSeconds: Math.round(
        (Date.now() - lastDisplayBeat) / 1000,
      ),
    };
    if (
      health.freeDiskBytes < 2 * 1024 ** 3 ||
      health.temperatureC >= 80 ||
      !health.touchAvailable
    )
      health.status = "attention";
    for (const alert of [
      health.freeDiskBytes < 2 * 1024 ** 3
        ? {
            source: "system",
            dedupeKey: "disk-low",
            title: "Storage is getting tight",
            detail: `${(health.freeDiskBytes / 1024 ** 3).toFixed(1)} GB free on the SD card.`,
            severity: "urgent",
            pinned: true,
          }
        : null,
      health.temperatureC >= 80
        ? {
            source: "system",
            dedupeKey: "temperature-high",
            title: "I’m feeling hot",
            detail: `Pi temperature ${health.temperatureC.toFixed(0)}°C.`,
            severity: "urgent",
            pinned: true,
          }
        : null,
      !health.touchAvailable
        ? {
            source: "system",
            dedupeKey: "touch-unavailable",
            title: "Touchscreen unavailable",
            severity: "critical",
          }
        : null,
      !core
        ? {
            source: "system",
            dedupeKey: "core-unavailable",
            title: "Totem core unavailable",
            detail: "Local character and timers still work.",
            severity: "urgent",
            pinned: true,
          }
        : null,
    ])
      if (alert) companion.event(alert, "system");
    if (nav?.attention && Array.isArray(nav.attention.records)) {
      const records = nav.attention.records;
      for (const record of records) {
        try {
          const reference = sourceReference(record);
          const result = companion.event(normalizeAttention(record), "adapter");
          if (result.id) {
            const event = companion.state.events.find(
              (e) => e.id === result.id,
            );
            if (event?.origin === "adapter") event.sourceRef = reference;
          }
        } catch {
          console.error("invalid connector attention ignored");
        }
      }
      // Source resolution and original-screen touch dismissal cancel pending messages.
      // Never infer resolution from a failed snapshot fetch.
      for (const event of [...companion.state.events]) {
        if (
          event.origin === "adapter" &&
          event.sourceRef &&
          !records.some(
            (r) =>
              r.connectorId === event.sourceRef.connectorId &&
              r.id === event.sourceRef.recordId,
          )
        ) {
          companion.command(
            "totem.dismiss",
            { id: event.id },
            "source-resolution",
          );
        }
      }
    }
    maybeBriefing(
      companion,
      navigation,
      process.env.TOTEM_COMPANION_BRIEFING_AT,
      process.env.TZ,
    );
    // Auto-recover only a stale kiosk after a grace period, at most twice/hour.
    if (
      process.env.TOTEM_COMPANION_AUTO_RECOVER === "1" &&
      Date.now() - lastDisplayBeat > 60000 &&
      Date.now() - started > 90000
    ) {
      const attempts = companion.state.audit.filter(
        (e) =>
          e.action === "auto-restart-display" && Date.now() - e.at < 3600000,
      );
      if (attempts.length < 2) {
        companion.state.audit.push({
          action: "auto-restart-display",
          at: Date.now(),
        });
        await persist();
        await restart("totem-portal-kiosk.service");
        lastDisplayBeat = Date.now();
      } else
        companion.event(
          {
            source: "system",
            title: "Display needs attention",
            severity: "critical",
            dedupeKey: "display-recovery-failed",
          },
          "system",
        );
    }
    const event = companion.nextDelivery();
    if (event) {
      try {
        const result = await localMessage({
          message: `Totem ${event.severity}: ${event.title}. ${event.detail} Alert ID: ${event.id}. Use totem.dismiss to acknowledge.`,
          session_id: `totem-${event.source.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 50)}`,
        });
        if (!result.ok) throw new Error(result.error);
        companion.delivered(event.id);
      } catch {
        event.attempts++;
        event.nextAttempt =
          Date.now() +
          Math.min(300000, 10000 * 2 ** Math.min(event.attempts, 5));
      }
    }
    await persist();
    broadcast();
  } catch (e) {
    console.error("companion monitor:", e.message);
  } finally {
    monitoring = false;
  }
}
void monitor();
setInterval(() => void monitor(), 15000).unref();
process.on("SIGTERM", () => {
  void persist().finally(() => {
    server.close();
    bridge.close();
    process.exit(0);
  });
});
