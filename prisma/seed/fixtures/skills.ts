export interface SkillFixture {
  readonly name: string;
  readonly slug: string;
  readonly categorySlug: string;
}

const SKILLS_BY_CATEGORY = {
  "informatik": [
    ["TypeScript", "typescript"],
    ["React", "react"],
    ["SQL", "sql"],
    ["Cloud-Infrastruktur", "cloud-infrastruktur"],
  ],
  "gesundheit-pflege": [
    ["Pflegefachfrau HF", "pflegefachfrau-hf"],
    ["Patientenbetreuung", "patientenbetreuung"],
    ["Medikamentenmanagement", "medikamentenmanagement"],
    ["Pflegedokumentation", "pflegedokumentation"],
  ],
  "bau-handwerk": [
    ["Schreiner EFZ", "schreiner-efz"],
    ["Maurer EFZ", "maurer-efz"],
    ["Elektroinstallation", "elektroinstallation"],
    ["Bauplanlesen", "bauplanlesen"],
  ],
  "kv-administration": [
    ["MS Office", "ms-office"],
    ["SAP", "sap"],
    ["Korrespondenz", "korrespondenz"],
    ["Terminorganisation", "terminorganisation"],
  ],
  "verkauf": [
    ["Beratungskompetenz", "beratungskompetenz"],
    ["Verkaufsgespräch", "verkaufsgespraech"],
    ["Warenpräsentation", "warenpraesentation"],
    ["Französisch im Verkauf", "franzoesisch-im-verkauf"],
  ],
  "gastronomie-hotellerie": [
    ["Servicekompetenz", "servicekompetenz"],
    ["Gästebetreuung", "gaestebetreuung"],
    ["Hygienestandards", "hygienestandards"],
    ["Küchenorganisation", "kuechenorganisation"],
  ],
  "bildung-soziales": [
    ["Sozialpädagogik", "sozialpaedagogik"],
    ["Unterrichtsplanung", "unterrichtsplanung"],
    ["Fallführung", "fallfuehrung"],
    ["Inklusionsarbeit", "inklusionsarbeit"],
  ],
  "finanzen-treuhand-recht": [
    ["Buchhaltung", "buchhaltung"],
    ["Treuhandwesen", "treuhandwesen"],
    ["Schweizer Steuerpraxis", "schweizer-steuerpraxis"],
    ["Vertragsprüfung", "vertragspruefung"],
  ],
  "logistik-transport": [
    ["Lagerbewirtschaftung", "lagerbewirtschaftung"],
    ["Tourenplanung", "tourenplanung"],
    ["Staplerbedienung", "staplerbedienung"],
    ["Zollabwicklung", "zollabwicklung"],
  ],
  "engineering-technik": [
    ["CAD-Konstruktion", "cad-konstruktion"],
    ["SPS-Programmierung", "sps-programmierung"],
    ["Qualitätsprüfung", "qualitaetspruefung"],
    ["Technische Dokumentation", "technische-dokumentation"],
  ],
  "marketing-kommunikation": [
    ["Content-Marketing", "content-marketing"],
    ["Kampagnenplanung", "kampagnenplanung"],
    ["SEO-Grundlagen", "seo-grundlagen"],
    ["Medienarbeit", "medienarbeit"],
  ],
  "reinigung-facility": [
    ["Gebäudereinigung", "gebaeudereinigung"],
    ["Facility Management", "facility-management"],
    ["Arbeitssicherheit", "arbeitssicherheit"],
    ["Reinigungsmaschinen", "reinigungsmaschinen"],
  ],
  "management-kader": [
    ["Personalführung", "personalfuehrung"],
    ["Budgetverantwortung", "budgetverantwortung"],
    ["Strategieumsetzung", "strategieumsetzung"],
    ["Stakeholder-Management", "stakeholder-management"],
  ],
  "lehrstellen": [
    ["Lernbereitschaft", "lernbereitschaft"],
    ["Zuverlässigkeit", "zuverlaessigkeit"],
    ["Teamarbeit", "teamarbeit"],
    ["Handwerkliches Geschick", "handwerkliches-geschick"],
  ],
  "temporaerarbeit": [
    ["Flexible Einsatzplanung", "flexible-einsatzplanung"],
    ["Schnelle Einarbeitung", "schnelle-einarbeitung"],
    ["Schichtbereitschaft", "schichtbereitschaft"],
    ["Branchenwechselkompetenz", "branchenwechselkompetenz"],
  ],
  "produktion-industrie": [
    ["Maschinenbedienung", "maschinenbedienung"],
    ["Lean Production", "lean-production"],
    ["Montagearbeit", "montagearbeit"],
    ["Produktionskontrolle", "produktionskontrolle"],
  ],
  "hr-recruiting": [
    ["Talent Acquisition", "talent-acquisition"],
    ["Interviewführung", "interviewfuehrung"],
    ["Arbeitszeugnisse", "arbeitszeugnisse"],
    ["Lohnadministration", "lohnadministration"],
  ],
  "kundendienst-callcenter": [
    ["Telefonischer Kundendienst", "telefonischer-kundendienst"],
    ["Beschwerdemanagement", "beschwerdemanagement"],
    ["CRM-Systeme", "crm-systeme"],
    ["Italienisch im Kundendienst", "italienisch-im-kundendienst"],
  ],
} as const;

export const SKILL_FIXTURES: readonly Readonly<SkillFixture>[] = Object.freeze(
  Object.entries(SKILLS_BY_CATEGORY).flatMap(([categorySlug, skills]) =>
    skills.map(([name, slug]) => Object.freeze({ name, slug, categorySlug })),
  ),
);
