// @vitest-environment node

import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RESERVED_ROUTE_HANDLER_ROLES,
  ROUTE_HANDLER_ROLES,
} from "@/scripts/route-handler-policy";

describe("route handler policy", () => {
  it("exhaustively classifies every implemented handler without a PUBLIC fallback", () => {
    const appDirectory = resolve(process.cwd(), "app");
    const observed = collectHandlers(appDirectory)
      .map((file) => routePath(appDirectory, file))
      .sort();
    const reviewed = [
      ...Object.keys(ROUTE_HANDLER_ROLES),
      ...Object.keys(RESERVED_ROUTE_HANDLER_ROLES).filter((path) =>
        observed.includes(path),
      ),
    ].sort();

    expect(reviewed).toEqual(observed);
    expect(
      Object.values({
        ...ROUTE_HANDLER_ROLES,
        ...RESERVED_ROUTE_HANDLER_ROLES,
      }).some((roles) =>
        (roles as readonly string[]).includes("PUBLIC"),
      ),
    ).toBe(false);
  });

  it("records the three non-heuristic authority boundaries explicitly", () => {
    expect(
      ROUTE_HANDLER_ROLES[
        "/api/company-verification/documents/upload-intents"
      ],
    ).toEqual(["EMPLOYER", "RECRUITER"]);
    expect(
      ROUTE_HANDLER_ROLES["/api/recruiting/interviews/[id]/calendar"],
    ).toEqual(["CANDIDATE", "EMPLOYER", "RECRUITER"]);
    expect(
      ROUTE_HANDLER_ROLES["/api/webhooks/payments/[provider]"],
    ).toEqual(["PAYMENT_PROVIDER_SIGNATURE"]);
    expect(RESERVED_ROUTE_HANDLER_ROLES).toEqual({
      "/api/webhooks/email/resend": ["EMAIL_PROVIDER_SIGNATURE"],
    });
  });
});

function collectHandlers(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectHandlers(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

function routePath(appDirectory: string, file: string): string {
  const segments = relative(appDirectory, file)
    .replaceAll("\\", "/")
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/u.test(segment));
  return `/${segments.join("/")}`.replace(/\/$/u, "") || "/";
}
