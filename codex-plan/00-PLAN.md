# SwissTalentHub — Masterplan

> **Planstatus:** Stand 26. Juli 2026. **Phasen 01 bis 20 sind im Zielrepository implementiert und commitgebunden verifiziert.** Phase 19 versiegelt auf `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` die Clean-Clone-/Governance-Baseline; Phase 20 schliesst auf Candidate `59089009f54312a4c10989b7efde2d5fda9a2b8d` den technischen Identity-, E-Mail-Change-, Outbox-, Dispatcher- und Preference-Vertrag. Siehe [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) und [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md). Reale E-Mail-Aktivierung, autonome Worker, Production-Replay und MFA/Step-up bleiben ausdrücklich offen. Auch die übrigen fachlichen Befunde bleiben nach Status, Trigger oder externem Gate in den Phasen 21 bis 32. Weder historische Evidence noch die grüne LC1-/Sandbox-Baseline ist eine Pilot- oder Produktionsfreigabe. Staging, ausgewählte reale Provider, produktiver Backup-Lifecycle und autonome Worker sind noch umzusetzende beziehungsweise real zu betreibende Lieferobjekte; AVG/Legal/Privacy/Tax, Providerverträge, bezahlte Marktvalidierung, Cashflow/Runway, LIVE-Daten, RPO/RTO, Incident Ownership und Operationskapazität benötigen zusätzlich externe oder organisatorische Freigaben. Mock Payment umfasst weder Stripe noch echte Webhooks und belegt keine Zahlungsbereitschaft; Export/Löschung bleiben kontrollierte MVP-Mocks ohne reale Datenbereitstellung oder Erasure. Das separat gegatete REQ-REC-002-Paket bleibt offen.

## 1. Lesereihenfolge und Konfliktpräzedenz

Die folgende Liste ist die empfohlene **Lesereihenfolge**, nicht die Konflikthierarchie. Für widersprüchliche Aussagen gilt überall identisch: `AGENTS.md`/Masterauftrag → explizite freigegebene ADR in `decisions.md` → `requirements-matrix.md` → aktueller Masterplan/Architecture Blueprint/Product Strategy → ausführende Phase/Implementation Plan → übertragenes Legacy-Inventar. Quickref/Glossary fassen zusammen und dürfen eine höher priorisierte Detailentscheidung nicht überschreiben; ein Konflikt wird an der niedrigeren Stelle repariert statt interpretiert.

1. [`../AGENTS.md`](../AGENTS.md) — verbindliche Arbeits- und Evidence-Regeln.
2. [`99-rules-quickref.md`](./99-rules-quickref.md) — nicht verhandelbare Produkt-/Technikregeln.
3. [`product-strategy.md`](./product-strategy.md) — Zielgruppen, Positionierung, Marketplace, Journeys, Growth, Monetarisierung und KPIs.
4. [`commercial-go-live-gates.md`](./commercial-go-live-gates.md) — bezahlte Marktvalidierung, Cashflow, Packaging, AVG, LIVE-Lohndaten, Worker, Startcluster-Suchqualität und Sitemap-Kapazitätsgates.
5. [`remediation-masterplan.md`](./remediation-masterplan.md) — verbindlicher Ausführungs-, Abhängigkeits-, Risiko- und Evidence-Rahmen für die offenen Phasen 19 bis 32.
6. [`remediation-execution-contract.md`](./remediation-execution-contract.md) — sechs Launchklassen, vier Statusdimensionen, 28 Pflichtfelder, Test-/Golden-/Evidence- und Folgephasengates.
7. [`remediation-traceability.md`](./remediation-traceability.md) — unabhängige Einzelbewertung und lückenlose Zuordnung aller Befunde `STH-001` bis `STH-037`.
8. [`architecture-blueprint.md`](./architecture-blueprint.md) — Ist-Kern sowie prospektive Rollen, Routen, Daten, Use Cases, Security, UX, Test und Betrieb.
9. [`requirements-matrix.md`](./requirements-matrix.md) — Anforderung → Phase → Modell → Policy → UX → Test → Abnahme.
10. [`decisions.md`](./decisions.md) und [`glossary.md`](./glossary.md) — verbindliche ADRs und Begriffe.
11. [`route-role-matrix.md`](./route-role-matrix.md) und
    [`route-inventory.json`](./route-inventory.json) — tatsächliches
    Ist-Inventar getrennt vom geplanten Phase-19+-Delta.
