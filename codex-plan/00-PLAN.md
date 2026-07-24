# SwissTalentHub — Masterplan

> **Planstatus:** vollständig überarbeitete Planungsgrundlage, Stand 24. Juli 2026. **Phasen 01 bis 16 sind im Zielrepository implementiert und verifiziert. Phase 17 ist lokal vollständig verifiziert und bleibt nur bis zum Remote-CI-/Artefaktnachweis offen; Phase 18 ist offen.** Foundation, persistenter Domänenvertrag, Core Policies, lokale Provider-Mocks, deterministische Demo-Seeds, End-to-End-Auth, öffentliche Discovery, Pricing und Arbeitgeberakquise, Candidate-/Employer-/Recruiter-Core, Admin-Operations/Moderation, Katalog/Billing, Job-Boosts, Talent-Radar Contact/Reveal und Privacy-Cases, Search/SEO sowie Security/Operations ergeben noch kein freigegebenes Produkt: E2E-08, Clean Clone, Backup/Restore und Release-Audit folgen in Phase 18. Mock Payment umfasst weder Stripe noch echte Webhooks; ein autonomer Renewal-Worker ist nicht vorhanden. Export/Löschung bleiben P0-Mocks ohne automatische Datenbereitstellung oder Erasure. Das separat gegatete P1-Paket REQ-REC-002 (externe Agenturmandate) bleibt ausdrücklich offen.

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

Das Quellprojekt besass lediglich eine Phase-01-Referenz: statische Homepage/UI-Primitives, leeres Prisma-Schema, Placeholder-Seed, keine Domainlogik/Auth/APIs/Tests. Diese Foundation wurde **nicht** als Zielimplementierung gewertet oder kopiert. PortalGERM erhielt danach eine eigenständig gepinnte und geprüfte Phase-01-Basis, den unabhängig auditierten Phase-02-Domänenvertrag, die reproduzierbar verifizierten Phase-03-Core-Policies, die netzwerkfreien Phase-04-Provider-Mocks, den deterministischen Phase-05-Demo-Seed mit Produktionssperre, End-to-End-Auth aus Phase 06, die sicher projizierte öffentliche Discovery aus Phase 07, fail-closed Pricing und Arbeitgeberakquise aus Phase 08, den vollständig geprüften Candidate-Core aus Phase 09, den tenant- und assignment-gesicherten Employer/Recruiter-Core aus Phase 10, die capability-gesicherten Admin-Operations aus Phase 11, die zentrale Katalog-, Entitlement-, Credit-, Subscription-, Order-, Invoice- und Mock-Fulfillment-Domain aus Phase 12, den atomaren Job-Boost-Lifecycle aus Phase 13, den privacy-bounded Talent-Radar-/Reveal-Vertrag aus Phase 14, datenbankgerankte Search-/SEO-/Cluster-Gates aus Phase 15 sowie per-request CSP, CSRF-/IDOR-/Cache-Härtung, Audit-Vollständigkeit, redigiertes Logging, Health/Readiness und Security-Maintenance aus Phase 16. Die Nachweise referenzieren unveränderliche Code-Commits in [`evidence/2026-07-19-phase-01.md`](./evidence/2026-07-19-phase-01.md), [`evidence/2026-07-19-phase-02.md`](./evidence/2026-07-19-phase-02.md), [`evidence/2026-07-19-phase-03.md`](./evidence/2026-07-19-phase-03.md), [`evidence/2026-07-20-phase-04.md`](./evidence/2026-07-20-phase-04.md), [`evidence/2026-07-20-phase-05.md`](./evidence/2026-07-20-phase-05.md), [`evidence/2026-07-20-phase-06.md`](./evidence/2026-07-20-phase-06.md), [`evidence/2026-07-20-phase-07.md`](./evidence/2026-07-20-phase-07.md), [`evidence/2026-07-20-phase-08.md`](./evidence/2026-07-20-phase-08.md), [`evidence/2026-07-20-phase-09.md`](./evidence/2026-07-20-phase-09.md), [`evidence/2026-07-21-phase-10.md`](./evidence/2026-07-21-phase-10.md), [`evidence/2026-07-21-phase-11.md`](./evidence/2026-07-21-phase-11.md), [`evidence/2026-07-22-phase-12.md`](./evidence/2026-07-22-phase-12.md), [`evidence/2026-07-22-phase-13.md`](./evidence/2026-07-22-phase-13.md), [`evidence/2026-07-22-phase-14.md`](./evidence/2026-07-22-phase-14.md), [`evidence/2026-07-22-phase-15.md`](./evidence/2026-07-22-phase-15.md) und [`evidence/2026-07-23-phase-16.md`](./evidence/2026-07-23-phase-16.md). Historische Details: [`repository-audit.md`](./repository-audit.md).

