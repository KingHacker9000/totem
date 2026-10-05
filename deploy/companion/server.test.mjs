import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initial } from "./state.mjs";

test("isolated sidecar recovers corrupt state and denies web/remote authority", {
  skip: process.platform !== "linux",
  timeout: 15000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "totem-companion-"));
  const restored = initial();
  restored.avatar.accessory = "sunglasses";
  await writeFile(join(root, "state.json"), "{invalid");
  await writeFile(join(root, "state.backup.json"), JSON.stringify(restored));
  const child = spawn(
    process.execPath,
    [new URL("./server.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        TOTEM_COMPANION_STATE: root,
        TOTEM_COMPANION_PORT: "4182",
        TOTEM_COMPANION_SOCKET: join(root, "commands.sock"),
        TOTEM_DESK_BASE: "http://127.0.0.1:1",
        MUSEGADGET_SOCKET: join(root, "absent.sock"),
        TOTEM_COMPANION_AUTO_RECOVER: "0",
        TOTEM_COMPANION_APPROVALS: "0",
      },
      stdio: "ignore",
    },
  );
  try {
    let state;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch("http://127.0.0.1:4182/state");
        if (r.ok) {
          state = await r.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(state, "sidecar should start");
    assert.equal(state.avatar.accessory, "sunglasses");
    assert.ok(
      state.events.some(
        (e) =>
          e.title === "Companion state recovered" && e.severity === "critical",
      ),
    );
    assert.ok(
      (await readdir(root)).some((p) => p.startsWith("state.invalid-")),
    );
    assert.equal(
      (
        await fetch("http://127.0.0.1:4182/state", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const forgedHost = await new Promise((resolve, reject) => {
      const req = http.get(
        "http://127.0.0.1:4182/state",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.equal(forgedHost, 403);
    const bad = await fetch("http://127.0.0.1:4182/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "system.run", args: { command: "id" } }),
    });
    assert.equal(bad.status, 400);
    async function command(name, args = {}) {
      return new Promise((resolve, reject) => {
        const sock = net.createConnection(join(root, "commands.sock"));
        sock.on("connect", () =>
          sock.write(`${JSON.stringify({ command: name, args })}\n`),
        );
        let body = "";
        sock.on("data", (chunk) => (body += chunk));
        sock.on("end", () => resolve(JSON.parse(body)));
        sock.on("error", reject);
      });
    }
    assert.match(
      (await command("totem.restart_core")).error,
      /approval UI unavailable/,
    );
    assert.match(
      (await command("totem.approve", { id: "fake", approve: true })).error,
      /physical confirmation/,
    );
    assert.equal((await command("totem.focus", { minutes: 1 })).ok, true);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    await rm(root, { recursive: true, force: true });
  }
});
