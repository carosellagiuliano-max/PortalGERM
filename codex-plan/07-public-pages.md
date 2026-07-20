# Phase 07 — Öffentliche Discovery

> **PortalGERM-Status: IMPLEMENTIERT UND VERIFIZIERT.** Der unveränderliche
> Code-Commit ist `69121f9749f5189b14c3feb9c7232031bf44d712`; die vollständige
> Prüfevidenz steht in
> [`evidence/2026-07-20-phase-07.md`](./evidence/2026-07-20-phase-07.md).
> Clusterseiten bleiben bis zum Phase-15-Content-/Liquiditätsgate `noindex`.

> Detaildatei für Phase 07 in [`00-PLAN.md`](./00-PLAN.md). Verbindliche
> Regeln: [`99-rules-quickref.md`](./99-rules-quickref.md) §7, §10, §16,
> §20 und §21 sowie ADR-003/008/017 in [`decisions.md`](./decisions.md).

## Ziel und Ergebnis

Phase 07 liefert die funktionalen öffentlichen Entscheidungsflächen für Jobs,
Firmen, Lohnorientierung und Ratgeber sowie eine konsistente Auth-Shell. Alle
öffentlichen Daten laufen über geschlossene Safe-Read-Models. Lokale Demo-Daten
sind dauerhaft sichtbar gekennzeichnet und werden in Production weder als
Live-Marktaktivität noch als indexierbarer Inhalt ausgegeben.

## Voraussetzungen

- [x] Phasen 02–06 sind implementiert und verifiziert.
- [x] Scoring-, Such-, Formatierungs-, Sanitizing-, Auth- und Privacy-Policies
  stehen serverseitig zur Verfügung.

## Abgeschlossene Deliverables

### Öffentliche Shell und gemeinsame Komponenten

- [x] `app/(public)/layout.tsx`, Skip-Link, responsive Header/Mobile-Sheet und
  Footer bieten echte Links für Jobs, Unternehmen, Lohn-Radar, Ratgeber,
  Arbeitgeber-Registrierung, Login und „Kostenlos starten“.
- [x] Der noch nicht implementierte Pricing-Einstieg wird nicht als toter Link
  angezeigt; Pricing und Arbeitgeber-Marketing gehören verbindlich Phase 08.
- [x] Funktionale Komponenten liegen unter `components/public`,
  `components/layout` und `components/shared`; die Pfade ersetzen die früher
  vorgeschlagene, aber nicht bindende Aufteilung nach `jobs/companies/marketing`.
- [x] Read-Models tragen `dataProvenance`: Local/Preview/CI dürfen klar
  markierte Demo-Daten zeigen, Staging/Production sind `LIVE`-only.
- [x] Root-Metadaten verwenden eine konfigurierte `metadataBase`; öffentliche
  Fehler-, Loading-, Empty- und Not-found-Zustände sind deutsch und zugänglich.

### `/` — Homepage

- [x] Launch-ehrlicher Hero mit der Aussage „Finde nicht irgendeinen Job.
  Finde den Job, der wirklich passt.“ sowie funktionaler Jobsuche.
- [x] Differenzierer Fair-Job-Score, Lohn-Radar, Anti-Ghosting und anonymes
  Talentprofil werden als Produktpfad erklärt, ohne noch nicht vorhandene
  Candidate-Mutationen vorzutäuschen.
- [x] Bis zu sechs geeignete Jobs erscheinen mit höchstens zwei klar als „Geboostet“
  markierten, relevanten effektiven Platzierungen vor den organischen Treffern.
- [x] Bis zu acht geeignete Firmen sowie aktivierte Kantons-/Kategoriecluster
  erscheinen mit ehrlichen aktuellen Zählungen; leere Taxonomie wird nicht als
  landesweite Liquidität vermarktet.
- [x] Bewerber- und Arbeitgeber-Ablauf, Trust-/Privacy-Hinweise und die echten
  CTAs `/register/candidate` und `/register/employer` sind vorhanden.

### `/jobs` — Suche

- [x] Serverkomponente liest allowlistete URL-Parameter für Keyword, Kanton,
  Stadt, Kategorie, Pensum, Jobtyp, Remote-Modell, Sprache,
  Bewerbungsaufwand, Lohntransparenz, Antwortsignal, Firmenverifizierung und
  Sortierung. Der Zustand bleibt nach Reload in der URL erhalten.