12. [`product-quality-gates.md`](./product-quality-gates.md) und
    [`release-checklist.md`](./release-checklist.md) — Feature-, Launchklassen-
    und Release-Gates.
13. [`plan-audit.md`](./plan-audit.md) — Konflikte, Klassifizierung, offene Entscheidungen und verworfener Scope.
14. [`implementation-plan.md`](./implementation-plan.md) — historischer Plan 01–18 plus prospektiver kritischer Pfad 19–32.
15. [`runbooks/remediation-production-target.md`](./runbooks/remediation-production-target.md)
    — geplanter LC2–LC6-Ops-/Recovery-Vertrag; noch nicht ausgeführt.
16. Die Detailphasen `01` bis `18` — implementierte technische Deliverables und ihre Evidence.
17. Die Detailphasen `19` und `20` — abgeschlossene Remediation-Arbeitspakete — sowie `21` bis `32` als offene Arbeitspakete; ein Plandokument ist keine Erledigung.
18. [`remediation-evidence-template.md`](./remediation-evidence-template.md)
    — leere, nicht rückwirkende Evidence-Vorlage für Phase 19+.

Das historisch referenzierte `../plan.md` existiert nicht. Diese lokale Dokumentgruppe ist deshalb die alleinige Planungsquelle. Tote `plan.md §…`-Verweise begründen keine zusätzliche oder abweichende Anforderung.

## 2. Executive Summary

SwissTalentHub ist eine Schweizer Karriere-Entscheidungsplattform mit Stellenmarktplatz. Kandidaten erhalten vor Registrierung Transparenz über Stelle, Lohn und Inseratqualität und bauen danach mit SwissJobPass, Jobabos, Bewerbungsstatus und freiwilligem anonymem Talent Radar wiederkehrenden Nutzen auf. Arbeitgeber erhalten einen geführten Jobprozess, Bewerberpipeline, resultatbezogene Analytics und klar bepreiste Kontingente/Workflows. Admins betreiben Moderation, Verifizierung, Import, Billing, Datenschutzfälle, Sales und Marketplace-Liquidität über handlungsorientierte Queues.

Der Markteintritt ist bewusst fokussiert: Zürich/Aargau/Bern ist die
deutschsprachige Regionshypothese; Pflege/Gesundheit und
Engineering/Technik sind zwei zu vergleichende Berufskandidaten. Phase 31A
wählt davon anhand realer Angebots-/Nachfrage-, WTP-, Operationskosten-,
Rechts- und Search-Evidence **genau einen** ersten Region×Beruf-Cluster.
Der andere bleibt ungeöffnet; seine separate fachliche Testmenge kann nicht
durch Evidence des gewählten Clusters ersetzt werden. Breite, Regionen und
Sprachen werden erst nach eigenen Gates erweitert.

Die wichtigsten Differenzierungen sind:

- erklärbarer, versionierter Fair-Job-Score ohne Einfluss bezahlter Reichweite;
- Lohnorientierung und strukturierter SwissJobPass;
- Kandidatenkontrolle und Server-Anonymisierung im Talent Radar;
- Anti-Ghosting durch messbare Antwortprozesse statt unbelegtem Badge;
- Arbeitgeber-Cockpit mit Handlungsempfehlungen statt Vanity-Metriken.

## 3. Verifizierter Repository-Status

Der vollständige Ausgangs-`codex-plan` mit 24 Dateien wurde in das leere Ziel übertragen und vor Überarbeitung per SHA-256 bytegenau verglichen. Das verlinkte Root-`AGENTS.md` wurde zusätzlich übernommen. Der Ziel-Baseline-Commit enthielt nur `README.md`.

