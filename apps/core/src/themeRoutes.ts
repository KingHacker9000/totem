import type { FastifyInstance } from "fastify";
import { type ThemeRuntime, ThemeRuntimeError } from "./themeRuntime.js";

interface ActivateBody {
  themeId?: unknown;
}

function statusFor(error: ThemeRuntimeError): number {
  if (error.code === "theme_not_found") return 404;
  if (error.code === "theme_state_invalid") return 500;
  return 400;
}

export function registerThemeRoutes(
  app: FastifyInstance,
  themeRuntime: ThemeRuntime,
): void {
  app.get("/api/themes/runtime", async () => ({
    theme: await themeRuntime.snapshot(),
    installed: await themeRuntime.list(),
    security: {
      privilegeBearing: false,
      secretValuesExposed: false,
    },
  }));

  app.put<{ Body: ActivateBody }>(
    "/api/themes/active",
    async (request, reply) => {
      if (
        typeof request.body?.themeId !== "string" ||
        request.body.themeId.trim() === ""
      ) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "'themeId' is required and must be a non-empty string.",
        });
      }

      try {
        return { theme: await themeRuntime.activate(request.body.themeId) };
      } catch (error) {
        if (error instanceof ThemeRuntimeError) {
          return reply.code(statusFor(error)).send({
            error: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post("/api/themes/rollback", async (_request, reply) => {
    try {
      return { theme: await themeRuntime.rollback() };
    } catch (error) {
      if (error instanceof ThemeRuntimeError) {
        return reply.code(statusFor(error)).send({
          error: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });
}
