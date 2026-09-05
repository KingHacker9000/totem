import { mkdir } from "node:fs/promises";
import type { TotemConfig } from "./config.js";

export interface RuntimeStatus {
  status: "ok";
  name: "Totem";
  stage: "phase-1";
  environment: TotemConfig["environment"];
  startedAt: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  dataDir: string;
}

export async function ensureDataDirectories(config: TotemConfig): Promise<void> {
  await Promise.all(
    Object.values(config.paths).map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
}

export function createRuntimeStatus(
  config: TotemConfig,
  startedAt: string,
  now = Date.now(),
): RuntimeStatus {
  const startedAtMs = Date.parse(startedAt);
  const uptimeSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
    : 0;

  return {
    status: "ok",
    name: "Totem",
    stage: "phase-1",
    environment: config.environment,
    startedAt,
    uptimeSeconds,
    pid: process.pid,
    nodeVersion: process.version,
    dataDir: config.paths.root,
  };
}
