import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_CAPABILITIES_V1,
  PHASE_11_FORBIDDEN_ADMIN_CAPABILITIES,
  canRunLicensedSupplyImport,
  canUseEmployerImport,
  hasAdminCapability,
} from "@/lib/admin/capabilities";
import { sanitizeAdminMarkdown } from "@/lib/admin/content";
import {
  LICENSED_FEED_FIELDS,
  parseLicensedFeedPayload,
} from "@/lib/admin/imports";
import {
  OPS_CASE_SLA_HOURS,
  OPS_CASE_SLA_POLICY_VERSION,
  slaDueAt,
  slaThreshold,
  tightenSlaDueAt,
} from "@/lib/admin/sla";
import { ADMIN_NAVIGATION } from "@/components/admin/Sidebar";

const activeAdmin = Object.freeze({
  userId: "11000000-0000-4000-8000-000000000001",
  role: "ADMIN",
  status: "ACTIVE",
});

describe("Phase 11 admin policy boundary", () => {
  it("grants every named operation only to an active Platform Admin", () => {
    for (const capability of ADMIN_CAPABILITIES_V1) {
      expect(hasAdminCapability(activeAdmin, capability)).toBe(true);
      expect(
        hasAdminCapability({ ...activeAdmin, role: "EMPLOYER" }, capability),
      ).toBe(false);
      expect(
        hasAdminCapability({ ...activeAdmin, status: "SUSPENDED" }, capability),
      ).toBe(false);
    }
    expect(canRunLicensedSupplyImport(activeAdmin)).toBe(true);
    expect(canUseEmployerImport()).toBe(false);
    expect(PHASE_11_FORBIDDEN_ADMIN_CAPABILITIES).toEqual([
      "ADMIN_BILLING_MUTATE",
      "ADMIN_CATALOG_MUTATE",
      "ADMIN_INVOICE_MUTATE",
      "ADMIN_CREDITS_GRANT",
      "ADMIN_GLOBAL_ROLE_MUTATE",
    ]);
  });

  it("preserves the global-role boundary after Phase 12 adds its owned billing routes", () => {
    const root = process.cwd();
    for (const route of ["billing", "orders", "invoices", "plans", "products"]) {
      expect(existsSync(join(root, "app", "admin", route))).toBe(true);
    }
    for (const route of ["billing", "plans", "products"]) expect(ADMIN_NAVIGATION.some(({ href }) => href === `/admin/${route}`)).toBe(true);
    const actions = readFileSync(join(root, "app", "admin", "actions.ts"), "utf8");
    expect(actions).not.toContain("global-role");
    expect(actions).not.toContain("ADMIN_GLOBAL_ROLE_MUTATE");
    expect(ADMIN_NAVIGATION.map(({ href }) => href)).toEqual([
      "/admin",
      "/admin/jobs",
      "/admin/companies",
      "/admin/users",
      "/admin/taxonomy",
      "/admin/reports",
      "/admin/imports",
      "/admin/support",
      "/admin/content",
      "/admin/leads",
      "/admin/billing",
      "/admin/plans",
      "/admin/products",
      "/admin/analytics",
      "/admin/business-cockpit",
    ]);
  });
});

describe("OPS_CASE_SLA_POLICY_V1", () => {
  it("uses the exact elapsed-hour targets", () => {
    expect(OPS_CASE_SLA_POLICY_VERSION).toBe("OPS_CASE_SLA_POLICY_V1");
    expect(OPS_CASE_SLA_HOURS).toEqual({
      ABUSE_CRITICAL: 1,
      ABUSE_HIGH: 4,
      ABUSE_MEDIUM: 24,
      ABUSE_LOW: 72,
      SUPPORT_URGENT: 4,
      SUPPORT_HIGH: 8,
      SUPPORT_NORMAL: 24,
      SUPPORT_LOW: 72,
      JOB_REVIEW: 48,
      COMPANY_CLAIM: 72,
      COMPANY_VERIFICATION: 72,
      IMPORT_FAILURE: 4,
      LEAD_FIRST_ACTION: 24,
    });
  });

  it("has exact, timezone-independent warning and overdue boundaries", () => {
    const createdAt = new Date("2026-03-29T00:30:00.000Z");
    const dueAt = slaDueAt(createdAt, "SUPPORT_URGENT");
    expect(dueAt.toISOString()).toBe("2026-03-29T04:30:00.000Z");
    expect(slaThreshold(createdAt, dueAt, new Date("2026-03-29T03:29:59.999Z"))).toBe("NONE");
    expect(slaThreshold(createdAt, dueAt, new Date("2026-03-29T03:30:00.000Z"))).toBe("WARNING_75");
    expect(slaThreshold(createdAt, dueAt, new Date("2026-03-29T04:30:00.000Z"))).toBe("OVERDUE");
    expect(tightenSlaDueAt(slaDueAt(createdAt, "ABUSE_LOW"), createdAt, "ABUSE_HIGH")).toEqual(slaDueAt(createdAt, "ABUSE_HIGH"));
    expect(tightenSlaDueAt(slaDueAt(createdAt, "ABUSE_HIGH"), createdAt, "ABUSE_LOW")).toEqual(slaDueAt(createdAt, "ABUSE_HIGH"));
  });
});

describe("Phase 11 licensed local import parser", () => {
  it("parses the complete JSON and XML field contract without network fetching", () => {
    expect(LICENSED_FEED_FIELDS).toEqual([
      "id", "company", "title", "workplace_country", "zip", "city", "canton",
      "description", "requirements", "offer", "contact", "application_url", "type",
      "workload_min", "workload_max", "keywords",
    ]);
    const jsonRows = parseLicensedFeedPayload("JSON", JSON.stringify([{ id: "local-1", title: "Local" }]));
    expect(jsonRows).toEqual([{ id: "local-1", title: "Local" }]);
    const xmlRows = parseLicensedFeedPayload(
      "XML",
      "<jobs><job><id>local-2</id><company>Demo &amp; Co</company><title>Pflege</title><description>Lokale Vorschau</description></job></jobs>",
    );
    expect(xmlRows).toEqual([{ id: "local-2", company: "Demo & Co", title: "Pflege", description: "Lokale Vorschau" }]);
  });

  it("rejects entity expansion, mismatched XML, excessive depth and unbounded feeds", () => {
    expect(() => parseLicensedFeedPayload("XML", '<!DOCTYPE jobs [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><jobs><job><id>&xxe;</id></job></jobs>')).toThrow("UNSAFE_XML");
    expect(() => parseLicensedFeedPayload("XML", "<jobs><job></item></jobs>")).toThrow("XML_STRUCTURE");
    const deep = `${"<x>".repeat(13)}<job><id>x</id></job>${"</x>".repeat(13)}`;
    expect(() => parseLicensedFeedPayload("XML", deep)).toThrow("XML_DEPTH");
    expect(() => parseLicensedFeedPayload("JSON", JSON.stringify(Array.from({ length: 501 }, (_, id) => ({ id }))))).toThrow("INVALID_JSON_FEED");
  });
});

describe("Phase 11 content sanitizer", () => {
  it("removes executable HTML, image embeds and unsafe Markdown schemes", () => {
    const clean = sanitizeAdminMarkdown(
      '# Titel\n<script>alert(1)</script>\n![secret](https://evil.example/a.png)\n[click](javascript:alert(1))\n<a onerror="alert(1)">Text</a>',
    );
    expect(clean).not.toMatch(/<script|onerror|javascript:|!\[/iu);
    expect(clean).toContain("Titel");
    expect(clean).toContain("Text");
  });
});
