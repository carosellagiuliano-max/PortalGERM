import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    setupFiles: ["./tests/vitest.setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    // The suite contains many jsdom-heavy UI files. Bounding workers prevents
    // CPU and process-spawn pressure from turning the 5 s per-test budget into
    // false timeouts on high-core Windows developer and CI hosts.
    maxWorkers: 2,
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
