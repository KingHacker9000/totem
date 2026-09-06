import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { TotemConfig } from "./config.js";

export interface OperatorLogEntry {
  occurredAt: string;
  method: string;
  url: string;
  statusCode: number;
}

export interface OperatorRouteOptions {
  config: TotemConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface BackupManifest {
  schema: "totem.backup/v0";
  id: string;
  createdAt: string;
  source: string;
  entries: string[];
}

const BACKUP_ID_PATTERN = /^\d{8}T\d{6}\.\d{3}Z$/;

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function backupId(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(path: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}

export class OperatorManager {
  private readonly logs: OperatorLogEntry[] = [];
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(
    private readonly config: TotemConfig,
    options: Omit<OperatorRouteOptions, "config"> = {},
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  record(entry: OperatorLogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > 250) {
      this.logs.splice(0, this.logs.length - 250);
    }
  }

  recentLogs(limit = 100): readonly OperatorLogEntry[] {
    const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit) || 100));
    return this.logs.slice(-safeLimit).reverse();
  }

  capabilitySnapshot() {
    const loopbackOnly = isLoopbackHost(this.config.host);
    const externalAccessLayer = this.env.TOTEM_REMOTE_ACCESS_LAYER?.trim() || null;
    return {
      speech: {
        statusEndpoint: "/api/speech/status",
        consolePath: "/speech",
        source: "core-capability-probe",
      },
      display: {
        transport: "core-events",
        eventEndpoint: "/api/events",
        simulatorUrl:
          this.env.TOTEM_DISPLAY_SIMULATOR_URL?.trim() ||
          "http://127.0.0.1:5174",
      },
      security: {
        host: this.config.host,
        loopbackOnly,
        applicationAuth: "not-implemented",
        externalAccessLayer,
        remoteExposureSecure: loopbackOnly,
        recommendation: loopbackOnly
          ? null
          : "Totem core has no application-wide authentication boundary. Keep TOTEM_HOST on loopback or place it behind an authenticated reverse-access layer.",
      },
      backup: {
        directory: join(this.config.paths.root, "backups"),
        restoreMode: "restart-required",
      },
    };
  }

  async listBackups(): Promise<BackupManifest[]> {
    const root = join(this.config.paths.root, "backups");
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && BACKUP_ID_PATTERN.test(entry.name),
        )
        .map((entry) => readManifest(join(root, entry.name, "manifest.json"))),
    );
    return manifests
      .filter((item): item is BackupManifest => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createBackup(): Promise<BackupManifest> {
    const id = backupId(this.now());
    const root = join(this.config.paths.root, "backups", id);
    const destination = join(root, "state");
    if (await pathExists(root)) {
      throw new Error(`Backup '${id}' already exists.`);
    }
    await mkdir(root, { recursive: true });
    const entries = await readdir(this.config.paths.state).catch(
      () => [] as string[],
    );
    if (await pathExists(this.config.paths.state)) {
      await cp(this.config.paths.state, destination, {
        recursive: true,
        force: false,
      });
    } else {
      await mkdir(destination, { recursive: true });
    }
    const manifest: BackupManifest = {
      schema: "totem.backup/v0",
      id,
      createdAt: this.now().toISOString(),
      source: this.config.paths.state,
      entries: entries.map((entry) => String(entry)).sort(),
    };
    await writeFile(
      join(root, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    return manifest;
  }

  async restorePlan(id: string) {
    if (!BACKUP_ID_PATTERN.test(id)) {
      throw new Error("Invalid backup id.");
    }
    const root = join(this.config.paths.root, "backups", id);
    const manifest = await readManifest(join(root, "manifest.json"));
    if (!manifest) {
      throw new Error(`Backup '${id}' was not found.`);
    }
    return {
      schema: "totem.restore-plan/v0",
      backup: manifest,
      liveRestoreSupported: false,
      reason:
        "Durable state must not be replaced while the core process is running.",
      steps: [
        "Stop the Totem core service.",
        `Preserve the current state directory: ${this.config.paths.state}`,
        `Copy ${join(root, "state")} to ${this.config.paths.state}`,
        "Start Totem core and run health/self-test checks before deleting the preserved state.",
      ],
    };
  }
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  options: OperatorRouteOptions,
): OperatorManager {
  const manager = new OperatorManager(options.config, options);

  app.addHook("onResponse", (request, reply, done) => {
    manager.record({
      occurredAt: (options.now ?? (() => new Date()))().toISOString(),
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
    });
    done();
  });

  app.get("/api/operator/capabilities", async () =>
    manager.capabilitySnapshot(),
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/api/operator/logs",
    async (request) => ({
      logs: manager.recentLogs(Number(request.query.limit ?? "100")),
    }),
  );

  app.get("/api/operator/backups", async () => ({
    backups: await manager.listBackups(),
  }));

  app.post("/api/operator/backups", async (_request, reply) =>
    reply.code(201).send({ backup: await manager.createBackup() }),
  );

  app.post<{ Params: { backupId: string } }>(
    "/api/operator/backups/:backupId/restore-plan",
    async (request, reply) => {
      try {
        return { plan: await manager.restorePlan(request.params.backupId) };
      } catch (error) {
        return reply.code(404).send({
          error: "backup_not_found",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  return manager;
}
