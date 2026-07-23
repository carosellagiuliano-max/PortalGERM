// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  dynamic as resetPasswordDynamic,
  fetchCache as resetPasswordFetchCache,
  metadata as resetPasswordMetadata,
} from "@/app/(auth)/reset-password/page";
import {
  dynamic as unsubscribeDynamic,
  metadata as unsubscribeMetadata,
  revalidate as unsubscribeRevalidate,
} from "@/app/alerts/unsubscribe/[token]/page";
import {
  dynamic as adminDynamic,
  metadata as adminMetadata,
} from "@/app/admin/layout";
import {
  dynamic as candidateDynamic,
  metadata as candidateMetadata,
} from "@/app/candidate/layout";
import {
  dynamic as employerDynamic,
  metadata as employerMetadata,
} from "@/app/employer/layout";
import {
  dynamic as mockCheckoutDynamic,
  metadata as mockCheckoutMetadata,
  revalidate as mockCheckoutRevalidate,
} from "@/app/mock/checkout/[orderId]/page";
import {
  dynamic as supportCaseDynamic,
  metadata as supportCaseMetadata,
  revalidate as supportCaseRevalidate,
} from "@/app/support/[id]/page";
import { PRIVATE_ROBOTS_PATHS } from "@/app/robots";
import { PUBLIC_SITEMAP_STATIC_PATHS } from "@/lib/seo/public-sitemap";
import nextConfigFactory from "@/next.config";

const PORTAL_PATHS = ["candidate", "employer", "admin"] as const;
const SENSITIVE_HEADER_PATHS = [
  "/reset-password",
  "/session/clear",
  "/invite/:path*",
  "/support/:path*",
  "/alerts/unsubscribe/:path*",
  "/mock/checkout/:path*",
  "/dev/mailbox",
] as const;

describe("Phase-15 private and sensitive route contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["candidate", candidateMetadata, candidateDynamic],
    ["employer", employerMetadata, employerDynamic],
    ["admin", adminMetadata, adminDynamic],
  ])("keeps the %s layout dynamic and noindex,nofollow", (_name, metadata, dynamic) => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it.each([
    ["reset password", resetPasswordMetadata],
    ["support case", supportCaseMetadata],
    ["alert unsubscribe", unsubscribeMetadata],
    ["mock checkout", mockCheckoutMetadata],
  ])("keeps the %s metadata private without a canonical", (_name, metadata) => {
    expect(metadata).toMatchObject({
      referrer: "no-referrer",
      robots: { index: false, follow: false },
    });
    expect(metadata.alternates).toBeUndefined();
  });

  it("declares every sensitive page dynamic and no-store", () => {
    expect(resetPasswordDynamic).toBe("force-dynamic");
    expect(resetPasswordFetchCache).toBe("force-no-store");
    expect(supportCaseDynamic).toBe("force-dynamic");
    expect(supportCaseRevalidate).toBe(0);
    expect(unsubscribeDynamic).toBe("force-dynamic");
    expect(unsubscribeRevalidate).toBe(0);
    expect(mockCheckoutDynamic).toBe("force-dynamic");
    expect(mockCheckoutRevalidate).toBe(0);
  });

  it("applies no-store and X-Robots headers independently of HTML metadata", async () => {
    vi.stubEnv("APP_ENV", "local");
    const entries = await nextConfigFactory("test").headers?.();

    for (const area of PORTAL_PATHS) {
      const entry = entries?.find(({ source }) => source === `/${area}/:path*`);
      expect(entry?.headers).toEqual(
        expect.arrayContaining([
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet",
          },
        ]),
      );
    }

    for (const source of SENSITIVE_HEADER_PATHS) {
      const entry = entries?.find((candidate) => candidate.source === source);
      expect(entry?.headers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "Cache-Control" }),
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
        ]),
      );
      expect(
        entry?.headers.find(({ key }) => key === "Cache-Control")?.value,
      ).toContain("no-store");
    }
  });

  it("keeps personalized public job details private without conflating SEO", async () => {
    vi.stubEnv("APP_ENV", "local");
    const entries = await nextConfigFactory("test").headers?.();
    const detail = entries?.find(({ source }) => source === "/jobs/:slug");

    expect(detail?.headers).toEqual([
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ]);
    expect(detail?.headers.some(({ key }) => key === "X-Robots-Tag")).toBe(
      false,
    );
  });

  it("excludes every private namespace from robots and the sitemap allowlist", () => {
    expect(PRIVATE_ROBOTS_PATHS).toEqual(
      expect.arrayContaining([
        "/candidate/",
        "/employer/",
        "/admin/",
        "/reset-password",
        "/invite/",
        "/support/",
        "/alerts/unsubscribe/",
        "/mock/checkout/",
        "/dev/",
      ]),
    );

    for (const path of PUBLIC_SITEMAP_STATIC_PATHS) {
      expect(isPrivatePath(path)).toBe(false);
    }
  });
});

function isPrivatePath(path: string): boolean {
  return [
    "/candidate",
    "/employer",
    "/admin",
    "/reset-password",
    "/invite",
    "/support",
    "/alerts/unsubscribe",
    "/mock/checkout",
    "/dev",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