Das Quellprojekt besass lediglich eine Phase-01-Referenz: statische Homepage/UI-Primitives, leeres Prisma-Schema, Placeholder-Seed, keine Domainlogik/Auth/APIs/Tests. Diese Foundation wurde **nicht** als Zielimplementierung gewertet oder kopiert. PortalGERM erhielt danach eine eigenständig gepinnte und geprüfte Phase-01-Basis, den unabhängig auditierten Phase-02-Domänenvertrag, die reproduzierbar verifizierten Phase-03-Core-Policies, die netzwerkfreien Phase-04-Provider-Mocks, den deterministischen Phase-05-Demo-Seed mit Produktionssperre, End-to-End-Auth aus Phase 06, die sicher projizierte öffentliche Discovery aus Phase 07, fail-closed Pricing und Arbeitgeberakquise aus Phase 08, den vollständig geprüften Candidate-Core aus Phase 09, den tenant- und assignment-gesicherten Employer/Recruiter-Core aus Phase 10, die capability-gesicherten Admin-Operations aus Phase 11, die zentrale Katalog-, Entitlement-, Credit-, Subscription-, Order-, Invoice- und Mock-Fulfillment-Domain aus Phase 12, den atomaren Job-Boost-Lifecycle aus Phase 13, den privacy-bounded Talent-Radar-/Reveal-Vertrag aus Phase 14, datenbankgerankte Search-/SEO-/Cluster-Gates aus Phase 15 sowie per-request CSP, CSRF-/IDOR-/Cache-Härtung, Audit-Vollständigkeit, redigiertes Logging, Health/Readiness und Security-Maintenance aus Phase 16. Die Nachweise referenzieren unveränderliche Code-Commits in [`evidence/2026-07-19-phase-01.md`](./evidence/2026-07-19-phase-01.md), [`evidence/2026-07-19-phase-02.md`](./evidence/2026-07-19-phase-02.md), [`evidence/2026-07-19-phase-03.md`](./evidence/2026-07-19-phase-03.md), [`evidence/2026-07-20-phase-04.md`](./evidence/2026-07-20-phase-04.md), [`evidence/2026-07-20-phase-05.md`](./evidence/2026-07-20-phase-05.md), [`evidence/2026-07-20-phase-06.md`](./evidence/2026-07-20-phase-06.md), [`evidence/2026-07-20-phase-07.md`](./evidence/2026-07-20-phase-07.md), [`evidence/2026-07-20-phase-08.md`](./evidence/2026-07-20-phase-08.md), [`evidence/2026-07-20-phase-09.md`](./evidence/2026-07-20-phase-09.md), [`evidence/2026-07-21-phase-10.md`](./evidence/2026-07-21-phase-10.md), [`evidence/2026-07-21-phase-11.md`](./evidence/2026-07-21-phase-11.md), [`evidence/2026-07-22-phase-12.md`](./evidence/2026-07-22-phase-12.md), [`evidence/2026-07-22-phase-13.md`](./evidence/2026-07-22-phase-13.md), [`evidence/2026-07-22-phase-14.md`](./evidence/2026-07-22-phase-14.md), [`evidence/2026-07-22-phase-15.md`](./evidence/2026-07-22-phase-15.md) und [`evidence/2026-07-23-phase-16.md`](./evidence/2026-07-23-phase-16.md). Historische Details: [`repository-audit.md`](./repository-audit.md).

Der Phase-17-Code-Commit `fb7bc56b76b33d7ca5ad3725984cbf72d20f0696` ergänzt darauf einen Production-Browser-Harness mit isolierter migrierter PostgreSQL-Datenbank, logischer Serveruhr, blockiertem externem Netzwerk, E2E-01–07, einer Desktop-/360px-Quality-Matrix und einem maschinenlesbaren Zero-Retry-Manifest. Der vollständige lokale Lauf ist mit 1.940 Unit-, 369 PostgreSQL-Integration- und 17 Browsertests ohne Skip/Retry bestanden. Der CI-Zielcommit `02c6a51a01dd3b81a4eb53e0b989c3ef83c4d832` ist zusätzlich auf `main` und dem Phasen-Branch mit Linux/PostgreSQL 16, Windows, Browser, HSTS und zwei 14-Tage-Artefakten grün; siehe [Phase-17-Evidence](./evidence/2026-07-23-phase-17.md).

## 4. Unverhandelbare Invarianten

