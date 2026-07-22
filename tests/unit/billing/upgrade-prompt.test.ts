import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildCatalogUpgradePrompt,
  buildUpgradePrompt,
} from "@/lib/billing/upgrade-prompt";

const NOW = new Date("2026-07-21T12:00:00.000Z");

function catalogDatabase() {
  return {
    planVersion: { findMany: vi.fn() },
    productVersion: { findMany: vi.fn() },
  };
}

const PRO_VERSION = Object.freeze({
  priceMode: "FIXED",
  billingInterval: "MONTHLY",
  termMonths: 1,
  netPriceRappen: 24_900,
  currency: "CHF",
  plan: Object.freeze({ code: "PRO", name: "Pro Katalog" }),
});

const CONTACT_PACK_VERSION = Object.freeze({
  netPriceRappen: 19_900,
  currency: "CHF",
  product: Object.freeze({
    code: "contact-pack-10",
    name: "Kontaktpaket 10",
  }),
});

describe("billing upgrade prompt allowlist", () => {
  it("maps the seat limit to the literal Pro checkout target", () => {
    expect(
      buildUpgradePrompt({ reason: "SEAT_LIMIT_REACHED", suggestedPlanSlug: "pro" }),
    ).toMatchObject({
      title: "Sitzplatzlimit erreicht",
      cta: {
        href: "/employer/billing/checkout?plan=pro",
        label: "Pro-Upgrade ansehen",
      },
    });
  });

  it.each(["boost-7d", "boost-30d", "import-setup"])(
    "never opens checkout for deferred product %s",
    (suggestedProductSlug) => {
      const prompt = buildUpgradePrompt({
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        suggestedPlanSlug: "pro",
        suggestedProductSlug,
      });
      expect(prompt.cta.href).toBe("/employer/billing");
      expect(prompt.cta.href).not.toContain("checkout");
    },
  );

  it("opens Additional Job checkout only with an allowlisted UUID target", () => {
    const targetJobId = "50000000-0000-4000-8000-000000000001";
    expect(
      buildUpgradePrompt({
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        suggestedProductSlug: "additional-job-30d",
        targetJobId,
        actorRole: "OWNER",
      }).cta,
    ).toEqual({
      href: `/employer/billing/checkout?product=additional-job-30d&job=${targetJobId}`,
      label: "Zusatzstelle ansehen",
    });
    expect(
      buildUpgradePrompt({
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        suggestedProductSlug: "additional-job-30d",
        targetJobId: "../foreign-job",
        actorRole: "OWNER",
      }).cta.href,
    ).toBe("/employer/billing");
  });

  it("allows only released contact-pack literals and rejects injected or unknown slugs", () => {
    expect(
      buildUpgradePrompt({
        reason: "CONTACT_FUNDING_UNAVAILABLE",
        suggestedProductSlug: "contact-pack-10",
      }).cta.href,
    ).toBe("/employer/billing/checkout?product=contact-pack-10");

    expect(
      buildUpgradePrompt({
        reason: "CONTACT_FUNDING_UNAVAILABLE",
        suggestedProductSlug: "contact-pack-10&next=https://evil.example",
      }).cta.href,
    ).toBe("/pricing");
    expect(
      buildUpgradePrompt({
        reason: "SEAT_LIMIT_REACHED",
        suggestedPlanSlug: "starter",
      }).cta.href,
    ).toBe("/pricing");
  });

  it("keeps plan checkout Owner-only and gives Admins a working comparison route", () => {
    expect(
      buildUpgradePrompt({
        reason: "SEAT_LIMIT_REACHED",
        suggestedPlanSlug: "pro",
        actorRole: "ADMIN",
      }).cta,
    ).toEqual({ href: "/pricing", label: "Pläne vergleichen" });
  });

  it("does not send Recruiters into the protected Billing area", () => {
    expect(
      buildUpgradePrompt({
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        suggestedProductSlug: "additional-job-30d",
        suggestedPlanSlug: "pro",
        actorRole: "RECRUITER",
      }).cta,
    ).toEqual({ href: "/pricing", label: "Pläne vergleichen" });
  });

  it("still permits Owner and Admin purchases of released one-time products", () => {
    for (const actorRole of ["OWNER", "ADMIN"] as const) {
      expect(
        buildUpgradePrompt({
          reason: "CONTACT_FUNDING_UNAVAILABLE",
          suggestedProductSlug: "contact-pack-10",
          actorRole,
        }).cta.href,
      ).toBe("/employer/billing/checkout?product=contact-pack-10");
    }
  });
});

