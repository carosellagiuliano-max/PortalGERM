import { writeFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { createDatabaseClient } from "@/lib/db/factory";

export const DEMO_PASSWORD = "Demo12345!" as const;
export const PHASE17_CANDIDATE = Object.freeze({
  email: "phase17-candidate@example.test",
  name: "Elina Prüfpfad",
  firstName: "Elina",
  lastName: "Prüfpfad",
  password: "Phase17!Safe123",
  uniqueSkill: "Italienisch im Kundendienst",
});
export const DEMO_ACCOUNTS = Object.freeze({
  candidate: "candidate@demo.ch",
  employer: "employer@demo.ch",
  recruiter: "recruiter@demo.ch",
  admin: "admin@demo.ch",
});

type Phase17Fixtures = Readonly<{
  pageObservation: PageObservation;
}>;

export const test = base.extend<Phase17Fixtures>({
  pageObservation: [
    async ({ page }, use) => {
      const observation = await observePage(page);
      await use(observation);
      observation.assertClean();
    },
    { auto: true },
  ],
});

export { expect };

export type PageObservation = Readonly<{
  assertClean: () => void;
  clear: () => void;
  failures: () => readonly string[];
}>;

export type BrowserActor = Readonly<{
  context: BrowserContext;
  page: Page;
  observation: PageObservation;
  close: () => Promise<void>;
}>;

export async function observePage(page: Page): Promise<PageObservation> {
  const failures: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
      !isLoopback(url.hostname)
    ) {
      failures.push(`External browser request blocked: ${url.hostname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  page.on("pageerror", (error) => {
    failures.push(`Uncaught page error: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isCriticalConsoleMessage(text)) {
      failures.push(`Critical console error: ${text}`);
    }
  });
  return Object.freeze({
    assertClean() {
      expect(failures, failures.join("\n")).toEqual([]);
    },
    clear() {
      failures.length = 0;
    },
    failures() {
      return Object.freeze([...failures]);
    },
  });
}

export async function openActor(
  browser: Browser,
  email: string,
  password = DEMO_PASSWORD,
): Promise<BrowserActor> {
  const context = await browser.newContext({
    baseURL: requiredEnvironment("PHASE17_BASE_URL"),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    colorScheme: "light",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const observation = await observePage(page);
  await login(page, email, password);
  return Object.freeze({
    context,
    page,
    observation,
    async close() {
      observation.assertClean();
      await context.close();
    },
  });
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sicher anmelden" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

export function phase17Database() {
  return createDatabaseClient(requiredEnvironment("DATABASE_URL"));
}

export async function advanceServerClock(days: number) {
  if (!Number.isSafeInteger(days) || days <= 0 || days > 365) {
    throw new TypeError("Phase 17 logical clock days must be within 1..365.");
  }
  const path = requiredEnvironment("PHASE17_CLOCK_FILE");
  const offsetMilliseconds = days * 24 * 60 * 60 * 1_000;
  writeServerClock(path, offsetMilliseconds, "E2E-04 recontact cooldown");
  return offsetMilliseconds;
}

export function resetServerClock() {
  writeServerClock(
    requiredEnvironment("PHASE17_CLOCK_FILE"),
    0,
    "Phase 17 deterministic baseline",
  );
}

export async function assertCriticalAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const critical = result.violations.filter(
    (violation) => violation.impact === "critical",
  );
  expect(
    critical.map((violation) => ({
      id: violation.id,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  return Object.freeze({
    critical: critical.length,
    serious: result.violations.filter(
      (violation) => violation.impact === "serious",
    ).length,
    total: result.violations.length,
  });
}

export async function assertNoViewportClipping(page: Page) {
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const intentionallyScrollable = new Set(
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-e2e-horizontal-scroll="true"]'),
      ),
    );
    const clipped: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])",
    )) {
      if (
        element.closest('[aria-hidden="true"]') !== null ||
        element.closest("details:not([open])") !== null ||
        element.hidden ||
        getComputedStyle(element).visibility === "hidden"
      ) {
        continue;
      }
      const rectangle = element.getBoundingClientRect();
      if (rectangle.width === 0 || rectangle.height === 0) continue;
      if (
        rectangle.left < -1 ||
        rectangle.right > viewportWidth + 1
      ) {
        const scrollOwner = element.closest<HTMLElement>(
          '[data-e2e-horizontal-scroll="true"]',
        );
        if (scrollOwner === null || !intentionallyScrollable.has(scrollOwner)) {
          clipped.push(
            `${element.tagName.toLowerCase()}#${element.id || "-"}:${element.textContent?.trim().slice(0, 60) ?? ""}`,
          );
        }
      }
    }
    return Object.freeze({
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      clipped,
    });
  });
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth);
  expect(result.clipped).toEqual([]);
}

export async function assertKeyboardFocusVisible(page: Page) {
  await page.keyboard.press("Tab");
  const active = page.locator(":focus");
  await expect(active).toBeVisible();
  const focusStyle = await active.evaluate((element) => {
    const style = getComputedStyle(element);
    return Object.freeze({
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    });
  });
  expect(
    focusStyle.outlineStyle !== "none" ||
      focusStyle.outlineWidth !== "0px" ||
      focusStyle.boxShadow !== "none",
  ).toBe(true);
}

function isLoopback(hostname: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
}

function isCriticalConsoleMessage(value: string) {
  return [
    /content security policy/iu,
    /refused to (?:execute|load|connect|frame)/iu,
    /uncaught/iu,
    /hydration (?:failed|error|mismatch)/iu,
    /phase17_external_network_blocked/iu,
    /error occurred in the server components render/iu,
  ].some((pattern) => pattern.test(value));
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 17 browser suite.`);
  }
  return value;
}

function writeServerClock(
  path: string,
  offsetMilliseconds: number,
  reason: string,
) {
  writeFileSync(
    path,
    `${JSON.stringify({
      offsetMilliseconds,
      reason,
      contract: "server-logical-clock-v1",
    })}\n`,
    "utf8",
  );
}
