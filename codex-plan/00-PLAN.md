# SwissTalentHub — Masterplan

> **Planstatus:** vollständig überarbeitete Planungsgrundlage, Stand 19. Juli 2026. **Phase 01 ist im Zielrepository implementiert und verifiziert; Phasen 02–18 sind offen.** Die Foundation ist kein fertiges Produkt: Domainmodelle, Auth, Produktportale, Billing und Provider sind noch nicht umgesetzt.

## 1. Lesereihenfolge und Konfliktpräzedenz

Die folgende Liste ist die empfohlene **Lesereihenfolge**, nicht die Konflikthierarchie. Für widersprüchliche Aussagen gilt überall identisch: `AGENTS.md`/Masterauftrag → explizite freigegebene ADR in `decisions.md` → `requirements-matrix.md` → aktueller Masterplan/Architecture Blueprint/Product Strategy → ausführende Phase/Implementation Plan → übertragenes Legacy-Inventar. Quickref/Glossary fassen zusammen und dürfen eine höher priorisierte Detailentscheidung nicht überschreiben; ein Konflikt wird an der niedrigeren Stelle repariert statt interpretiert.

1. [`../AGENTS.md`](../AGENTS.md) — verbindliche Arbeits- und Evidence-Regeln.
2. [`99-rules-quickref.md`](./99-rules-quickref.md) — nicht verhandelbare Produkt-/Technikregeln.
3. [`product-strategy.md`](./product-strategy.md) — Zielgruppen, Positionierung, Marketplace, Journeys, Growth, Monetarisierung und KPIs.
4. [`architecture-blueprint.md`](./architecture-blueprint.md) — Rollen, Routen, Daten, Use Cases, Security, UX, Test und Betrieb.
5. [`requirements-matrix.md`](./requirements-matrix.md) — Anforderung → Phase → Modell → Policy → UX → Test → Abnahme.
6. [`decisions.md`](./decisions.md) und [`glossary.md`](./glossary.md) — verbindliche ADRs und Begriffe.
7. [`plan-audit.md`](./plan-audit.md) — Konflikte, Klassifizierung, offene Entscheidungen und verworfener Scope.
8. [`implementation-plan.md`](./implementation-plan.md) — ausführbare Schritte und Definition of Done.
9. Die Detailphase `01` bis `18` — technische Deliverables und Evidence je Schritt.

Das historisch referenzierte `../plan.md` existiert nicht. Diese lokale Dokumentgruppe ist deshalb die alleinige Planungsquelle. Tote `plan.md §…`-Verweise begründen keine zusätzliche oder abweichende Anforderung.

## 2. Executive Summary

SwissTalentHub ist eine Schweizer Karriere-Entscheidungsplattform mit Stellenmarktplatz. Kandidaten erhalten vor Registrierung Transparenz über Stelle, Lohn und Inseratqualität und bauen danach mit SwissJobPass, Jobabos, Bewerbungsstatus und freiwilligem anonymem Talent Radar wiederkehrenden Nutzen auf. Arbeitgeber erhalten einen geführten Jobprozess, Bewerberpipeline, resultatbezogene Analytics und klar bepreiste Kontingente/Workflows. Admins betreiben Moderation, Verifizierung, Import, Billing, Datenschutzfälle, Sales und Marketplace-Liquidität über handlungsorientierte Queues.

Der Markteintritt ist bewusst fokussiert: Als validierbare Hypothese startet SwissTalentHub in deutschsprachigen Clustern Zürich/Aargau/Bern für Pflege/Gesundheit und Engineering/Technik mit Schweizer KMU, nicht als sofort flächendeckend liquider Marktplatz. Breite, Regionen und Sprachen werden anhand echter Angebots-/Nachfrage-Gates erweitert.

Die wichtigsten Differenzierungen sind:

- erklärbarer, versionierter Fair-Job-Score ohne Einfluss bezahlter Reichweite;
- Lohnorientierung und strukturierter SwissJobPass;
- Kandidatenkontrolle und Server-Anonymisierung im Talent Radar;
- Anti-Ghosting durch messbare Antwortprozesse statt unbelegtem Badge;
- Arbeitgeber-Cockpit mit Handlungsempfehlungen statt Vanity-Metriken.

## 3. Verifizierter Repository-Status

Der vollständige Ausgangs-`codex-plan` mit 24 Dateien wurde in das leere Ziel übertragen und vor Überarbeitung per SHA-256 bytegenau verglichen. Das verlinkte Root-`AGENTS.md` wurde zusätzlich übernommen. Der Ziel-Baseline-Commit enthielt nur `README.md`.