- [x] Sortierungen Relevanz, Neueste, Fair-Job-Score, Lohn und
  Antwortgeschwindigkeit respektieren eine separate, begrenzte und gelabelte
  Sponsored-Zone; es gibt keine Sortierung „Boosted zuerst“.
- [x] Die Phase-07-Abfrage nutzt einen stabil begrenzten Cursor-/Snapshot-
  Vertrag und maximal 2.000 Kandidaten plus Sentinel. Falls dieser Arbeitsraum
  ausgeschöpft ist, zeigt die UI ausdrücklich eine unvollständige Trefferzahl
  statt eines erfundenen Totals. Globale Search-/Pagination-Semantik bleibt
  das finale Phase-15-Gate.
- [x] Eligibility, Relevanz, effektive Boost-Gültigkeit, Fair-Score-Version,
  `publishedAt` und stabile ID-Bindung werden vor der Ausgabe geprüft.
- [x] Jobkarten, responsiver Filterbereich mit nativer Disclosure,
  Loading-Skeleton und ehrlicher Empty State sind responsive. Titel und Firma
  führen zu ihren echten Detailzielen; es gibt keine tote interne
  Save-/Apply-Schaltfläche vor Phase 09.

### `/jobs/[slug]` und Clusterseiten

- [x] Detailseiten zeigen öffentliche Stellen-/Firmenfelder, Pensum, Typ,
  Sprache, Lohntransparenz, versionierten Fair-Score, Skills, Benefits,
  Arbeitsmodell, Prozess- und evidenzbasierte Antwortinformationen.
- [x] Ein kandidatenbezogener Match samt Confidence wird nur mit geeignetem
  aktuellem Candidate-Kontext berechnet; anonyme Besucher sehen stattdessen
  einen echten Login-/Registrierungspfad.
- [x] Teilen, sicher validierter externer Bewerbungsweg, ähnliche Jobs,
  Firmenvorschau und rate-limitierte Missbrauchsmeldung funktionieren.
- [x] Benutzerinhalt wird vor öffentlicher Darstellung sanitisiert. Ein
  `JobPosting`-JSON-LD wird nur für einen live-fähigen, indexierbaren Kontext
  ausgegeben; Demo-Inhalte erzeugen bewusst kein Rich Result.
- [x] Kantons- und Kategorieseiten verwenden dieselbe kanonische Suche,
  enthalten Fair-Job-Score-/Lohntransparenz-Kontext und bleiben bis Phase 15
  kanonisch, aber `noindex` und ausserhalb der Sitemap.

### `/companies` und `/companies/[slug]`

- [x] Ein kanonisches Read-Model akzeptiert nur `ACTIVE`, öffentlich geeignete
  Firmen ohne wirksame Hide-Restriction; ausserhalb Demo-Modus zusätzlich nur
  `LIVE`. DRAFT/SUSPENDED/CLOSED/restricted liefern dieselbe sichere Not-found-
  Grenze.
- [x] Suche und Filter für Name, Kanton, Branche und Verifizierung sowie
  begrenzte Pagination sind implementiert.
- [x] Karten projizieren ausschliesslich öffentliche Identität, Standort,
  Branche, aktive Stellen, Verifizierungs-/Antwortsignal und höchstens drei
  Benefits. Jobzahlen und effektive Enhanced-Entitlements werden gebündelt
  statt über N+1-Abfragen geladen.
- [x] Freie Profile und berechtigte Enhanced-Felder verwenden
  `getEffectiveEntitlements`; es werden keine nicht persistierten
  Quote/Gallery/Video-Platzhalter oder private Owner-, Membership-, Domain-
  und Storage-Key-Daten ausgegeben.
- [x] Weil Phase 04 noch keinen echten öffentlichen Storage-Read-URL-Provider
  besitzt, zeigt Phase 07 bewusst ein neutrales Firmenzeichen statt ein
  vermeintliches Logo/Cover. Reale Medien werden erst mit einem sicheren
  öffentlichen Read-Pfad aktiviert.