Der Phase-17-Code-Commit `fb7bc56b76b33d7ca5ad3725984cbf72d20f0696` ergänzt darauf einen Production-Browser-Harness mit isolierter migrierter PostgreSQL-Datenbank, logischer Serveruhr, blockiertem externem Netzwerk, E2E-01–07, einer Desktop-/360px-Quality-Matrix, einem maschinenlesbaren Zero-Retry-Manifest und Linux-/Windows-CI. Der vollständige lokale Lauf ist mit 1.940 Unit-, 369 PostgreSQL-Integration- und 17 Browsertests ohne Skip/Retry bestanden; die [Phase-17-Evidence](./evidence/2026-07-23-phase-17.md) bleibt bis zum verlinkten Remote-CI-/Artefaktnachweis vorläufig.

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

| Stufe     | Bedeutung                                  | Beispiele                                                                                                                                              |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0        | kontrolliertes MVP funktioniert end-to-end | Auth/Tenant, öffentliche Suche, JobPass, Bewerbung, Company/Job/Moderation, Billing Mock, Boost, Radar Contact/Reveal, Adminqueues, Security-/DB-Tests |
| P1        | überzeugender Pilot/Marktstart             | Jahrespläne, Agenturmandate, erweiterte Analytics/Cockpit, Growth-Gates, Worker/Delivery-Queue, Deployment/Backup/Monitoring                           |
| P2        | nach erstem Marktfeedback                  | zusätzliche Sponsored-Produkte, breitere Mehrsprachigkeit, fortgeschrittene Suche, Visual Regression, Refund-Automation                                |
| später    | explizites Folgeprojekt                    | reale Provider, ATS/API/SSO, Enterprise Billing, employerseitige Match-Sortierung nach Prüfung, Success Fee nach Legal Review                          |
| verworfen | nicht bauen                                | Scraping, globale Reveals, bezahlte Fairness, Fake-Aktivität, automatische Ablehnung, dünne SEO-Massenpages                                            |

## 6. Phasen und Verantwortungsgrenzen

> Jede Phase bleibt `[ ]`, bis Code, Persistenz, Server-Policies, UX-Zustände, Seeds, Tests und Evidence im **Zielrepository** vollständig vorhanden sind.

### [x] 01 — Foundation und Governance

[`01-setup-foundation.md`](./01-setup-foundation.md) · reproduzierbare Windows/CI-kompatible Toolchain, Env, App-/DB-Skeleton, Evidence. Keine Quellhäkchen übernehmen.

### [x] 02 — Schema und Migrationen

[`02-prisma-schema.md`](./02-prisma-schema.md) · draftfähige Profile, Tenant-/Job-/Application-/Privacy-/Billing-/Ops-Modelle, Constraints, Indizes und echte Migrationen.

### [x] 03 — Core Policies und Scoring

[`03-core-libraries-scoring.md`](./03-core-libraries-scoring.md) · Auth-/Ownership-/Entitlement-Policies, Statusmaschinen, Safe DTOs, Fair/Match, Rappen/VAT, Audit/Events plus Unit-/DB-Tests.

### [x] 04 — Provider Ports und Mocks

[`04-mock-adapters.md`](./04-mock-adapters.md) · persistierende, netzwerkfreie Adapter; Payment-Adapter besitzt nicht das Fulfillment.

### [x] 05 — Seed und Test-Harness

[`05-seed-data.md`](./05-seed-data.md) · deterministische positive/negative Fixtures, Prod-Guard, Idempotenz, manifestierte Counts.

### [x] 06 — Auth, Tenant und Onboarding

[`06-auth-rbac.md`](./06-auth-rbac.md) · Auth-End-to-End, Sessions, Firmenkontext, Einladungsgrundlage, vollständige RBAC-/IDOR-Tests.

### [x] 07 — Öffentliche Discovery

[`07-public-pages.md`](./07-public-pages.md) · nützliche Suche/Detail/Firma/Salary/Guide; Clusterseiten bis SEO-Gate nicht indexiert.

