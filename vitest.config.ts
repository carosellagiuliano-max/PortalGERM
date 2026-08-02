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
    // Keep process isolation and one worker. The package-level unit runner
    // closes and recreates the Vitest pool in small deterministic shards so the
    // growing Windows/jsdom suite cannot silently lose a late file to process
    // startup pressure. Targeted invocations still run exactly once.
    maxWorkers: 1,
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
