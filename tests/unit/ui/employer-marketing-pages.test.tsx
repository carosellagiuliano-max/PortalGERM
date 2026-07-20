import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import EmployerBrandingMarketingPage, {
  metadata as employerBrandingMetadata,
} from "@/app/(public)/employers/employer-branding/page";
import EmployerMarketingLayout from "@/app/(public)/employers/layout";
import EmployersPage, {
  metadata as employersMetadata,
} from "@/app/(public)/employers/page";
import PostJobMarketingPage, {
  metadata as postJobMetadata,
} from "@/app/(public)/employers/post-job/page";
import TalentRadarMarketingPage, {
  metadata as talentRadarMetadata,
} from "@/app/(public)/employers/talent-radar/page";
import XmlImportMarketingPage, {
  metadata as xmlImportMetadata,
} from "@/app/(public)/employers/xml-import/page";
import {
  FAIR_JOB_FACTOR_ORDER_V2,
  FAIR_JOB_FACTOR_POINTS_V2,
  FAIR_JOB_SCORE_VERSION,
} from "@/lib/scoring/fair-job-score";

const marketingPages: ReadonlyArray<readonly [string, () => ReactElement]> = [
  ["overview", () => <EmployersPage />],
  ["post-job", () => <PostJobMarketingPage />],
  ["talent-radar", () => <TalentRadarMarketingPage />],
  ["employer-branding", () => <EmployerBrandingMarketingPage />],
  ["xml-import", () => <XmlImportMarketingPage />],
];

