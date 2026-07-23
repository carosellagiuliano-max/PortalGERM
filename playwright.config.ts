import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PHASE17_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/phase17/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 12_000,
  },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["line"],
    [
      "html",
      {
        outputFolder: "playwright-report/phase17",
        open: "never",
      },
    ],
    ["./tests/e2e/reporter.ts"],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    headless: true,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    colorScheme: "light",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-journeys",
      grep: /@journey|@quality-desktop/u,
      use: {
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "chromium-mobile-360",
      grep: /@quality-mobile/u,
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
