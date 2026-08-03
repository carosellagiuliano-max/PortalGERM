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
    // Keep file isolation and serialize execution. The package-level unit
    // runner closes and recreates the Vitest pool after at most three explicit
    // files so Windows worker-start pressure cannot silently lose a late file.
    // Targeted invocations still run exactly once.
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
