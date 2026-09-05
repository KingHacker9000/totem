import Fastify from "fastify";

// Construction is separate from listening so tests need no fixed port.
export function createApp() {
  const app = Fastify();
  app.get("/", async () => ({ name: "Totem", stage: "scaffold" }));
  return app;
}
