import Fastify from "fastify";
import { loadConfig, type TotemConfig } from "./config.js";
import { discoverPackages } from "./discovery.js";
import { createRuntimeStatus } from "./runtime.js";

export interface CreateAppOptions {
  config?: TotemConfig;
  startedAt?: string;
  logger?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const startedAt = options.startedAt ?? new Date().toISOString();
  const logger =
    options.logger === false || config.logLevel === "silent"
      ? false
      : { level: config.logLevel };

  const app = Fastify({ logger });

  const discover = () =>
    discoverPackages({
      extensionRoots: config.discovery.extensionRoots,
      themeRoots: config.discovery.themeRoots,
      activeThemeId: config.discovery.activeThemeId,
    });

  app.get("/", async () => ({
    name: "Totem",
    stage: "phase-1",
    status: "ok",
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/status", async () => createRuntimeStatus(config, startedAt));

  app.get("/api/extensions", async () => {
    const snapshot = await discover();
    return {
      packages: snapshot.extensions,
      rootDiagnostics: snapshot.rootDiagnostics.filter(
        (diagnostic) => diagnostic.type === "extension",
      ),
    };
  });

  app.get("/api/themes", async () => {
    const snapshot = await discover();
    return {
      packages: snapshot.themes,
      rootDiagnostics: snapshot.rootDiagnostics.filter(
        (diagnostic) => diagnostic.type === "theme",
      ),
      activeTheme: snapshot.activeTheme,
    };
  });

  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });

    const writeStatus = () => {
      const event = {
        type: "core.status",
        occurredAt: new Date().toISOString(),
        data: createRuntimeStatus(config, startedAt),
      };
      reply.raw.write(`event: core.status\ndata: ${JSON.stringify(event)}\n\n`);
    };

    writeStatus();
    const heartbeat = setInterval(writeStatus, 15_000);
    heartbeat.unref();

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });

  return app;
}