- [x] Aktive Stellen, Firmenmeldung und ein signierter, ablaufender Claim-Intent
  über den öffentlichen Slug funktionieren; fremde `next`-Werte werden bewusst
  ignoriert. Die eigentliche
  Owner/Admin-Claim-Prüfung bleibt Phase 10; eine gefälschte private Firmen-ID
  wird fail-closed abgewiesen.

### `/salary-radar`

- [x] Formular und Server Action unterstützen Titel, Kategorie, Kanton,
  Seniorität und Pensum.
- [x] `SALARY_RADAR_POLICY_V1` wählt zum injizierten Zeitpunkt genau einen
  zulässigen Datensatz und die erste Scope-Stufe mit mindestens 30 Samples,
  ohne Quantile oder Kategorien zusammenzumischen.
- [x] Ergebnis zeigt YEARLY/FTE-p25/Median/p75, ganzzahlig angepasste Werte,
  Datensatz/Stand/Methode/Fallback, ausschliesslich den Sample-Bucket
  `30–49|50–99|100+` sowie bis zu vier passende öffentliche Jobs.
- [x] Für 29 Samples, uneindeutigen/fehlenden Datensatz oder fehlende Bandbreite
  erscheint ein transparenter No-result-Zustand; exakte Sample-Zahlen und
  falsche Präzision werden nicht exponiert.
- [x] Der Pflichttext „Dieser Lohnbereich ist eine Orientierung und keine
  Rechts-, Finanz- oder Lohnberatung.“ ist direkt beim Ergebnis sichtbar.
- [x] Der fiktive Phase-05-Datensatz ist im Demo-Kontext deutlich benannt und
  wird in Production vollständig fail-closed ausgeschlossen.

### `/guide` und `/guide/[slug]`

- [x] Liste und Detail lesen nur die aktuelle reviewed/published Revision;
  Draft/Review/unpublished Content ist öffentlich nicht verfügbar.
- [x] Titel, Excerpt, sicher sanitierter Inhalt und verwandte Artikel sind
  vorhanden. Finale Indexierbarkeit und Sitemap-Aufnahme werden erst durch das
  Phase-15-Content-/Liquiditätsgate freigegeben.

### Auth-Polish

- [x] `/login`, `/register*` und `/forgot-password` verwenden die öffentliche
  visuelle Shell, deutsche Labels, klare CTAs und zugängliche Formzustände.
- [x] Bestehende Phase-06-Server-Actions bleiben Zod-validiert und verwenden
  `useActionState`; es wurde keine parallele Client-only-Authlogik eingeführt.

## Bewusste Verantwortungsgrenzen

- **Phase 08:** Pricing und Arbeitgeber-Marketing; deshalb kein Pricing-Link
  oder Pricing-CTA mit totem Ziel in Phase 07.
- **Phase 09:** internes Speichern, Bewerben/Schnellbewerbung und vollständiger
  Candidate Match mit persistiertem JobPass-Workflow.
- **Phase 10:** operative Company-Claim-Prüfung nach dem in Phase 07 sicher
  transportierten Intent.
- **Phase 13:** Boost-Kauf, Aktivierung und Lifecycle. Phase 07 liest und
  kennzeichnet ausschliesslich aktuell wirksame `JobBoost`-Datensätze.
- **Phase 15:** globale Ranking-/Cursor-Semantik, Rich-Results-Abnahme,
  finale Canonicals/Sitemap und Content-/Liquiditätsgates.
- **Analytics:** Öffentliche Reads emittieren keine optionalen Product-Events,
  solange keine generische Consent-Quelle besteht. Es werden weder PII noch
  Freitext ohne Einwilligungsgrundlage als Ersatztelemetrie erzeugt.

## Verifikation

- [x] Homepage, Kantons-/Kategorie-Navigation, Firmen, Ratgeber, Jobdetail und
  Salary Radar wurden im sichtbaren lokalen Browser bedient.
- [x] `/jobs?category=engineering&canton=zuerich` filtert serverseitig; Auswahl
  und URL-Zustand blieben nach Reload erhalten.
- [x] Aktive effektive Boosts erscheinen in Karten, Details und verwandten
  Listen immer als „Geboostet“; Fair-Score und Firmenverifizierung bleiben
  davon getrennt.
