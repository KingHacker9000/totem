import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    // Keep the PC-first suite lightweight even on hosts reporting many CPUs.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
