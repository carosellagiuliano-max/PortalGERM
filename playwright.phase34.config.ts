import { defineConfig, devices } from "@playwright/test";

import { phase34LocalSourceIp } from "./tests/e2e/fixtures/phase34-network";

const baseURL = process.env.PHASE34_LOCAL_BASE_URL ?? "http://127.0.0.1:3000";
const trustBaseURL =
  process.env.PHASE34_TRUST_BASE_URL ?? "http://127.0.0.1:3000";
const coreTestMatch = "flows/phase34-*.spec.ts";
const chromiumStatefulTestMatch = [
  coreTestMatch,
  "flows/phase17-journeys.spec.ts",
  "flows/phase17-billing.spec.ts",
  "flows/phase17-talent-radar.spec.ts",
  "flows/phase21-document-vault.spec.ts",
  "flows/phase24-paid-checkout.spec.ts",
];

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: chromiumStatefulTestMatch,
  outputDir: "test-results/phase34/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: true,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report/phase34", open: "never" }],
    ["./tests/e2e/phase34-reporter.ts"],
  ],
  use: {
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
      name: "chromium-phase34",
      grep: /@phase34/u,
      use: {
        ...devices["Desktop Chrome"],
        extraHTTPHeaders: {
          "x-forwarded-for": phase34LocalSourceIp("chromium-phase34"),
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "chromium-phase34-trust",
      testMatch: "flows/phase17-employer-publish.spec.ts",
      grep: /@phase34/u,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: trustBaseURL,
        extraHTTPHeaders: {
          "x-forwarded-for": phase34LocalSourceIp("chromium-phase34-trust"),
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "firefox-phase34",
      testMatch: coreTestMatch,
      grep: /@phase34/u,
      use: {
        ...devices["Desktop Firefox"],
        extraHTTPHeaders: {
          "x-forwarded-for": phase34LocalSourceIp("firefox-phase34"),
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "webkit-phase34",
      testMatch: coreTestMatch,
      grep: /@phase34/u,
      use: {
        ...devices["Desktop Safari"],
        extraHTTPHeaders: {
          "x-forwarded-for": phase34LocalSourceIp("webkit-phase34"),
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
  ],
});
