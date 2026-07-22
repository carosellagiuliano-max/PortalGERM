import type { Metadata } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerEnvironment = vi.hoisted(() => vi.fn());
const buildPublicSitemap = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));
vi.mock("@/lib/seo/public-sitemap", () => ({ buildPublicSitemap }));

import { metadata as employerBrandingMetadata } from "@/app/(public)/employers/employer-branding/page";
import { metadata as employerDemoMetadata } from "@/app/(public)/employers/demo/page";
import { metadata as employersMetadata } from "@/app/(public)/employers/page";
import { metadata as postJobMetadata } from "@/app/(public)/employers/post-job/page";
import { metadata as talentRadarMetadata } from "@/app/(public)/employers/talent-radar/page";
import { metadata as xmlImportMetadata } from "@/app/(public)/employers/xml-import/page";
import { metadata as pricingMetadata } from "@/app/(public)/pricing/page";
import sitemap, {
  dynamic as sitemapDynamicMode,
  revalidate as sitemapRevalidate,
} from "@/app/sitemap";

const phase08Metadata = [
  {
    path: "/pricing",
    title: "Preise für Arbeitgeber",
    description:
      "Versionierte SwissTalentHub-Plan- und Produkthypothesen für Arbeitgeber transparent vergleichen.",
    metadata: pricingMetadata,
  },
  {
    path: "/employers",
    title: "Für Arbeitgeber",
    description:
      "SwissTalentHub als kontrollierten de-CH Pilot für transparente Stellen, faire Prozesse und kandidatenkontrollierte Kontakte kennenlernen.",
    metadata: employersMetadata,
  },
  {
    path: "/employers/post-job",
    title: "Transparentes Stelleninserat vorbereiten",
    description:
      "Den geplanten SwissTalentHub-Ablauf für strukturierte Stelleninserate und den Fair-Job-Score kennenlernen.",
    metadata: postJobMetadata,
  },
  {
    path: "/employers/talent-radar",
    title: "Talent Radar für Arbeitgeber",
    description:
      "Das geplante, kandidatenkontrollierte Talent-Radar-Modell mit anonymen Opt-in-Profilen und getrenntem Identitäts-Reveal verstehen.",
    metadata: talentRadarMetadata,
  },
  {
    path: "/employers/employer-branding",
    title: "Erweitertes Arbeitgeberprofil",
    description:
      "Eine sichere, schematische Vorschau der modellierten Felder eines erweiterten SwissTalentHub-Arbeitgeberprofils.",
    metadata: employerBrandingMetadata,
  },
  {
    path: "/employers/xml-import",
    title: "XML- und JSON-Stellenimport",
    description:
      "Den geplanten, rechtebasierten XML-/JSON-Import mit Quellenprüfung, Preview und kontrollierter Freigabe kennenlernen.",
    metadata: xmlImportMetadata,
  },
  {
    path: "/employers/demo",
    title: "Arbeitgeber-Demo anfragen",
    description:
      "Eine unverbindliche Arbeitgeber-Demo oder ein Paketgespräch bei SwissTalentHub anfragen.",
    metadata: employerDemoMetadata,
  },
] as const satisfies ReadonlyArray<{
  path: string;
  title: string;
  description: string;
  metadata: Metadata;
}>;

describe("Phase 08 metadata and sitemap policy", () => {
  beforeEach(() => {
    getServerEnvironment.mockReset();
    buildPublicSitemap.mockReset();
  });

  it("forces request-time sitemap evaluation for expiry and revocation freshness", () => {
    expect(sitemapDynamicMode).toBe("force-dynamic");
    expect(sitemapRevalidate).toBe(0);
  });

  it.each(phase08Metadata)(
    "exports complete child metadata for $path without forcing indexing",
    ({ path, title, description, metadata }) => {
      expect(metadata).toMatchObject({
        title,
        description,
        alternates: { canonical: path },
      });
      expect(metadata).not.toMatchObject({ robots: { index: true } });
      expect(metadata.robots).not.toBe("index");
    },
  );

  it("returns an empty sitemap in the local demo-data environment", async () => {
    getServerEnvironment.mockReturnValue({
      APP_ENV: "local",
      APP_URL: "http://localhost:3000",
    });

    await expect(sitemap()).resolves.toEqual([]);
    expect(buildPublicSitemap).not.toHaveBeenCalled();
  });

  it("delegates the production sitemap to the Phase 15 canonical assembler", async () => {
    const origin = "https://swisstalenthub.example";
    const assembled = [
      { url: `${origin}/` },
      { url: `${origin}/jobs` },
    ];
    getServerEnvironment.mockReturnValue({
      APP_ENV: "production",
      APP_URL: origin,
    });
    buildPublicSitemap.mockResolvedValue(assembled);

    await expect(sitemap()).resolves.toEqual(assembled);
    expect(buildPublicSitemap).toHaveBeenCalledWith({
      origin,
      now: expect.any(Date),
    });
  });
});