### [x] 08 — Pricing und Arbeitgeberakquise

[`08-pricing-employer-marketing.md`](./08-pricing-employer-marketing.md) · klare Pakete, ehrliche Marketingpages, persistierter/geschützter Demo-Lead.

### [x] 09 — Kandidaten-Core

[`09-candidate-portal.md`](./09-candidate-portal.md) · JobPass, Saved Jobs, Apply/Withdraw/Status, Alerts, Messaging und Privacy-Basics sind implementiert und gegen den unveränderlichen Code-Commit verifiziert. Die Employer-Pipeline-Mutationen sind seit Phase 10 und Radar Contact/Reveal seit Phase 14 umgesetzt; Phase 17 besitzt weiterhin die vollständige Cross-role-E2E-Journey.

### [x] 10 — Arbeitgeber- und Recruiter-Core

[`10-employer-portal.md`](./10-employer-portal.md) · Company/Verification Request, Team, tokenfreie Einladungsfortsetzung, Jobs/Wizard, Assignments, Pipeline und evidenzbasierte Basis-Analytics sind im Code-Commit `b7afb617876624118cd8c5ea41d4942dfe6c88f1` verifiziert; Billing/Radar bleiben ehrliche Locked States. Das separat gegatete REQ-REC-002-Paket ist deferred und bleibt `[ ]`.

### [x] 11 — Admin und Moderation

[`11-admin-portal.md`](./11-admin-portal.md) · Job/Firma/User/Report/Import/Support/Content/Lead-Queues und evidenzbasiertes Business Cockpit sind im ursprünglichen Code-Commit `b115b49d94297c94df0b85fb40e056d2024fc582` verifiziert; der unabhängig bewertete Follow-up-Audit schließt die bestätigten UI-/Audit-/Seed-/Testlücken im Code-Commit `ee57eecca4dcee70764fcd48aeebd7b413b5ad54` ([Evidence](./evidence/2026-07-22-phase-11-follow-up.md)). Keine konkurrierende Payment-/Katalog-Logik.

### [x] 12 — Entitlements und Billing

[`12-monetization-billing.md`](./12-monetization-billing.md) · alleinige Catalog-/Plan-/Order-/Invoice-/Subscription-/Credit-/Fulfillment-Domain sowie Employer-/Admin-Billing-Routen sind im Code-Commit `b28245e6ba1c2fce29c5b05f2383410da0d7410e` verifiziert; siehe [Phase-12-Evidence](./evidence/2026-07-22-phase-12.md). Payment bleibt ein lokaler Mock ohne Stripe/Webhooks, und ein echter autonomer Renewal-Worker bleibt offen.

### [x] 13 — Job Boosts

[`13-job-boosts.md`](./13-job-boosts.md) · validiertes Jobziel, atomarer Credit-/Paid-Lifecycle, non-overlap, Kündigung, vollständige Kennzeichnung und transparenter relevanzgebundener Rang sind im Code-Commit `45926f9d15606c6e209a2b7cb8937048636816bd` verifiziert; siehe [Phase-13-Evidence](./evidence/2026-07-22-phase-13.md).

### [x] 14 — Talent Radar und Privacy

[`14-talent-radar-privacy.md`](./14-talent-radar-privacy.md) · kanonisches Opt-in, Safe DTO/opaque ID, bounded Cohort/Enumeration, atomarer Contact Ledger, Accept/Decline, verschlüsselte request-scoped Reveal-Snapshots und capability-gebundene Privacy Cases sind im finalen Code-Commit `fadf54e6b896350ef8488c7b2361a8f91666e638` verifiziert; siehe [Phase-14-Evidence](./evidence/2026-07-22-phase-14.md).

### [x] 15 — Search, SEO und Growth

[`15-seo-search.md`](./15-seo-search.md) · global datenbankgerankte Keyset-Suche, stabile Job-Slugs, Canonicals, JobPosting-JSON-LD, dynamische fail-closed Sitemap, Robots-/Private-Index-Schutz sowie das dual freigegebene Content-/Liquiditätsgate sind im Code-Commit `f3f6bcc29eeafb3fe3b3c37360782ef9014aa7d4` verifiziert; siehe [Phase-15-Evidence](./evidence/2026-07-22-phase-15.md). Referral Attribution bleibt hinter REQ-GRW-003 gesperrt.

### [x] 16 — Security und Operations

