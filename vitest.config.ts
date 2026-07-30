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
    // The 310-file suite keeps fork isolation, so Vitest starts a fresh Node
    // process per file. One worker prevents concurrent clean-clone/jsdom
    // startup pressure from losing a file before collection on Windows while
    // preserving every test, assertion and per-test timeout.
    maxWorkers: 1,
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