- Talent-Radar-Identität bleibt bis zum ausdrücklichen kandidateninitiierten Reveal verborgen; Reveal gilt nur für vorgesehene Firma und Anfrage/Thread.
- Rollen, Tenant, Ownership, Assignment, Entitlement und Status werden serverseitig geprüft.
- Geld wird in ganzen Rappen gespeichert; Lohnspannen bleiben ganze CHF. Preise kommen nie vom Client.
- Credit-/Allowance-Verbrauch und Fulfillment sind atomar, idempotent und ledgerbasiert.
- Boosts sind immer „Geboostet“ und beeinflussen niemals den Fair-Job-Score.
- Match-Score ist P0 eine kandidatenorientierte Entscheidungshilfe, keine automatische Arbeitgeberentscheidung.
- Externe Systeme bleiben bis zur expliziten Freigabe ihrer besitzenden Remediation-Phase persistierende Mock-Adapter. Reale Adapter benötigen einen eigenen ADR sowie Provider-, Legal-, Operations- und Release-Gates; ein automatischer Env-Switch bleibt verboten.
- Keine fremden Portale scrapen/kopieren; Import braucht Nutzungsgrundlage und Preview.
- Keine volle DSG-/Rechts-/Steuer- oder Produktionsreife behaupten. Success Fee bleibt deaktiviert.
- Kein UI-only Feature, keine harte Demozahl als Marktnachweis und kein `[x]` ohne neue Evidence im Ziel.

## 5. Priorisierung

| Stufe     | Bedeutung                                  | Beispiele                                                                                                                                              |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0        | kontrolliertes MVP funktioniert end-to-end | Auth/Tenant, öffentliche Suche, JobPass, Bewerbung, Company/Job/Moderation, Billing Mock, Boost, Radar Contact/Reveal, Adminqueues, Security-/DB-Tests |
| P1        | überzeugender Pilot/Marktstart             | AVG-/Tax-/Vertragsgate, echte bezahlte Design-Partner-Validierung, Cashflow/Runway, LIVE-Lohndaten, Jahrespläne, Agenturmandate, erweiterte Analytics/Cockpit, Growth-Gates, Worker/Delivery-Queue, Deployment/Backup/Monitoring |
| P2        | nach erstem Marktfeedback                  | zusätzliche Sponsored-Produkte, breitere Mehrsprachigkeit, fortgeschrittene Suche, Visual Regression, Refund-Automation                                |
| später    | explizites Folgeprojekt                    | skalierte reale Provider nach separaten ADRs, ATS/API/SSO, Enterprise Billing, employerseitige Match-Sortierung nach Prüfung, Success Fee nach AVG-/Legal Review |
| verworfen | nicht bauen                                | Scraping, globale Reveals, bezahlte Fairness, Fake-Aktivität, automatische Ablehnung, dünne SEO-Massenpages                                            |

Diese Tabelle beschreibt die historische Produktpriorisierung der Phasen 01 bis
18. Für einen realen Pilot oder Produktionsbetrieb gelten zusätzlich die neu
bewerteten Prioritäten und Launchklassen aus
[`remediation-traceability.md`](./remediation-traceability.md) und
[`remediation-masterplan.md`](./remediation-masterplan.md). Insbesondere sind
dort E-Mail-Identität, Dokumente, Privacy, ausgewählte reale Provider, autonome
Worker, Admin-Security, Company Trust und der exakte Release-Audit als P0-Gates
eingestuft. Die kontrollierte Berufs-/Ort-/Qualifikations-/Skill-/Branchen-
Suche ist für jeden tatsächlich aktivierten LC3+-Cluster P0; in LC2 P1 und
in der lokalen Demo P2. „Fortgeschrittene Suche“ unter P2 meint nur
Breite außerhalb des Launchscopes, landesweite Mehrsprachigkeit oder optionale
semantische/Hybrid-Komponenten. Nicht ausgelöste Kapazitätsvorsorge wie
STH-027 ist P3 und wird mit Headroom, Forecast, Alert und Owner deferred, nicht
mit einem heutigen P0/P1-Defect gleichgesetzt. „Später“ meint nur Provider und
Integrationen außerhalb des konkret freigegebenen Launchumfangs.

Die verbindlichen Launchklassen sind: LC1 lokaler Demo-MVP, LC2
beaufsichtigter Design-Partner-Test, LC3 Invite-only Pilot, LC4 öffentlicher
kostenloser Launch, LC5 bezahlter Self-Service und LC6 skalierter
Produktionsbetrieb. P0–P4 wird je Klasse bewertet; der kleinere Scope hebt
Security-, Privacy-, Payment- oder Tenant-Negativtests nicht auf.