Das Quellprojekt besass lediglich eine Phase-01-Referenz: statische Homepage/UI-Primitives, leeres Prisma-Schema, Placeholder-Seed, keine Domainlogik/Auth/APIs/Tests. Diese Foundation wurde **nicht** als Zielimplementierung gewertet oder kopiert. PortalGERM erhielt danach eine eigenständig gepinnte und geprüfte Phase-01-Basis; der Nachweis referenziert den unveränderlichen Code-Commit in [`evidence/2026-07-19-phase-01.md`](./evidence/2026-07-19-phase-01.md). Historische Details: [`repository-audit.md`](./repository-audit.md).

## 4. Unverhandelbare Invarianten

- Talent-Radar-Identität bleibt bis zum ausdrücklichen kandidateninitiierten Reveal verborgen; Reveal gilt nur für vorgesehene Firma und Anfrage/Thread.
- Rollen, Tenant, Ownership, Assignment, Entitlement und Status werden serverseitig geprüft.
- Geld wird in ganzen Rappen gespeichert; Lohnspannen bleiben ganze CHF. Preise kommen nie vom Client.
- Credit-/Allowance-Verbrauch und Fulfillment sind atomar, idempotent und ledgerbasiert.
- Boosts sind immer „Geboostet“ und beeinflussen niemals den Fair-Job-Score.
- Match-Score ist P0 eine kandidatenorientierte Entscheidungshilfe, keine automatische Arbeitgeberentscheidung.
- Externe Systeme bleiben persistierende Mock-Adapter; kein realer API-Zugriff und kein automatischer Env-Switch.
- Keine fremden Portale scrapen/kopieren; Import braucht Nutzungsgrundlage und Preview.
- Keine volle DSG-/Rechts-/Steuer- oder Produktionsreife behaupten. Success Fee bleibt deaktiviert.
- Kein UI-only Feature, keine harte Demozahl als Marktnachweis und kein `[x]` ohne neue Evidence im Ziel.

## 5. Priorisierung

| Stufe | Bedeutung | Beispiele |
|---|---|---|
| P0 | kontrolliertes MVP funktioniert end-to-end | Auth/Tenant, öffentliche Suche, JobPass, Bewerbung, Company/Job/Moderation, Billing Mock, Boost, Radar Contact/Reveal, Adminqueues, Security-/DB-Tests |
| P1 | überzeugender Pilot/Marktstart | Jahrespläne, Agenturmandate, erweiterte Analytics/Cockpit, Growth-Gates, Worker/Outbox, Deployment/Backup/Monitoring |
| P2 | nach erstem Marktfeedback | zusätzliche Sponsored-Produkte, breitere Mehrsprachigkeit, fortgeschrittene Suche, Visual Regression, Refund-Automation |
| später | explizites Folgeprojekt | reale Provider, ATS/API/SSO, Enterprise Billing, employerseitige Match-Sortierung nach Prüfung, Success Fee nach Legal Review |
| verworfen | nicht bauen | Scraping, globale Reveals, bezahlte Fairness, Fake-Aktivität, automatische Ablehnung, dünne SEO-Massenpages |

## 6. Phasen und Verantwortungsgrenzen

> Jede Phase bleibt `[ ]`, bis Code, Persistenz, Server-Policies, UX-Zustände, Seeds, Tests und Evidence im **Zielrepository** vollständig vorhanden sind.

### [x] 01 — Foundation und Governance

[`01-setup-foundation.md`](./01-setup-foundation.md) · reproduzierbare Windows/CI-kompatible Toolchain, Env, App-/DB-Skeleton, Evidence. Keine Quellhäkchen übernehmen.

### [ ] 02 — Schema und Migrationen

[`02-prisma-schema.md`](./02-prisma-schema.md) · draftfähige Profile, Tenant-/Job-/Application-/Privacy-/Billing-/Ops-Modelle, Constraints, Indizes und echte Migrationen.

### [ ] 03 — Core Policies und Scoring

[`03-core-libraries-scoring.md`](./03-core-libraries-scoring.md) · Auth-/Ownership-/Entitlement-Policies, Statusmaschinen, Safe DTOs, Fair/Match, Rappen/VAT, Audit/Events plus Unit-/DB-Tests.

### [ ] 04 — Provider Ports und Mocks

