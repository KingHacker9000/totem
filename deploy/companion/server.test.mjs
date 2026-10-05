import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initial } from "./state.mjs";

test("isolated sidecar recovers corrupt state and denies web/remote authority", {
  skip: process.platform !== "linux",
  timeout: 60000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "totem-companion-"));
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let acknowledgementAllowed = false;
  let acknowledged = false;
  const desk = http.createServer((req, res) => {
    if (req.url === "/desk/navigation") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          widgets: [
            {
              id: "academic:due-this-week",
              health: "ok",
              updatedAt: new Date().toISOString(),
              primary: "4",
              data: {
                nextCourse: "Course",
                nextName: "Nearest assignment",
                nextDueAt: new Date(Date.now() + 3600000).toISOString(),
              },
            },
          ],
          attention: {
            records: acknowledged
              ? []
              : [
                  {
                    connectorId: "academic",
                    id: "assignment:42",
                    title: "Assignment due",
                    body: "Existing connector alert",
                    severity: "critical",
                  },
                ],
          },
        }),
      );
    } else if (
      req.method === "DELETE" &&
      req.url === "/desk/attention/academic/assignment%3A42"
    ) {
      acknowledged = acknowledgementAllowed;
      res.statusCode = acknowledgementAllowed ? 200 : 503;
      res.end();
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  desk.listen(0, "127.0.0.1");
  await once(desk, "listening");
  const deskBase = `http://127.0.0.1:${desk.address().port}`;
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
        TOTEM_COMPANION_VIEW_BOOTSTRAP: join(root, "display-config.js"),
        TOTEM_COMPANION_DISPLAY_USER: "",
        TOTEM_COMPANION_EVENT_USER: "",
        TOTEM_COMPANION_JOB_UNITS: "",
        TOTEM_COMPANION_EVENT_SOCKET: join(root, "events.sock"),
        TOTEM_COMPANION_PORT: String(port),
        TOTEM_COMPANION_SOCKET: join(root, "commands.sock"),
        TOTEM_DESK_BASE: deskBase,
        MUSEGADGET_SOCKET: join(root, "absent.sock"),
        TOTEM_COMPANION_AUTO_RECOVER: "0",
        TOTEM_COMPANION_APPROVALS: "0",
      },
      stdio: "ignore",
    },
  );
  let stage = "startup";
  const request = (url, options = {}) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  t.signal.addEventListener(
    "abort",
    () => {
      t.diagnostic(`timed out during ${stage}`);
      child.kill("SIGKILL");
    },
    {
      once: true,
    },
  );
  try {
    let state, token;
    function headers() {
      return { "X-Totem-View-Token": token };
    }
    for (let i = 0; i < 100; i++) {
      try {
        const config = await readFile(join(root, "display-config.js"), "utf8");
        token = JSON.parse(
          config
            .replace(/^window.TotemCompanionConfig=/, "")
            .trim()
            .replace(/;$/, ""),
        ).token;
        const r = await request(`${base}/state`, {
          headers: headers(),
        });
        if (r.ok) {
          state = await r.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(state, "sidecar should start");
    assert.equal((await request(`${base}/state`)).status, 401);
    assert.equal(
      (
        await request(`${base}/state`, {
          headers: { Origin: "null" },
        })
      ).status,
      401,
    );
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
        await request(`${base}/state`, {
          headers: { ...headers(), Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const forgedHost = await new Promise((resolve, reject) => {
      const req = http.get(
        `${base}/state`,
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.equal(forgedHost, 403);
    const bad = await request(`${base}/command`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ command: "system.run", args: { command: "id" } }),
    });
    assert.equal(bad.status, 400);
    async function command(name, args = {}) {
      stage = name;
      return new Promise((resolve, reject) => {
        const sock = net.createConnection(join(root, "commands.sock"));
        sock.setTimeout(10000, () =>
          sock.destroy(new Error(`command timeout: ${name}`)),
        );
        sock.on("connect", () =>
          sock.write(`${JSON.stringify({ command: name, args })}\n`),
        );
        let body = "";
        sock.on("data", (chunk) => (body += chunk));
        sock.on("end", () => resolve(JSON.parse(body)));
        sock.on("error", reject);
      });
    }
    let imported;
    for (let i = 0; i < 100; i++) {
      const snapshot = await request(`${base}/state`, {
        headers: headers(),
      }).then((r) => r.json());
      imported = snapshot.events.find(
        (e) => e.sourceRef?.recordId === "assignment:42",
      );
      if (imported) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(imported, "existing connector alert should be imported");
    assert.equal(imported.origin, "adapter");
    assert.match(
      (await command("totem.dismiss", { id: imported.id })).error,
      /alert retained/,
    );
    assert.ok(
      (
        await request(`${base}/state`, { headers: headers() }).then((r) =>
          r.json(),
        )
      ).events.some((e) => e.id === imported.id),
    );
    acknowledgementAllowed = true;
    assert.equal(
      (await command("totem.dismiss", { id: imported.id })).ok,
      true,
    );
    assert.equal(
      acknowledged,
      true,
      "remote acknowledgement reaches the original connector",
    );
    assert.ok(
      !(
        await request(`${base}/state`, { headers: headers() }).then((r) =>
          r.json(),
        )
      ).events.some((e) => e.id === imported.id),
    );
    assert.match(
      (await command("totem.restart_core")).error,
      /approval UI unavailable/,
    );
    assert.match(
      (await command("totem.approve", { id: "fake", approve: true })).error,
      /physical confirmation/,
    );
    assert.equal((await command("totem.focus", { minutes: 1 })).ok, true);
    const publisher = spawn(
      process.execPath,
      [new URL("./publish-event.mjs", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          TOTEM_COMPANION_EVENT_SOCKET: join(root, "events.sock"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let published = "";
    publisher.stdout.on("data", (chunk) => (published += chunk));
    const publisherExit = once(publisher, "exit");
    publisher.stdin.end(
      JSON.stringify({
        source: "jobs",
        type: "job.failed",
        severity: "critical",
        title: "Local job failed",
        dedupeKey: "local-run-1",
      }),
    );
    assert.equal((await publisherExit)[0], 0);
    const publication = JSON.parse(published);
    assert.equal(publication.ok, true);
    const saved = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    assert.equal(
      saved.outbox.some(
        (e) => e.id === publication.id && e.origin === "local-event",
      ),
      true,
    );
    assert.equal(
      (await command("totem.dismiss", { id: publication.id })).ok,
      true,
    );
    const next = await command("totem.next");
    assert.equal(next.ok, true);
    const requested = (
      await request(`${base}/state`, { headers: headers() }).then((r) =>
        r.json(),
      )
    ).events.find((e) => e.id === next.id);
    assert.equal(requested.requested, true);
    assert.match(requested.detail, /Nearest assignment/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      stage = "cleanup";
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
    desk.closeAllConnections();
    await new Promise((resolve) => desk.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