## 6. Phasen und Verantwortungsgrenzen

> Jede neue oder noch offene Phase bleibt `[ ]`, bis Code, Persistenz, Server-Policies, UX-Zustände, Seeds, Tests und Evidence im **Zielrepository** vollständig vorhanden sind. Ein technisch abgeschlossener Phasen-Commit ist weiterhin keine LIVE-Freigabe, solange ein ausdrücklich ausgewiesenes Provider-, Legal-, Markt- oder Operations-Gate offen ist.

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

### [x] 17 — Cross-role Verification

[`17-testing.md`](./17-testing.md) · Owning-phase Regression plus E2E-01 bis E2E-07, A11y/Mobile/Performance, Linux/PostgreSQL 16, Windows-Portabilität, HSTS und Artefakte sind lokal sowie auf `main` und dem Phasen-Branch grün. E2E-08 gehört Phase 18.

### [x] 18 — Dokumentation und Release-Audit

[`18-documentation-final-audit.md`](./18-documentation-final-audit.md) · E2E-08 Clean Clone, Migration/Seed, Production-Demo-Guard, Backup/isolierter Restore/Smoke, vollständige Route-/Requirement-Evidence und Abschlussbericht sind auf `a9f24e7190681c23886de84add321db32b43651e` verifiziert; siehe [Phase-18-Evidence](./evidence/2026-07-24-phase-18.md). Externe Pilot-/Go-live-Gates bleiben offen.

### [x] 19 — Remediation-Baseline und Regression

[`19-remediation-baseline-regression.md`](./19-remediation-baseline-regression.md) · Candidate `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c`, Governance, Regressionvertrag, Inventare und alle 37 Befunde reproduzierbar eingefroren; 1.974 Unit-, 369 PostgreSQL- und 219 Browsertests sowie Recovery grün, siehe [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md).

### [x] 20 — Identity, E-Mail und Notifications

[`20-identity-email-notifications.md`](./20-identity-email-notifications.md) · E-Mail-Verifikation, sichere Login-E-Mail-Änderung, Privacy-Brücke, atomare Outbox, bounded Dispatcher und zentrale Notification Preferences sind auf Candidate `59089009f54312a4c10989b7efde2d5fda9a2b8d` technisch verifiziert; siehe [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md). LIVE-Zustellung, autonomer Worker und MFA/Step-up bleiben deaktiviert.

### [ ] 21 — Document-/CV-Vault

[`21-document-cv-vault.md`](./21-document-cv-vault.md) · echte, quarantänisierte und autorisierte Dokumentbytes mit Retention und Löschung.

### [ ] 22 — Privacy, Legal und Analytics

[`22-privacy-legal-analytics.md`](./22-privacy-legal-analytics.md) · reale Betroffenenprozesse, versionierte Rechtstexte und consent-bewusste LIVE-Analytics.

### [ ] 23 — Production Operations und Worker

[`23-production-operations-workers.md`](./23-production-operations-workers.md) · reale Provider-Governance, autonome Worker, Staging, Monitoring und Recovery.

### [ ] 24 — Reales Billing und Finance

[`24-real-billing-finance.md`](./24-real-billing-finance.md) · echter Checkout, Webhooks, Reconciliation, Refund/Dunning und freigegebene Rechnungen.

### [ ] 25 — Admin-Security

[`25-admin-security.md`](./25-admin-security.md) · Least-Privilege-Adminrollen, Separation of Duties sowie MFA/Step-up.

### [ ] 26 — Company Trust und Verifikation

[`26-company-trust-verification.md`](./26-company-trust-verification.md) · strukturierte Evidenz, Vier-Augen-Freigabe, Ablauf und Widerruf.

### [ ] 27 — Multi-Persona Identity

[`27-multi-persona-identity.md`](./27-multi-persona-identity.md) · additive Plattform-/Company-Personas mit explizitem aktivem Kontext.

### [ ] 28 — Recruiting-Workflows

[`28-recruiting-workflows.md`](./28-recruiting-workflows.md) · ehrlicher externer Bewerbungsstatus und persistente Interviewplanung.

