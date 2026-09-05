import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("core scaffold", () => {
  // Fastify lazily loads its HTTP injection helper; allow cold Windows/WSL I/O.
  it("serves the scaffold response through Fastify", async () => {
    const app = createApp();
    try {
      const response = await app.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ name: "Totem", stage: "scaffold" });
      expect(
        (await app.inject({ method: "GET", url: "/missing" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  }, 15_000);
});