- [x] Candidate-Match-Gating, sichere Projektionen, Claim-Intent,
  Missbrauchsmeldung, Sanitizing, Salary Policy und JSON-LD wurden in Unit- und
  PostgreSQL-Integrationstests geprüft.
- [x] Der Produktions-HTTP-Smoke erzeugt eine frische migrierte Testdatenbank,
  seedet deterministisch, prüft öffentliche/private Routen und entfernt die
  isolierte Datenbank anschliessend.
- [x] Lighthouse Mobile bei 360 × 800: Performance 91, Accessibility 100,
  FCP 1,4 s, LCP 3,3 s, TBT 140 ms und CLS 0.
- [x] Enter/Escape/Fokus-Rückgabe des mobilen Navigations-Sheets sind per
  Component-Test belegt; die sichtbare Browserprüfung und Lighthouse fanden
  keine Warnung bzw. keinen automatisiert erkannten Accessibility-Befund.
- [x] `npm run lint`, `npm run typecheck`, 1.082 Unit-Tests, 91 PostgreSQL-
  Integrationstests, Prisma-/Compose-/Audit-Gates, Production Build und HTTP-
  E2E endeten erfolgreich. Details und Befehle stehen im Evidence-Record.

Der externe Google Rich Results Test wurde für lokale Demo-Daten bewusst nicht
als Phase-07-Gate ausgeführt, weil deren JSON-LD absichtlich unterdrückt wird.
Payload und erlaubte `employmentType`-Mehrfachwerte sind automatisiert geprüft;
die externe Live-URL-Abnahme gehört Phase 15.

## Bekannte Grenzen

- Das 2.000er Arbeitslimit wird vor der vollständigen kanonischen Restriction-
  Auswertung angewendet. Viele jüngere versteckte/inkonsistente Datensätze
  könnten daher ältere geeignete Jobs verdrängen; die UI kennzeichnet den
  Arbeitsraum dann als unvollständig. Phase 15 besitzt die globale Lösung.
- Die Homepage kombiniert Jobkandidaten, exakte Clusterzählungen und gebündelte
  Firmen-Jobzahlen. Das bestandene mobile Lighthouse-Gate ersetzt noch keinen
  Production-Lasttest; Skalierung/Index-Tuning bleiben Phase 15/16/18.
- Reale Provider, vollständige Portale, Billing, Produktions-SEO und rechtliche
  Go-live-Freigabe sind ausdrücklich nicht Bestandteil dieser Phase.

## PortalGERM Execution Contract

| Feld | Erfüllter Phase-07-Vertrag |
|---|---|
| Business Value | Besucher können Jobs, Firmen und Lohnorientierung verstehen und einen realen Candidate-/Employer-Nächsten-Schritt wählen. |
| Rollen | Public; Candidate optional und ausschliesslich für persönlichen Match. |
| Routen | `/`, `/jobs`, Job-/Clusterdetails, `/companies`, Firmenprofil, `/salary-radar`, `/guide`; sichere Auth-CTA-Integration. |
| Daten | Aktuelle öffentliche Job-/Company-/Salary-/Content-Projektionen; keine rohen Modelle oder privaten Tenantdaten. |
| Validation | Allowlistete, begrenzte URL-Parameter; gültige Slugs; Status-/Zeit-/Restriction-/Provenance-Prüfung in der Query. |
| Privacy/Security | Live-only ausser Demo; Match kandidatenspezifisch; Abuse-Rate-Limit Actor/IP+Target-HMAC; Claim signiert/ablaufend; Inhalte sanitisiert. |
| UX/Mobile | Responsiver Jobfilter, Mobile-Navigation als Sheet, Loading/Empty/Not-found, ehrliche Zählungen, nachvollziehbare Score-/Salary-Hinweise und keine toten Save/Apply/Pricing-Controls. |
| Tests | Read-Model-/Payload-/Policy-/UI-Unit-Tests, PostgreSQL-Integration, Production Build/HTTP-Smoke, Browser und Lighthouse. |
| Risiken | Finale globale Suche/SEO/Last, Boost-Lifecycle und interne Candidate-Aktionen bleiben ihren Folgephasen zugeordnet. |
| Definition of Done | Erfüllt durch Code-Commit `69121f9` und den verlinkten Evidence-Record. |
