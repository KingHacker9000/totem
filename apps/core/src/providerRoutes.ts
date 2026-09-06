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
      if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'prompt' is required and must be a non-empty string.",
        });
      }
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

      try {
        const started = await coordinator.startTask({
          prompt: body.prompt,
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
          const status =
            error.code === "provider_unavailable"
              ? 503
              : error.code === "provider_not_found"
                ? 404
                : 400;
          return reply
            .code(status)
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
            .code(409)
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );
}