### [ ] 29 — UX, Mobile und Accessibility

[`29-ux-mobile-accessibility.md`](./29-ux-mobile-accessibility.md) · Cross-Browser-/Assistive-Technology-Abnahme und mobile Action-Parität.

### [ ] 30 — Startcluster-Suche und Scale Operations

[`30-search-scale-operations.md`](./30-search-scale-operations.md) · früher
P1-Track 30A für kontrollierte Startcluster-Berufstaxonomie samt
Search-/Alert-/Recommendation-/Cluster-Gate-Parität; später skalierbare
Admin-/Dashboard-Reads sowie Sitemap-Kapazitätsmonitoring und
triggerbasiertes Sharding statt unnötigem Sofortumbau.

### [ ] 31 — Monetarisierung und Marktvalidierung

[`31-monetization-market-validation.md`](./31-monetization-market-validation.md) · früh startender ICP-/WTP-/Cashflow-Discovery-Track, reale Liquidität und spätere Freigabe nur tatsächlich lieferbarer Pakete.

### [ ] 32 — Finaler Production-Release-Audit

[`32-production-release-audit.md`](./32-production-release-audit.md) · vollständige automatische, manuelle, betriebliche und externe Evidence auf exakt einem Releasecommit/Artefakt.

Die historische Abhängigkeitsgrafik der Phasen 01 bis 18 steht in [`implementation-plan.md`](./implementation-plan.md). Für die abgeschlossenen Phasen 19 und 20 sowie die offenen Phasen 21 bis 32 sind Reihenfolge, Parallelisierung und Konfliktgrenzen verbindlich in [`remediation-masterplan.md`](./remediation-masterplan.md) festgelegt.

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
- Die historische Umsetzung begann mit Schritt 01; der Remediation-Strang
  begann zwingend mit der inzwischen verifizierten Phase 19 und nicht mit
  einem Feature-Sprung.

### Zielklassenspezifische Aktivierung (später durch Code und externe Evidence)

Jede Freigabe nennt LC1 lokale Demo, LC2 beaufsichtigten Design-Partner-Test,
LC3 Invite-only Pilot, LC4 Public Free, LC5 Paid Self-Service oder LC6 Scale.
Ein eng beaufsichtigter Design-Partner-/WTP-Test mit manueller Rechnung ist
kein öffentlicher Produktpilot und darf nur nach seinen eigenen AVG-,
Vertrags-, Tax-, Datenschutz- und Operations-Gates stattfinden. Die
zielklassenspezifische P0–P4-Matrix steht in
[`remediation-traceability.md`](./remediation-traceability.md).

- Phase 32 belegt auf exakt demselben aktuellen Releasecommit und
  Deploymentartefakt die zielrelevante vollständige Unit-/Integration-/HTTP-/
  Browser-/Security-/Accessibility-/Recovery-Suite sowie den manuellen
  Rollen-Walkthrough; historische E2E-01–08-Evidence allein genügt nicht;
- 0 offene P0 und 0 zielscope-relevante P1-Auditpunkte sowie 0 kritische
  Accessibility-/Security-Funde;
- Cross-Tenant- und Talent-PII-Leak-Tests grün;
- für einen kostenlosen Pilot sind sämtliche Kauf-CTAs fail-closed; für einen
  bezahlten Pilot sind realer Payment-/Rechnungs-/Reconciliation-Flow und
  Finance-Gates aus Phase 24 belegt. Mock-Billing zählt in keinem Fall;
- AVG/AVV-Einordnung und erforderliche Bewilligung des konkreten
  Stellenmarkt-/Radar-/Entgeltflows liegen vor;
- für einen bezahlten oder kommerziell beworbenen Pilot liegen echte
  Paid-WTP-Evidence und ein freigegebenes Cashflow-/Runway-Modell vor;
  Mock-Abschlüsse zählen null. Ein ausdrücklich kostenloser Lernpilot darf
  keine WTP behaupten und benötigt stattdessen freigegebenes Budget,
  Lernziel, Stopregel und weiterhin geschlossene Kauf-CTAs;
- Salary Radar bleibt ohne fachlich geprüften LIVE-Datensatz `noindex` und
  ausserhalb der Sitemap;
