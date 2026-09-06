import { join } from "node:path";
import { migrateToLatest, openTotemDatabase, TaskStore } from "@totem/storage";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { discoverPackages } from "./discovery.js";
import {
  parseRegistryTrustedKeys,
  registerEcosystemRoutes,
  RegistryManager,
  RemoteNodeManager,
} from "./ecosystemRoutes.js";
import { ExtensionBackendHost } from "./extensionBackendHost.js";
import { ExtensionRuntime } from "./extensionRuntime.js";
import { RuntimeEventHub } from "./events.js";
import { JsonExtensionSettingsStore } from "./extensionServices.js";
import { TaskOrchestrator } from "./orchestrator.js";
import { registerProviderRoutes } from "./providerRoutes.js";
import { RealProviderCoordinator } from "./realProviders.js";
import { ensureDataDirectories } from "./runtime.js";
import { registerThemeRoutes } from "./themeRoutes.js";
import { ThemeRuntime } from "./themeRuntime.js";

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

let database: ReturnType<typeof openTotemDatabase> | undefined;

try {
  const config = loadConfig();
  await ensureDataDirectories(config);

  database = openTotemDatabase({
    filename: join(config.paths.state, "totem.sqlite3"),
  });
  await migrateToLatest(database);
  const taskStore = new TaskStore(database);
  const eventHub = new RuntimeEventHub();
  const extensionSettings = new JsonExtensionSettingsStore(
    join(config.paths.state, "extension-settings.json"),
  );
  const packageSnapshot = await discoverPackages({
    extensionRoots: config.discovery.extensionRoots,
    themeRoots: config.discovery.themeRoots,
    activeThemeId: config.discovery.activeThemeId,
  });
  const extensionRuntime = await ExtensionRuntime.fromDiscovery(
    packageSnapshot.extensions,
    config.extensionGrants ?? {},
    { settings: extensionSettings },
  );
  const extensionBackendHost = new ExtensionBackendHost(
    extensionRuntime,
    packageSnapshot.extensions,
  );
  await extensionBackendHost.startEnabled();

  const themeRuntime = new ThemeRuntime({
    themeRoots: config.discovery.themeRoots,
    stateFile: join(config.paths.state, "theme-state.json"),
    ...(config.discovery.activeThemeId
      ? { configuredThemeId: config.discovery.activeThemeId }
      : {}),
  });

  const startedAt = new Date().toISOString();
  let orchestrator: TaskOrchestrator | undefined;
  const app = createApp({
    config,
    startedAt,
    taskStore,
    eventHub,
    extensionRuntime,
    extensionBackendHost,
    getOrchestrator: () => orchestrator,
  });
  registerThemeRoutes(app, themeRuntime);

  const registry = new RegistryManager({
    stateDir: config.paths.state,
    trustedKeys: parseRegistryTrustedKeys(process.env.TOTEM_REGISTRY_TRUSTED_KEYS),
  });
  const remoteNodes = new RemoteNodeManager();
  registerEcosystemRoutes(app, registry, remoteNodes);

  const realProviders = new RealProviderCoordinator({
    taskStore,
    hub: eventHub,
    logger: {
      error: (details: Record<string, unknown>, message: string) =>
        app.log.error(details, message),
    },
  });
  registerProviderRoutes(app, realProviders);

  orchestrator = new TaskOrchestrator({
    taskStore,
    hub: eventHub,
    logger: {
      error: (details: Record<string, unknown>, message: string) =>
        app.log.error(details, message),
    },
  });
  app.log.info(
    {
      event: "system.orchestrator_ready",
      mockProvider: orchestrator.providerId,
      realProviders: realProviders.listProviderIds(),
    },
    "Agent provider coordinators ready",
  );
  let closing = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ event: "system.stopping", signal }, "Totem core stopping");
    await extensionBackendHost.stopAll();
    await app.close();
    await database?.destroy();
    database = undefined;
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
  const activeTheme = await themeRuntime.snapshot();
  app.log.info(
    {
      event: "system.ready",
      address,
      environment: config.environment,
      dataDir: config.paths.root,
      extensions: extensionRuntime.publicSnapshot().map((extension) => ({
        id: extension.id,
        state: extension.state,
      })),
      activeTheme: activeTheme.activeThemeId,
      realProviders: realProviders.listProviderIds(),
    },
    "Totem core ready",
  );
} catch (error) {
  await database?.destroy();
  database = undefined;
  writeStartupFailure(error);
  process.exitCode = 1;
}
