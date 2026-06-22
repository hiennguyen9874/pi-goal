import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/package-manifest.test.ts"],
    exclude: ["profiling/**", "node_modules/**", "fitchmultz-pi-codex-goal/**", "code-yeongyu-pi-goal/**"],
    pool: "forks",
  },
});
