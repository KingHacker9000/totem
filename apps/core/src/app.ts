import Fastify from "fastify";
import { loadConfig, type TotemConfig } from "./config.js";
import { discoverPackages } from "./discovery.js";
import { ExtensionRuntime } from "./extensionRuntime.js";
import type { RuntimeEventHub } from "./events.js";
import { OrchestratorError, type TaskOrchestrator } from "./orchestrator.js";
import { createRuntimeStatus } from "./runtime.js";

export interface TaskDataSource {
  listTasks(): Promise<readonly unknown[]>;
  getTask(taskId: string): Promise<unknown | undefined>;
  listTaskEvents(taskId: string): Promise<readonly unknown[]>;
}

export interface CreateAppOptions {
  config?: TotemConfig;
  startedAt?: string;
  logger?: boolean;
  taskStore?: TaskDataSource;
  eventHub?: RuntimeEventHub;
  orchestrator?: TaskOrchestrator;
  extensionGrants?: Readonly<Record<string, readonly string[]>>;
  /**
   * Late-bound orchestrator accessor. The orchestrator needs the Fastify logger,
   * which only exists after {@link createApp} returns, so `main` wires it in
   * after construction via this getter.
   */
  getOrchestrator?: () => TaskOrchestrator | undefined;
}

interface StartTaskBody {
  prompt?: unknown;
  kind?: unknown;
  title?: unknown;
  scenario?: unknown;
}

const MOCK_SCENARIOS = new Set(["success", "failure", "wait"]);

function resolveOrchestrator(
  options: CreateAppOptions,
): TaskOrchestrator | undefined {
  return options.orchestrator ?? options.getOrchestrator?.();
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

  app.get("/api/tasks", async (_request, reply) => {
    if (!options.taskStore) {
      return reply.code(503).send({
        error: "task_store_unavailable",
        message: "Durable task storage is not available in this core instance.",
      });
    }

    return { tasks: await options.taskStore.listTasks() };
  });

  app.post<{ Body: StartTaskBody }>("/api/tasks", async (request, reply) => {
    const orchestrator = resolveOrchestrator(options);
    if (!orchestrator) {
      return reply.code(503).send({
        error: "orchestrator_unavailable",
        message:
          "The mock task orchestrator is not available in this core instance.",
      });
    }

    const body = request.body ?? {};
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "'prompt' is required and must be a non-empty string.",
      });
    }
    if (body.kind !== undefined && typeof body.kind !== "string") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "'kind' must be a string when provided.",
      });
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "'title' must be a string when provided.",
      });
    }
    if (
      body.scenario !== undefined &&
      (typeof body.scenario !== "string" || !MOCK_SCENARIOS.has(body.scenario))
    ) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "'scenario' must be one of: success, failure, wait.",
      });
    }

    try {
      const started = await orchestrator.startMockTask({
        prompt: body.prompt,
        ...(typeof body.kind === "string" ? { kind: body.kind } : {}),
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.scenario === "string"
          ? { scenario: body.scenario as "success" | "failure" | "wait" }
          : {}),
      });
      return reply.code(202).send(started);
    } catch (error) {
      if (error instanceof OrchestratorError) {
        return reply
          .code(400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post<{ Params: { taskId: string } }>(
    "/api/tasks/:taskId/interrupt",
    async (request, reply) => {
      const orchestrator = resolveOrchestrator(options);
      if (!orchestrator) {
        return reply.code(503).send({
          error: "orchestrator_unavailable",
          message:
            "The mock task orchestrator is not available in this core instance.",
        });
      }
      try {
        await orchestrator.interruptTask(request.params.taskId);
        return { status: "interrupting", taskId: request.params.taskId };
      } catch (error) {
        if (error instanceof OrchestratorError) {
          return reply
            .code(409)
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { taskId: string } }>(
    "/api/tasks/:taskId",
    async (request, reply) => {
      if (!options.taskStore) {
        return reply.code(503).send({
          error: "task_store_unavailable",
          message:
            "Durable task storage is not available in this core instance.",
        });
      }

      const task = await options.taskStore.getTask(request.params.taskId);
      if (!task) {
        return reply.code(404).send({
          error: "task_not_found",
          message: `Task '${request.params.taskId}' was not found.`,
        });
      }

      return {
        task,
        events: await options.taskStore.listTaskEvents(request.params.taskId),
      };
    },
  );

  app.get("/api/extensions", async () => {
    const snapshot = await discover();
    return {
      packages: snapshot.extensions,
      rootDiagnostics: snapshot.rootDiagnostics.filter(
        (diagnostic) => diagnostic.type === "extension",
      ),
    };
  });

  app.get("/api/extensions/runtime", async () => {
    const snapshot = await discover();
    const runtime = await ExtensionRuntime.fromDiscovery(
      snapshot.extensions,
      options.extensionGrants ?? {},
    );
    return {
      extensions: runtime.publicSnapshot(),
      security: {
        defaultGrantPolicy: "deny",
        secretValuesExposed: false,
      },
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

    const unsubscribe = options.eventHub?.subscribe((event) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });

  return app;
}
