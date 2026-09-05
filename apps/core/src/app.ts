import Fastify from "fastify";
import { loadConfig, type TotemConfig } from "./config.js";
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

  app.get("/", async () => ({
    name: "Totem",
    stage: "phase-1",
    status: "ok",
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/status", async () => createRuntimeStatus(config, startedAt));

  return app;
}