[`16-security-hardening.md`](./16-security-hardening.md) · per-request CSP/Nonce, CSRF-/IDOR-/Cache-Härtung, vollständige 122-Action-Audit-Evidenz, HMAC-IP-Retention, Abuse-Flows, strukturiertes redigiertes Logging sowie Health/Readiness sind im Code-Commit `b052dffe217c0e255664b91ba02c0a39b7321fc5` verifiziert; siehe [Phase-16-Evidence](./evidence/2026-07-23-phase-16.md). Production-Go-live und reale TLS-Wirkung werden nicht behauptet.

### [ ] 17 — Cross-role Verification

[`17-testing.md`](./17-testing.md) · Owning-phase Regression plus E2E-01 bis E2E-07, A11y/Mobile/Performance und der vollständige lokale Gate-Lauf sind grün. Die Phase bleibt nur bis zum Remote-CI-/Artefaktnachweis `[ ]`; E2E-08 gehört Phase 18.

### [ ] 18 — Dokumentation und Release-Audit

[`18-documentation-final-audit.md`](./18-documentation-final-audit.md) · E2E-08 Clean Clone, Migration/Seed, Production-Demo-Guard, Backup/isolierter Restore/Smoke, Evidence, Abschlussbericht und ehrliche Pilotgrenzen.

Die genaue Abhängigkeitsgrafik und jedes ausführbare Arbeitspaket stehen in [`implementation-plan.md`](./implementation-plan.md).

## 7. Verantwortungsauflösung alter Konflikte

| Konflikt                 | Verbindliche Auflösung                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Admin vs Billing         | Phase 12 besitzt Pricing, Payment Confirmation, Invoice und Fulfillment. Phase 11 baut nur Shell/Queues ohne parallelen Service.       |
| Boost-Checkout ohne Ziel | OrderLine/FulfillmentContext speichert serverseitig geprüftes `jobId`; Phase 13 registriert Handler.                                   |
| zwei Upgrade-Modals      | eine gemeinsame Billing-Komponente und ein `LIMIT`-Resultat.                                                                           |
| Limit bei Submit/Publish | Draft/Submit erlaubt; jede Transition nach `PUBLISHED`/Reaktivierung prüft Kontingent atomar.                                          |
| Radar-ID                 | opaque, serverseitig gemappte ID; nie Handle oder PK als Autorisierungsgrenze.                                                         |
| Reveal global vs Thread  | Grant für Candidate + Company + ContactRequest/Conversation; kein globales Reveal.                                                     |
| Allowance vs Pack        | Ledger mit `fundingSource`, Periode, Grant und Idempotenz; gekaufte Credits zählen nicht als Planverbrauch.                            |
| Boost vs Sort/Pagination | Relevanz zuerst; klar begrenzte Sponsored-Zone; stabiles Sortiertupel global vor Pagination.                                           |
| 403 vs 404 IDOR          | fremde/nicht existente Tenant-Ressource liefert sichere 404; echter Rollenfehler ohne Objektbezug kann 403 sein.                       |
| Noindex vs Cache         | private Seiten brauchen sowohl `noindex` als auch dynamische/no-store Semantik.                                                        |
| Tests nur Phase 17       | jede Phase liefert Unit/Integration; Phase 17 liefert Cross-role E2E-01–07/Regression, Phase 18 den release-/restoreabhängigen E2E-08. |

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
npm run build
npm run test:e2e:http
npm run test:e2e:browser
npm run test:e2e:hsts
```

`npm run test:e2e` bleibt der kombinierte HTTP- plus Browserbefehl; der Abschlussnachweis führt die Teilgates getrennt auf, damit ein Fehler eindeutig zuordenbar ist. Erwartet wird Exit-Code 0 sowie phasenspezifische DB-/HTTP-/Browser-Assertions. Kein nicht ausführbarer, nur gezielt ausgeführter oder durch Retries maskierter Befehl wird als bestanden markiert.

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

Phasen 01 bis 16 wurden gemäss ihren Detailverträgen umgesetzt und verifiziert. Phase 17 ist lokal vollständig grün; als letzter Schritt folgt der Linux-/Windows-CI-/Artefaktnachweis und erst danach das Setzen von `[x]`. Anschliessend folgt Phase 18 mit Clean Clone, Backup/Restore und Release-Audit. Die Referenz aus `PortalGIT` bleibt reine Vergleichsbasis und darf weiterhin nicht blind übernommen werden.
