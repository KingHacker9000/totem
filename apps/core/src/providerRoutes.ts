import type { FastifyInstance } from "fastify";
import {
  RealProviderError,
  type RealProviderCoordinator,
} from "./realProviders.js";

interface StartProviderTaskBody {
  prompt?: unknown;
  providerId?: unknown;
  kind?: unknown;
  title?: unknown;
  workspace?: unknown;
}

interface ResumeProviderTaskBody {
  prompt?: unknown;
  kind?: unknown;
  title?: unknown;
}

function parseWorkspace(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new RealProviderError(
      "invalid_workspace",
      "workspace must be an object when provided",
    );
  }
  const workspace = value as { path?: unknown; access?: unknown };
  if (typeof workspace.path !== "string" || workspace.path.trim() === "") {
    throw new RealProviderError(
      "invalid_workspace",
      "workspace.path must be a non-empty string",
    );
  }
  if (workspace.access !== "read-only" && workspace.access !== "read-write") {
    throw new RealProviderError(
      "invalid_workspace",
      "workspace.access must be read-only or read-write",
    );
  }
  return { path: workspace.path, access: workspace.access } as const;
}

function validateTurnBody(body: ResumeProviderTaskBody) {
  if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
    return {
      error: "invalid_request",
      message: "'prompt' is required and must be a non-empty string.",
    };
  }
  if (body.kind !== undefined && typeof body.kind !== "string") {
    return {
      error: "invalid_request",
      message: "'kind' must be a string when provided.",
    };
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return {
      error: "invalid_request",
      message: "'title' must be a string when provided.",
    };
  }
  return undefined;
}

function providerErrorStatus(error: RealProviderError): number {
  if (error.code === "provider_unavailable") return 503;
  if (error.code === "provider_not_found" || error.code === "task_not_found") {
    return 404;
  }
  if (
    error.code === "task_not_resumable" ||
    error.code === "resume_session_unavailable" ||
    error.code === "resume_not_supported" ||
    error.code === "session_busy" ||
    error.code === "task_not_active"
  ) {
    return 409;
  }
  return 400;
}

export function registerProviderRoutes(
  app: FastifyInstance,
  coordinator: RealProviderCoordinator,
): void {
  app.get("/api/providers", async () => ({
    providers: [
      {
        id: "mock",
        status: {
          id: "mock",
          available: true,
          detail: "deterministic in-process provider",
        },
        capabilities: {
          streaming: true,
          resume: true,
          interrupt: true,
          workspaces: true,
          mcp: true,
        },
      },
      ...(await coordinator.providerSnapshots()),
    ],
  }));

  app.post<{ Body: StartProviderTaskBody }>(
    "/api/provider-tasks",
    async (request, reply) => {
      const body = request.body ?? {};
      const invalid = validateTurnBody(body);
      if (invalid) return reply.code(400).send(invalid);
      if (
        typeof body.providerId !== "string" ||
        body.providerId.trim() === "" ||
        body.providerId === "mock"
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'providerId' must select a real provider.",
        });
      }

      try {
        const started = await coordinator.startTask({
          prompt: body.prompt as string,
          providerId: body.providerId,
          ...(typeof body.kind === "string" ? { kind: body.kind } : {}),
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(body.workspace !== undefined
            ? { workspace: parseWorkspace(body.workspace) }
            : {}),
        });
        return reply.code(202).send(started);
      } catch (error) {
        if (error instanceof RealProviderError) {
          return reply
            .code(providerErrorStatus(error))
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { taskId: string };
    Body: ResumeProviderTaskBody;
  }>(
    "/api/provider-tasks/:taskId/resume",
    async (request, reply) => {
      const body = request.body ?? {};
      const invalid = validateTurnBody(body);
      if (invalid) return reply.code(400).send(invalid);

      try {
        const resumed = await coordinator.resumeTask(request.params.taskId, {
          prompt: body.prompt as string,
          ...(typeof body.kind === "string" ? { kind: body.kind } : {}),
          ...(typeof body.title === "string" ? { title: body.title } : {}),
        });
        return reply.code(202).send(resumed);
      } catch (error) {
        if (error instanceof RealProviderError) {
          return reply
            .code(providerErrorStatus(error))
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/api/provider-tasks/:taskId/interrupt",
    async (request, reply) => {
      try {
        await coordinator.interruptTask(request.params.taskId);
        return { status: "interrupting", taskId: request.params.taskId };
      } catch (error) {
        if (error instanceof RealProviderError) {
          return reply
            .code(providerErrorStatus(error))
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );
}