describe("server-side catalog upgrade prompt", () => {
  it("uses exactly one effective public self-service PlanVersion snapshot", async () => {
    const database = catalogDatabase();
    database.planVersion.findMany.mockResolvedValue([PRO_VERSION]);

    const prompt = await buildCatalogUpgradePrompt(
      {
        reason: "SEAT_LIMIT_REACHED",
        suggestedPlanSlug: "pro",
        actorRole: "OWNER",
      },
      { database: database as never, now: NOW },
    );

    expect(prompt.description).toContain(
      "Pro Katalog für CHF 249.00 netto pro Monat",
    );
    expect(prompt.cta).toEqual({
      href: "/employer/billing/checkout?plan=pro",
      label: "Pro Katalog-Upgrade ansehen",
    });
    expect(database.planVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          isPublic: true,
          isSelfService: true,
          validFrom: { lte: NOW },
          AND: [{ OR: [{ validTo: null }, { validTo: { gt: NOW } }] }],
          plan: { code: "PRO" },
        }),
        take: 2,
      }),
    );
    expect(database.productVersion.findMany).not.toHaveBeenCalled();
  });

  it("uses the effective ProductVersion snapshot for an Admin-safe one-time purchase", async () => {
    const database = catalogDatabase();
    database.productVersion.findMany.mockResolvedValue([CONTACT_PACK_VERSION]);

    const prompt = await buildCatalogUpgradePrompt(
      {
        reason: "CONTACT_FUNDING_UNAVAILABLE",
        suggestedProductSlug: "contact-pack-10",
        actorRole: "ADMIN",
      },
      { database: database as never, now: NOW },
    );

    expect(prompt.description).toContain(
      "Kontaktpaket 10 für CHF 199.00 netto",
    );
    expect(prompt.cta).toEqual({
      href: "/employer/billing/checkout?product=contact-pack-10",
      label: "Kontaktpaket 10 kaufen",
    });
    expect(database.productVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
  });

  it.each([
    ["zero", []],
    ["ambiguous", [PRO_VERSION, PRO_VERSION]],
  ])("fails closed for %s effective plan versions", async (_case, rows) => {
    const database = catalogDatabase();
    database.planVersion.findMany.mockResolvedValue(rows);

    const prompt = await buildCatalogUpgradePrompt(
      {
        reason: "ADVANCED_ANALYTICS_NOT_INCLUDED",
        suggestedPlanSlug: "pro",
        actorRole: "OWNER",
      },
      { database: database as never, now: NOW },
    );

    expect(prompt.cta).toEqual({
      href: "/pricing",
      label: "Pläne vergleichen",
    });
    expect(prompt.description).not.toContain("CHF");
  });

  it("fails closed instead of choosing an ambiguous effective ProductVersion", async () => {
    const database = catalogDatabase();
    database.productVersion.findMany.mockResolvedValue([
      CONTACT_PACK_VERSION,
      CONTACT_PACK_VERSION,
    ]);

    const prompt = await buildCatalogUpgradePrompt(
      {
        reason: "CONTACT_FUNDING_UNAVAILABLE",
        suggestedProductSlug: "contact-pack-10",
        actorRole: "OWNER",
      },
      { database: database as never, now: NOW },
    );

    expect(prompt.cta).toEqual({
      href: "/pricing",
      label: "Pläne vergleichen",
    });
    expect(prompt.description).not.toContain("CHF");
  });

  it("keeps plan checkout Owner-only and all protected billing routes away from Recruiter and Viewer", async () => {
    for (const actorRole of ["ADMIN", "RECRUITER", "VIEWER"] as const) {
      const database = catalogDatabase();
      database.planVersion.findMany.mockResolvedValue([PRO_VERSION]);
      const prompt = await buildCatalogUpgradePrompt(
        {
          reason: "SEAT_LIMIT_REACHED",
          suggestedPlanSlug: "pro",
          actorRole,
        },
        { database: database as never, now: NOW },
      );
      expect(prompt.cta.href).toBe("/pricing");
      expect(database.planVersion.findMany).not.toHaveBeenCalled();
    }

    const database = catalogDatabase();
    database.productVersion.findMany.mockResolvedValue([CONTACT_PACK_VERSION]);
    const recruiterPrompt = await buildCatalogUpgradePrompt(
      {
        reason: "CONTACT_FUNDING_UNAVAILABLE",
        suggestedProductSlug: "contact-pack-10",
        actorRole: "RECRUITER",
      },
      { database: database as never, now: NOW },
    );
    expect(recruiterPrompt.cta.href).toBe("/pricing");
    expect(database.productVersion.findMany).not.toHaveBeenCalled();
  });
});
