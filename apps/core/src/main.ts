import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { ensureDataDirectories } from "./runtime.js";

function writeStartupFailure(error: unknown): void {
  const payload =
    error instanceof ConfigError
      ? {
          level: "error",
          event: "system.config_invalid",
          message: error.message,
          issues: error.issues,
        }
      : {
          level: "error",
          event: "system.start_failed",
          message: error instanceof Error ? error.message : String(error),
        };

  console.error(JSON.stringify(payload));
}

try {
  const config = loadConfig();
  await ensureDataDirectories(config);

  const startedAt = new Date().toISOString();
  const app = createApp({ config, startedAt });
  let closing = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ event: "system.stopping", signal }, "Totem core stopping");
    await app.close();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch((error: unknown) => {
        app.log.error(
          { event: "system.stop_failed", err: error },
          "Totem core failed to stop cleanly",
        );
        process.exitCode = 1;
      });
    });
  }

  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      event: "system.ready",
      address,
      environment: config.environment,
      dataDir: config.paths.root,
    },
    "Totem core ready",
  );
} catch (error) {
  writeStartupFailure(error);
  process.exitCode = 1;
}
