export type OccupationReportingResult =
  | "REQUIRES_REPORTING"
  | "NOT_REQUIRED"
  | "UNKNOWN";

export const JOBROOM_LEGAL_DISCLAIMER =
  "Dieser Check ist eine Orientierung und keine Rechtsberatung. Bitte prüfen Sie meldepflichtige Stellen offiziell.";

export const JOBROOM_OFFICIAL_SOURCE_URL =
  "https://www.arbeit.swiss/de/arbeitgebende/stellenmeldepflicht-2026";

export const JOBROOM_MOCK_SOURCE =
  "SwissTalentHub: geprüfte fiktive CH-ISCO-Mock-Klassifikation 2026";

export interface OccupationCodeFixtureEntry {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly result: OccupationReportingResult;
  readonly classificationStatus: "RESOLVED" | "AMBIGUOUS";
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

export interface OccupationCodeDatasetFixture {
  readonly datasetKey: string;
  readonly datasetVersion: string;
  readonly dataYear: number;
  readonly source: string;
  readonly sourceUrl: string;
  readonly disclaimer: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly occupationCodes: readonly OccupationCodeFixtureEntry[];
}

export const JOBROOM_FIXTURE_IDS = Object.freeze({
  requiresReporting: "b7b7d035-6fd5-4f9c-8f31-000000000001",
  notRequired: "b7b7d035-6fd5-4f9c-8f31-000000000002",
  sourceUnknown: "b7b7d035-6fd5-4f9c-8f31-000000000003",
  ambiguous: "b7b7d035-6fd5-4f9c-8f31-000000000004",
  stale: "b7b7d035-6fd5-4f9c-8f31-000000000005",
});

const CURRENT_FROM = "2026-01-01T00:00:00.000Z";
const CURRENT_TO = "2027-01-01T00:00:00.000Z";

interface OccupationDefinition {
  readonly code: string;
  readonly label: string;
  readonly result: OccupationReportingResult;
  readonly classificationStatus?: "RESOLVED" | "AMBIGUOUS";
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

const OCCUPATION_DEFINITIONS = [
  { code: "MOCK-CHISCO-0001", label: "Demo-Montagehilfe Leichtbau", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0002", label: "Demo-Fachperson digitale Dienste", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0003", label: "Demo-Berufsart mit ungeklärtem Ergebnis", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0004", label: "Mehrdeutige Demo-Hybridfunktion", result: "UNKNOWN", classificationStatus: "AMBIGUOUS" },
  { code: "MOCK-CHISCO-0005", label: "Abgelaufene Demo-Servicefunktion", result: "NOT_REQUIRED", effectiveFrom: "2025-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T00:00:00.000Z" },
  { code: "MOCK-CHISCO-0006", label: "Demo-Lagerassistenz Quartierlogistik", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0007", label: "Demo-Analystin Prozessdaten", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0008", label: "Demo-Betreuungskraft Tagesstruktur", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0009", label: "Demo-Koordinator Gebäudeservice", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0010", label: "Demo-Entwicklerin Geschäftssysteme", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0011", label: "Demo-Produktionshilfe Feinmontage", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0012", label: "Demo-Beraterin Kundenprozesse", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0013", label: "Demo-Servicekraft Stadthotel", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0014", label: "Demo-Fachperson Lohnadministration", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0015", label: "Demo-Hilfskraft Oberflächenpflege", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0016", label: "Demo-Technikerin Energiesysteme", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0017", label: "Mehrdeutige Demo-Betriebsassistenz", result: "UNKNOWN", classificationStatus: "AMBIGUOUS" },
  { code: "MOCK-CHISCO-0018", label: "Demo-Fahrdienst Quartierversorgung", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0019", label: "Demo-Projektleitung Bildungsmedien", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0020", label: "Demo-Hilfe Gemeinschaftsküche", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0021", label: "Demo-Redaktorin Fachkommunikation", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0022", label: "Demo-Sortierhilfe Kreislaufbetrieb", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0023", label: "Demo-Spezialist Vertragsdaten", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0024", label: "Demo-Unterstützung Patientenlogistik", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0025", label: "Demo-Werkstattassistenz Holzbau", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0026", label: "Demo-Controllerin Nachhaltigkeitsdaten", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0027", label: "Demo-Hilfe Verkaufsfläche", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0028", label: "Demo-Systemplaner Gebäudeautomation", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0029", label: "Mehrdeutige Demo-Kundenfunktion", result: "UNKNOWN", classificationStatus: "AMBIGUOUS" },
  { code: "MOCK-CHISCO-0030", label: "Demo-Verpackungshilfe Kleinserie", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0031", label: "Demo-Fachperson Personalentwicklung", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0032", label: "Demo-Unterstützung Gästelogistik", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0033", label: "Demo-Bauhilfe Innenausbau", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0034", label: "Demo-Spezialistin Datenqualität", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0035", label: "Demo-Assistenz Sozialraumprojekte", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0036", label: "Demo-Hilfskraft Warenumschlag", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0037", label: "Demo-Ingenieurin Prüfsysteme", result: "NOT_REQUIRED" },
  { code: "MOCK-CHISCO-0038", label: "Demo-Koordination Mehrsprachiger Support", result: "UNKNOWN" },
  { code: "MOCK-CHISCO-0039", label: "Demo-Betriebshilfe Veranstaltung", result: "REQUIRES_REPORTING" },
  { code: "MOCK-CHISCO-0040", label: "Demo-Fachperson Finanzprozesse", result: "NOT_REQUIRED" },
] satisfies OccupationDefinition[];

function stableOccupationId(index: number) {
  return `b7b7d035-6fd5-4f9c-8f31-${String(index + 1).padStart(12, "0")}`;
}

const OCCUPATION_CODES = Object.freeze(
  OCCUPATION_DEFINITIONS.map((definition, index) =>
    Object.freeze({
      id: stableOccupationId(index),
      code: definition.code,
      label: definition.label,
      result: definition.result,
      classificationStatus: definition.classificationStatus ?? "RESOLVED",
      effectiveFrom: definition.effectiveFrom ?? CURRENT_FROM,
      effectiveTo: definition.effectiveTo ?? CURRENT_TO,
    }),
  ),
);

/**
 * Canonical, reviewed and wholly fictional 2026 Mock dataset shared by the
 * Phase-04 provider and Phase-05 seed. It is neither an official occupation
 * list nor legal advice; no production decision may treat it as such.
 */
export const OCCUPATION_CODES_2026_FIXTURE: OccupationCodeDatasetFixture =
  Object.freeze({
    datasetKey: "JOBROOM_REPORTING_MOCK",
    datasetVersion: "mock-ch-isco-2026-v1",
    dataYear: 2026,
    source: JOBROOM_MOCK_SOURCE,
    sourceUrl: JOBROOM_OFFICIAL_SOURCE_URL,
    disclaimer: JOBROOM_LEGAL_DISCLAIMER,
    validFrom: CURRENT_FROM,
    validTo: CURRENT_TO,
    occupationCodes: OCCUPATION_CODES,
  });
