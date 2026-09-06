import type { FastifyInstance } from "fastify";
import type { ExtensionBackendHost } from "./extensionBackendHost.js";
import { buildExtensionContributionSnapshot } from "./extensionContributions.js";
import type { ExtensionRuntime } from "./extensionRuntime.js";

export function registerExtensionContributionRoutes(
  app: FastifyInstance,
  runtime: ExtensionRuntime,
  backendHost: ExtensionBackendHost,
): void {
  app.get("/api/extensions/contributions", async () => ({
    ...(await buildExtensionContributionSnapshot(runtime, backendHost)),
    security: {
      displayRequiresGrant: "display.present",
      disabledAndFailedExtensionsVisible: false,
    },
  }));
}