- Phase 31A hat genau einen ersten Region×Beruf-Cluster gewählt; Pflege und
  Engineering besitzen voneinander getrennte Korpora und der nichtgewählte
  Cluster bleibt ungeöffnet;
- jeder freizugebende LC3+-Startcluster besitzt eine versionierte,
  fachlich freigegebene Schweizer Berufstaxonomie mit Synonymen,
  Abkürzungen, neutralen/geschlechtsspezifischen und Schreibvarianten sowie
  kontrollierter Tippfehlertoleranz; Ort/Region, Qualifikation, Zertifikat,
  Skill und Branche folgen denselben Shared-Concept-/Ausschlussregeln;
- fachlich gleichwertige Berufsqueries liefern konsistente relevante
  Resultate; Search, Job-Alerts, Candidate Preferences, Recommendations,
  Matching und `ClusterLaunchAssessment V2` teilen den Taxonomie-/Search-
  Release. Das dokumentierte Golden-/Negativkorpus enthält für zentrale
  Begriffe keinen bekannten False-Zero bei vorhandener passender Stelle;
- Result-count-Buckets dürfen als bestehendes privacy-light Signal erhalten
  bleiben; neue Unknown-/Zero-Result-Lernsignale sind thresholded,
  retention-begrenzt, ohne Raw-PII/stabilen Userfingerprint und benötigen
  fachlichen Review vor jeder Taxonomieänderung;
- Phase 26 ist vor öffentlichem Firmenbadge, öffentlichem Firmenjob oder
  Radar-Trust verpflichtend; Evidenz, Ablauf/Re-review und schneller Entzug
  wirken auf alle Trustflächen;
- Job-Reconfirmation, Ablauf, Filled-/Unavailable-Meldung,
  Duplicate-/Copied-Job-Prüfung und Consumer-Parität sind für LC3+ belegt;
- Non-Admin-Step-up und Fraud-/ATO-/Scam-/Compromised-Company-/Mass-
  Contact-/Reveal-Export-Anomalie sind für den konkreten Scope getestet;
- moderierte Candidate-/Employer-/Operator-Aufgaben erreichen die
  vorregistrierten Task-Success-/Zeit-/Fehler-/Abbruch-/
  Verständnisschwellen; automatisierte A11y-Tests allein genügen nicht;
- Support-/Verification-/Moderation-/Privacy-/Fraud-Kapazität, Minuten je
  Flow, Vollkosten, Backlog-SLO, Overload-Verhalten und Owner sind belegt;
- STH-027 blockiert nur, wenn reale Count-/Byte-/Laufzeitmessung oder
  90-Tage-Prognose den freigegebenen Sitemap-Trigger erreicht. Unterhalb davon
  bleiben Single-Sitemap, fail-closed-Verhalten, Headroom-Monitoring, Alert,
  Runbook und Owner Pflicht; Index/Shards werden rechtzeitig vor dem Limit,
  aber nicht pauschal sofort gebaut;
- alle wichtigen mobilen States geprüft;
- Migration, Clean Seed, Build, Backup/Restore, Staging-Smoke sowie
  Worker/Outbox-Failure-Recovery belegt;
- bei LC5 stimmen Angebot, Kundenpflichten, Frist und Service-Recovery
  zusammen; Refund, Credit-Restoration und Rechnungskorrektur sind getrennt
  auditiert/reconciliiert;
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

Phasen 01 bis 20 wurden gemäss ihren Detailverträgen auf ihren jeweiligen Evidence-Commits umgesetzt und verifiziert. Der nächste technische Arbeitsschritt ist Phase 21; nichtaktivierende frühe Research-Tracks 29A/31A dürfen gemäss der Abhängigkeitslogik des [`remediation-masterplan.md`](./remediation-masterplan.md) parallel vorbereitet werden. Provider-, Legal-, Markt- und Operations-Gates bleiben separat und können nur für die jeweilige Launchklasse geschlossen werden; insbesondere bleiben reale E-Mail-Zustellung, autonome Ausführung, MFA/Step-up und REQ-REC-002 gegatet. Die Referenz aus `PortalGIT` bleibt reine Vergleichsbasis und darf weiterhin nicht blind übernommen werden.
