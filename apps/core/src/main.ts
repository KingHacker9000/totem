import { createApp } from "./app.js";

const app = createApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  const address = await app.listen({ host: "127.0.0.1", port: 3000 });
  console.info(`Totem core scaffold listening at ${address}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
