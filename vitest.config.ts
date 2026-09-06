import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@totem/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
      "@totem/tasks": fileURLToPath(
        new URL("./packages/tasks/src/index.ts", import.meta.url),
      ),
      "@totem/agents": fileURLToPath(
        new URL("./packages/agents/src/index.ts", import.meta.url),
      ),
      "@totem/storage": fileURLToPath(
        new URL("./packages/storage/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    // Keep the PC-first suite lightweight even on hosts reporting many CPUs.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