describe("Phase 08 employer marketing pages", () => {
  it("publishes the intended canonical paths", () => {
    expect(employersMetadata).toMatchObject({
      alternates: { canonical: "/employers" },
    });
    expect(postJobMetadata).toMatchObject({
      alternates: { canonical: "/employers/post-job" },
    });
    expect(talentRadarMetadata).toMatchObject({
      alternates: { canonical: "/employers/talent-radar" },
    });
    expect(employerBrandingMetadata).toMatchObject({
      alternates: { canonical: "/employers/employer-branding" },
    });
    expect(xmlImportMetadata).toMatchObject({
      alternates: { canonical: "/employers/xml-import" },
    });
  });

  it("keeps the employer subnavigation on real Phase 08 destinations", () => {
    render(
      <EmployerMarketingLayout>
        <p>Seiteninhalt</p>
      </EmployerMarketingLayout>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Arbeitgeber-Angebot",
    });
    const expectedTargets = [
      ["Überblick", "/employers"],
      ["Inserat", "/employers/post-job"],
      ["Talent Radar", "/employers/talent-radar"],
      ["Firmenprofil", "/employers/employer-branding"],
      ["Import", "/employers/xml-import"],
      ["Demo", "/employers/demo"],
    ] as const;

    for (const [label, href] of expectedTargets) {
      expect(within(navigation).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(screen.getByText("Seiteninhalt")).toBeInTheDocument();
  });

  it("uses honest pilot copy and only established overview CTAs", () => {
    render(<EmployersPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Bessere Bewerbungen. Faires Recruiting. Im kontrollierten de-CH Pilot.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Launchhypothese im Aufbau/)).toBeInTheDocument();
    expect(screen.getByText(/keine Behauptung nationaler Reichweite/)).toBeInTheDocument();
    expect(screen.getByText(/erklärtes Antwortziel/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /Fairness wird erklärt/ }),
    ).toBeInTheDocument();
    for (const reason of [
      "Fair Hiring statt Black Box",
      "Antwortsignal nur mit Evidenz",
      "Anonymer Talentpool",
      "Geführter Posting-Einstieg",
    ]) {
      expect(screen.getByRole("heading", { level: 3, name: reason })).toBeInTheDocument();
    }
    expect(screen.getByText(/Der Mock zeigt kein erfundenes Badge/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kostenlos starten" })).toHaveAttribute(
      "href",
      "/register/employer",
    );
    for (const demoLink of screen.getAllByRole("link", { name: "Demo anfragen" })) {
      expect(demoLink).toHaveAttribute("href", "/employers/demo");
    }
  });

  it("renders the versioned Fair Job Score constants instead of invented values", () => {
    const expectedPoints = {
      SALARY: 25,
      TASKS_REQUIREMENTS: 15,
      WORKLOAD_CONTRACT_START: 15,
      LOCATION_REMOTE: 10,
      APPLICATION_PROCESS: 10,
      RESPONSE_TARGET: 10,
      BENEFITS: 5,
      INCLUSION_CONTACT: 5,
      FRESHNESS: 5,
    } as const;
    const labels = {
      SALARY: "Lohnspanne",
      TASKS_REQUIREMENTS: "Aufgaben und Anforderungen",
      WORKLOAD_CONTRACT_START: "Pensum, Vertrag und Start",
      LOCATION_REMOTE: "Arbeitsort und Remote-Modell",
      APPLICATION_PROCESS: "Bewerbungsprozess",
      RESPONSE_TARGET: "Antwortziel",
      BENEFITS: "Konkrete Benefits",
      INCLUSION_CONTACT: "Inklusion und Kontakt",
      FRESHNESS: "Aktualität",
    } as const;

    expect(FAIR_JOB_SCORE_VERSION).toBe("v2");
    expect(FAIR_JOB_FACTOR_POINTS_V2).toEqual(expectedPoints);
    expect(
      FAIR_JOB_FACTOR_ORDER_V2.reduce(
        (total, factor) => total + FAIR_JOB_FACTOR_POINTS_V2[factor],
        0,
      ),
    ).toBe(100);

    render(<PostJobMarketingPage />);

    expect(screen.getByText("Fair-Job-Score v2")).toBeInTheDocument();
    expect(screen.getByText(/kein interaktiver Jobeditor/)).toBeInTheDocument();
    const scoreCard = screen
      .getByRole("heading", { name: "Faktoren und Maximalpunkte" })
      .closest<HTMLElement>('[data-slot="card"]');
    expect(scoreCard).not.toBeNull();
    if (scoreCard === null) {
      throw new Error("The Fair Job Score card is missing.");
    }
    const scoreTable = within(scoreCard);
    for (const factor of FAIR_JOB_FACTOR_ORDER_V2) {
      const factorRow = scoreTable.getByText(labels[factor]).closest("div");
      expect(factorRow).not.toBeNull();
      expect(factorRow).toHaveTextContent(`${expectedPoints[factor]} Punkte`);
    }
    expect(
      screen.getByRole("link", { name: "Ablauf besprechen" }),
    ).toHaveAttribute("href", "/employers/demo?interest=general");
  });

  it("marks the Talent Radar preview as locked, anonymous and illustrative", () => {
    render(<TalentRadarMarketingPage />);

    expect(
      screen.getByRole("img", {
        name: "Gesperrte schematische Vorschau anonymer Talentprofile",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vorschau gesperrt")).toBeInTheDocument();
    expect(screen.getByText(/keine realen Kandidatenprofile/)).toBeInTheDocument();
    expect(screen.getByText(/Contact Packs sind nur Add-ons/)).toBeInTheDocument();
    expect(screen.getByText(/schalten die Suche nicht frei/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Interesse anmelden" })).toHaveAttribute(
      "href",
      "/employers/demo?interest=pro",
    );
  });

  it("marks the employer profile as a schematic model without fake proof", () => {
    render(<EmployerBrandingMarketingPage />);

    expect(screen.getByText("Schematische Demo")).toBeInTheDocument();
    expect(screen.getByText(/Rein schematische, modellkonforme Ansicht/)).toBeInTheDocument();
    expect(screen.getByText(/keine reale Firma, kein echtes Logo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profil besprechen" })).toHaveAttribute(
      "href",
      "/employers/demo?interest=pro",
    );
  });

  it("keeps import interest-only and never presents it as an active entitlement", () => {
    render(<XmlImportMarketingPage />);

    expect(screen.getByText(/P1-Hypothese/)).toBeInTheDocument();
    expect(screen.getByText(/weder freigeschaltet noch kaufbar/)).toBeInTheDocument();
    expect(screen.getByText(/Keine Auto-Publikation/)).toBeInTheDocument();
    for (const importLink of screen.getAllByRole("link", { name: "Import besprechen" })) {
      expect(importLink).toHaveAttribute(
        "href",
        "/employers/demo?interest=import",
      );
    }
  });

  it("contains no dead editor link or unsupported positive claims", () => {
    const forbiddenPositiveClaims = [
      /schweizweit verfügbar/i,
      /garantierte (?:Bewerbungen|Einstellungen|Reichweite)/i,
      /vollständig DSG-konform/i,
      /sofortiger Radarzugriff/i,
      /jetzt für CHF 750 (?:kaufen|aktivieren)/i,
    ] as const;

    for (const [name, createPage] of marketingPages) {
      const { container, unmount } = render(createPage());
      const copy = container.textContent ?? "";
      const targets = Array.from(container.querySelectorAll("a"), (link) =>
        link.getAttribute("href"),
      );

      expect(targets, `${name} contains the dead job editor link`).not.toContain(
        "/employer/jobs/new",
      );
      for (const forbiddenClaim of forbiddenPositiveClaims) {
        expect(copy, `${name} contains ${forbiddenClaim.source}`).not.toMatch(
          forbiddenClaim,
        );
      }
      unmount();
    }
  });
});