[`04-mock-adapters.md`](./04-mock-adapters.md) · persistierende, netzwerkfreie Adapter; Payment-Adapter besitzt nicht das Fulfillment.

### [ ] 05 — Seed und Test-Harness

[`05-seed-data.md`](./05-seed-data.md) · deterministische positive/negative Fixtures, Prod-Guard, Idempotenz, manifestierte Counts.

### [ ] 06 — Auth, Tenant und Onboarding

[`06-auth-rbac.md`](./06-auth-rbac.md) · Auth-End-to-End, Sessions, Firmenkontext, Einladungsgrundlage, vollständige RBAC-/IDOR-Tests.

### [ ] 07 — Öffentliche Discovery

[`07-public-pages.md`](./07-public-pages.md) · nützliche Suche/Detail/Firma/Salary/Guide; Clusterseiten bis SEO-Gate nicht indexiert.

### [ ] 08 — Pricing und Arbeitgeberakquise

[`08-pricing-employer-marketing.md`](./08-pricing-employer-marketing.md) · klare Pakete, ehrliche Marketingpages, persistierter/geschützter Demo-Lead.

### [ ] 09 — Kandidaten-Core

[`09-candidate-portal.md`](./09-candidate-portal.md) · JobPass, Saved Jobs, Apply/Withdraw/Status, Alerts, Messaging, Privacy-Basics.

### [ ] 10 — Arbeitgeber- und Recruiter-Core

[`10-employer-portal.md`](./10-employer-portal.md) · Company/Verification Request, Team, Jobs/Wizard, Assignments, Pipeline. Billing/Radar nur ehrliche Locked States.

### [ ] 11 — Admin und Moderation

[`11-admin-portal.md`](./11-admin-portal.md) · Job/Firma/User/Report/Import/Support/Content/Lead-Queues. Keine konkurrierende Payment-/Katalog-Logik.

### [ ] 12 — Entitlements und Billing

[`12-monetization-billing.md`](./12-monetization-billing.md) · alleinige Catalog-/Plan-/Order-/Invoice-/Subscription-/Credit-/Fulfillment-Domain sowie Admin-Billing-Routen.

### [ ] 13 — Job Boosts

[`13-job-boosts.md`](./13-job-boosts.md) · validiertes Jobziel, Lifecycle, non-overlap, transparenter relevanzgebundener Rang.

### [ ] 14 — Talent Radar und Privacy

[`14-talent-radar-privacy.md`](./14-talent-radar-privacy.md) · kanonisches Opt-in, Safe DTO/opaque ID, Contact Ledger, Accept/Decline, scoped Reveal, Privacy Cases.

### [ ] 15 — Search, SEO und Growth

[`15-seo-search.md`](./15-seo-search.md) · globale Ranking-/Pagination-Semantik, Canonical/JSON-LD/Sitemap, Content-/Liquiditätsgate.

### [ ] 16 — Security und Operations

[`16-security-hardening.md`](./16-security-hardening.md) · abschliessende Controls, No-store, CSP/CSRF/Rate/Audit-Matrix, Redaction, Health/Observability.

### [ ] 17 — Cross-role Verification

[`17-testing.md`](./17-testing.md) · Owning-phase Regression plus E2E-01 bis E2E-07, A11y/Mobile/Performance. Tests beginnen nicht erst hier; E2E-08 gehört Phase 18.

### [ ] 18 — Dokumentation und Release-Audit

[`18-documentation-final-audit.md`](./18-documentation-final-audit.md) · E2E-08 Clean Clone, Migration/Seed, Production-Demo-Guard, Backup/isolierter Restore/Smoke, Evidence, Abschlussbericht und ehrliche Pilotgrenzen.

Die genaue Abhängigkeitsgrafik und jedes ausführbare Arbeitspaket stehen in [`implementation-plan.md`](./implementation-plan.md).

## 7. Verantwortungsauflösung alter Konflikte

| Konflikt | Verbindliche Auflösung |
|---|---|
| Admin vs Billing | Phase 12 besitzt Pricing, Payment Confirmation, Invoice und Fulfillment. Phase 11 baut nur Shell/Queues ohne parallelen Service. |
| Boost-Checkout ohne Ziel | OrderLine/FulfillmentContext speichert serverseitig geprüftes `jobId`; Phase 13 registriert Handler. |
| zwei Upgrade-Modals | eine gemeinsame Billing-Komponente und ein `LIMIT`-Resultat. |
| Limit bei Submit/Publish | Draft/Submit erlaubt; jede Transition nach `PUBLISHED`/Reaktivierung prüft Kontingent atomar. |
| Radar-ID | opaque, serverseitig gemappte ID; nie Handle oder PK als Autorisierungsgrenze. |
| Reveal global vs Thread | Grant für Candidate + Company + ContactRequest/Conversation; kein globales Reveal. |
| Allowance vs Pack | Ledger mit `fundingSource`, Periode, Grant und Idempotenz; gekaufte Credits zählen nicht als Planverbrauch. |
| Boost vs Sort/Pagination | Relevanz zuerst; klar begrenzte Sponsored-Zone; stabiles Sortiertupel global vor Pagination. |
| 403 vs 404 IDOR | fremde/nicht existente Tenant-Ressource liefert sichere 404; echter Rollenfehler ohne Objektbezug kann 403 sein. |
| Noindex vs Cache | private Seiten brauchen sowohl `noindex` als auch dynamische/no-store Semantik. |
| Tests nur Phase 17 | jede Phase liefert Unit/Integration; Phase 17 liefert Cross-role E2E-01–07/Regression, Phase 18 den release-/restoreabhängigen E2E-08. |

## 8. Informationsarchitektur und Routen

Die vollständige Routenliste mit Zweck, Primäraktion, Daten, Policies, Zuständen und Mobile-Verhalten steht in [`architecture-blueprint.md`](./architecture-blueprint.md) §5. Sie erweitert die alte Route-Liste insbesondere um:

- Candidate Saved-Job-, Application-, Message- und Talent-Radar-Details;
- Employer Team/Invitations und Contact-Request-Details;
- Admin Detail-, Taxonomy-, Privacy-, Audit- und Systemrouten;
- `/health/live` und `/health/ready`.

Eine Route darf erst Navigation erhalten, wenn sie einen funktionalen Zustand oder einen ausdrücklich als zukünftig markierten, nicht irreführenden Locked State besitzt.

## 9. Zielbefehle und Evidence

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

Erwartet wird Exit-Code 0 sowie phasenspezifische DB-/HTTP-/Browser-Assertions. Die endgültigen Scripts werden in Phase 01 plattformneutral definiert. Kein nicht ausführbarer Befehl wird als bestanden markiert.

## 10. Produkt- und Release-Gates

### Planbereit für Implementierungsstart

- alle P0-Planwidersprüche besitzen eine dokumentierte Auflösung;
- jede wichtige Anforderung hat Requirement-ID, Phase und Testweg;
- jede Phase hat Ziel, Nutzen, Rollen, Voraussetzungen, Deliverables, Daten/Actions, Policies, UX, Seed, Tests, Befehle, Risiken und DoD;
- offene Rechts-/Steuer-/Provider-/Markthypothesen sind als solche markiert;
- Start erfolgt mit Schritt 01, nicht mit einem Feature-Sprung.

### Pilotbereit (später, durch Code zu beweisen)

- E2E-01 bis E2E-08 grün;
- 0 offene P0 Auditpunkte und 0 kritische Accessibility-/Security-Funde;
- Cross-Tenant- und Talent-PII-Leak-Tests grün;
- Mock-Billing exakt einmal, Ledger nicht negativ, Rechnung in Rappen korrekt;
- alle wichtigen mobilen States geprüft;
- Migration, Clean Seed, Build, Backup/Restore und Staging-Smoke belegt;
- Legal-/Privacy-/Tax-Go-live-Entscheidung separat erfolgt.

## 11. Definition of Done

Eine Funktion/Phase gilt nur als umgesetzt, wenn:

1. persistentes Modell/Migration und realistische Fixture existieren;
2. Query/Mutation über klare Domain-Grenze läuft;
3. Zod, Rolle, Tenant, Ownership, Assignment, Entitlement und Status serverseitig gelten;
4. Transaktion, Idempotenz, Audit und Notification zum Risiko passen;
5. Loading/Empty/Error/Success/Locked/Forbidden/Conflict und Mobile/A11y bewusst gelöst sind;
6. Unit plus relevante Postgres-Integration und Browserpfade grün sind;
7. Observability und Dokumentation aktuell sind;
8. Evidence im Zielrepository vorliegt.

## 12. Startpunkt

Phase 01 wurde gemäss [`01-setup-foundation.md`](./01-setup-foundation.md) umgesetzt und verifiziert. Der nächste zulässige Implementierungsschritt ist Phase 02; die Referenz aus `PortalGIT` bleibt reine Vergleichsbasis und darf weiterhin nicht blind übernommen werden.
