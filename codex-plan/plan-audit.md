# SwissTalentHub — Plan-Audit und Verbesserungsregister

> **Auditstand:** 19. Juli 2026. Klassifizierung bezieht sich auf den Zeitpunkt, zu dem die Lücke geschlossen sein muss. „Im Plan gelöst“ bedeutet nur, dass eine eindeutige Sollentscheidung dokumentiert ist — nicht, dass Code existiert. Ausnahme: Phase 01 ist inzwischen separat durch [Ziel-Evidence](./evidence/2026-07-19-phase-01.md) als implementiert verifiziert.

## 1. Auditumfang und Urteil

Vollständig gelesen und gegeneinander geprüft wurden:

- Zielrepository inklusive Git-Baseline und übertragenem `AGENTS.md`;
- alle 24 ursprünglichen Dateien in `codex-plan`;
- alle Checkboxen, Dependencies, Files-to-create, Verification- und Common-Pitfall-Abschnitte;
- als Referenz der tatsächliche Code in `PortalGIT`, inklusive Package/Config, Prisma, Routen, UI, Tests, Env-Struktur und Gitstatus;
- offizielle Primärquellen für aktuelle Schweizer Datenschutz-, MWST-, KMU- und Stellenmeldepflicht-Annahmen.

**Urteil vor Überarbeitung:** nicht implementierungsbereit. Der Zielcode fehlte vollständig; Status/Evidence war aus dem Quellprojekt geerbt; Produktstrategie, Marketplace-Liquidität, Preisvalidierung, KPI-System, operative Prozesse und mehrere zentrale Sicherheits-/Billing-/Privacy-Verträge waren widersprüchlich oder unvollständig.

**Urteil nach Überarbeitung:** der Plan ist als ausführbare Grundlage für **Phase 01** verwendbar. Er ist keine Produktionsfreigabe. Offene Markt-, Preis-, Rechts-, Steuer- und Go-live-Entscheidungen sind bewusst als Validierungs-/Release-Gates erhalten.

## 2. Kritisch vor Implementierung

| ID | Befund und Begründung | Auflösung im Plan | Status |
|---|---|---|---|
| AUD-P0-01 | Ziel enthielt nur README, Plan behauptete Phase-01-Code und trug geerbte `[x]`. Das hätte Coding-Agenten Phasen überspringen lassen. | Masterstatus 0 %, neue Evidence-Regel, Phase-01-Häkchen zurücksetzen; Repository-Audit. | im Plan gelöst |
| AUD-P0-02 | `../AGENTS.md` fehlte im Ziel und `../plan.md` existiert nirgends; Relative Links/Source of Truth waren unklar. | Root-AGENTS mitübertragen; `codex-plan` explizit alleinige Source of Truth; tote historische Referenzen nicht normativ. | im Plan gelöst |
| AUD-P0-03 | Phase-01-Skripte der Referenz sind Windows-inkompatibel; Docker-Begründung veraltet; Client-Generation/Dependencies nicht reproduzierbar. | Phase 01 verlangt plattformneutrale Scripts, Pins, clean install, DB-Smoke und neue Ziel-Evidence. | im Ziel implementiert und verifiziert |
| AUD-P0-04 | Registrierungsinputs passten nicht zu Pflichtfeldern von Candidate/Company; Profile konnten nicht atomar erstellt werden. | draftfähige Profile, atomare Employer-Erstellung und Schema-/Onboarding-Vertrag in Blueprint/Phase 02/06. | im Plan gelöst |
| AUD-P0-05 | Session-Token im Klartext, E-Mail-Normalisierung/Reset-/Safe-next-Vertrag fehlte. | gehashte Tokens, `emailNormalized`, Safe Redirect, Rotation/Revocation und Reset-Mock E2E. | im Plan gelöst |
| AUD-P0-06 | Keine kanonische RBAC-Matrix; globale Rolle, Company-Rolle, JobAssignment und Multi-Company-Kontext vermischt. | zweistufiges Rollenmodell, Autorisierungsreihenfolge und REQ-IAM-*; fremde Objekt-ID → sichere 404. | im Plan gelöst |
| AUD-P0-07 | Consent war gleichzeitig Boolean, TalentPoolConsent und Log; kein klarer aktueller Zustand. | append-only, versionierter CandidateConsent als Wahrheit plus ableitbarer aktueller RadarProfile-State. | im Plan gelöst |
| AUD-P0-08 | Anonymous Identifier war wahlweise Handle, PK-nahe ID oder per-session ID. | opaque server mapping; Safe DTO; keine Handle/PK-Autorisierung; Kohorten-/Enumeration-Schutz. | im Plan gelöst |
| AUD-P0-09 | Reveal war widersprüchlich firmenweit oder threadbezogen; eigene Consent-Art/Unique/Expiry fehlte. | RevealGrant für Candidate + Company + ContactRequest/Conversation, kandidateninitiiert, versioniert/auditiert. | im Plan gelöst |
| AUD-P0-10 | Radar-Allowance und gekaufte Credits wurden gleich gezählt; Parallelverbrauch konnte negativ werden. | EntitlementGrant + CreditLedger mit Funding Source, Periode, Idempotenz und echter Postgres-Concurrency-Abnahme. | im Plan gelöst |
| AUD-P0-11 | Payment akzeptierte `amountRappen` vom Client; kein Preis-/Adress-/Produkt-Snapshot, Idempotency oder sichere Transaktion. | Serverquote, versionierter Katalog, Order/Invoice-Snapshots, exactly-once Fulfillment und Rappen/VAT-Regel. | im Plan gelöst |
| AUD-P0-12 | Phase 11 und 12 beanspruchten `confirmMockPayment`/Admin-Metriken; doppelte UpgradeModal-Implementierung drohte. | Phase 12 alleinige Billing-/Fulfillment-Domain; Phase 11 keine Zahlung; eine Upgrade-Komponente. | im Plan gelöst |
| AUD-P0-13 | Boost-Checkout hatte kein geprüftes `jobId`; Fulfillment war zyklisch zwischen 12/13. | Phase 12 generische Fulfillment Registry + serverseitiger Target Context; Phase 13 Boost-Handler. | im Plan gelöst |
| AUD-P0-14 | Aktivjoblimit war bei Submit, Admin-Publish, Reaktivierung und parallelen Übergängen uneinheitlich. | Draft/Submit frei; jede `→PUBLISHED`-/Reaktivierungs-Transition atomar gegatet. | im Plan gelöst |
| AUD-P0-15 | Boost-Priorität konnte irrelevante Jobs vor relevante setzen; Sortoption/Pagination widersprachen fester Rangfolge. | Relevanzfilter zuerst, transparente begrenzte Sponsored-Zone, stabiles globales Sortiertupel vor Pagination. | im Plan gelöst |
| AUD-P0-16 | Match-Score konnte als Arbeitgeberranking/automatische Entscheidung interpretiert werden. | P0 kandidatenorientiert, keine geschützten Merkmale/Auto-Reject; Arbeitgebernutzung P1 nach Review. | im Plan gelöst |
| AUD-P0-17 | Fair-Score enthielt Firmenverifizierung und unklare Faktoren; bezahlte/organisatorische Effekte drohten. | Inserattransparenz v2, Verifizierung separates Badge, versionierte Snapshot/Evidence, Paid Inputs typseitig ausgeschlossen. | im Plan gelöst |
| AUD-P0-18 | Tests wurden bis Phase 17 verschoben; Prisma-Mocks sollten trotzdem Atomicität beweisen. | Tests in jeder Phase; echte Postgres-Integration für Constraints/Races; Phase 17 nur Cross-role/Regression. | im Plan gelöst |
| AUD-P0-19 | Öffentliche Apply-/Save-CTAs, Job-Expiry und Boost-Labels lagen in voneinander unabhängigen Phasen und hätten tote/falsche UI erzeugt. | Route/CTA nur bei realem nächsten Zustand; Job-Aktivität ab 07; 09 hängt von 07; 15 hängt von 13. | im Plan gelöst |
| AUD-P0-20 | `noindex` wurde teils als Cache-Schutz behandelt; private PII konnte theoretisch gecacht werden. | private Routen brauchen noindex **und** dynamisch/no-store; Tests in 16. | im Plan gelöst |
| AUD-P0-21 | Audit „never throws“ konnte kritische Aktion ohne Spur zulassen. | kritischer Audit-Write transaktional oder garantierte Outbox; klar redigiertes Schema. | im Plan gelöst |
| AUD-P0-22 | Import versprach mehr Felder als Schema, hatte keine Lizenz-/Preview-/Parser-Grenzen. | Source/Lizenz, safe parse, Preview/Decision/Commit-to-draft/Rollback und enger Mappingvertrag. | im Plan gelöst |

## 3. Wichtig für MVP

| ID | Befund / Grund der Einstufung | Planbehandlung | Status |
|---|---|---|---|
| AUD-MVP-01 | Jede Route brauchte Loading/Empty/Error/Success/Locked/Onboarding, aber Quality Gate war nicht routebezogen. | Blueprint-Routenvertrag + Requirement/Test-IDs + Phase Execution Contract. | im Plan gelöst |
| AUD-MVP-02 | Mobile Kanban/Tabellen/Filter und Accessibility waren generisch, nicht abnehmbar. | 360px, List/Card alternatives, keyboard/focus/axe checks; Phase 17 final. | im Plan gelöst |
| AUD-MVP-03 | Jobabo hatte keinen echten Scheduler; „Mail“ klang wie Zustellung. | P0 Preview/explicit command + `MOCK_RECORDED`; Worker/Outbox P1; Copy ehrlich. | im Plan gelöst |
| AUD-MVP-04 | Mock Storage erzeugte scheinbare Download-URL ohne Bytes. | nur Metadata, keine Fake-Download-CTA; realer Upload später. | im Plan gelöst |
| AUD-MVP-05 | Salary Radar konnte Scheingenauigkeit erzeugen. | `SALARY_RADAR_POLICY_V1`: p25/median/p75, exact fallback/sample≥30, bucket only, dataset/method/no-result. | im Plan gelöst; Datensatz-Fachreview vor LIVE |
| AUD-MVP-06 | Response Guarantee/Badge hatte keine Messdefinition oder operative Folge. | Canonical human response event; 90d/min20; RELIABLE≥8000 bps, cockpit/cluster risk 7000 bps; minutes median. | Implementierungsbaseline gelöst; Copy/Legal vor LIVE prüfen |
| AUD-MVP-07 | Downgrade, Kündigung zum Periodenende, Same-plan und over-limit Jobs waren unklar. | ADR-028: immediate proration upgrade, paid scheduled downgrade, cancellation/retained-seat and over-limit effects with time-travel tests. | im Plan gelöst; Commercial-Hypothese prüfen |
| AUD-MVP-08 | Credit Expiry/FIFO und Refund bei abgelehntem Radar-Kontakt waren unklar. | ADR-028 fixes period/+12-month expiry, Plan→Purchased→Admin/earliest-expiry order, no auto-refund and exact audited reversal. | im Plan gelöst; Finance/Legal vor realem Betrieb |
| AUD-MVP-09 | Invoice-Rundung pro Zeile vs Rechnung und Nummernsequenz fehlten. | ADR-028 fixes line-level half-up/summed totals and `STH-YYYY-NNNNN`; Golden/Concurrency tests. | im Plan gelöst; Taxprüfung offen |
| AUD-MVP-10 | Seed deckte keine negativen Zustände/Prod-Guard/deterministische Zeit ab. | versionierter Namespace, Clock, negative Fixtures, Manifest und Prod fail-closed. | im Plan gelöst |
| AUD-MVP-11 | Admin-Suspension/Destructive Actions hatten unvollständige Downstream-Effekte. | Transaction + impact preview + sessions/jobs/risky access + Audit. | im Plan gelöst |
| AUD-MVP-12 | Admin war eine globale Superrolle. | Capability wrappers im MVP; echte Support/Moderation/Sales/Finance-Trennung P1. | akzeptierte MVP-Limitation |
| AUD-MVP-13 | Datenschutzexport/-löschung versprach mehr als technisch/rechtlich definiert. | als persistierter Case/Manifest-Mock; echte Retention/Deletion Go-live Legal Gate. | im Plan gelöst als Mock |
| AUD-MVP-14 | Keine verpflichtenden E2E-Kernreisen. | E2E-01 bis E2E-08 verbindlich. | im Plan gelöst |
| AUD-MVP-15 | No-network-Grenze der Adapter nicht testbar beschrieben. | Contract-/No-network-Tests je Port. | im Plan gelöst |

## 4. Wichtig für Markteinführung

| ID | Befund / Begründung | Planbehandlung | Status |
|---|---|---|---|
| AUD-LAUNCH-01 | Keine priorisierte Zielgruppe/Launchregion; landesweite Breite hätte Liquidität verschleiert. | KMU + Fachkräfte; Clusterhypothese Zürich/Aargau/Bern × Pflege/Engineering; Interview-/Liquiditätsgates. | Hypothese zu validieren |
| AUD-LAUNCH-02 | Henne-Ei-Problem nur als Featureliste, keine Startsequenz. | Concierge → Supply → Demand → clusterweiser Launch; erlaubte Quellen und klare Demo-Grenze. | im Plan gelöst |
| AUD-LAUNCH-03 | Programmatic SEO ohne Mindestnutzen-/Indexgate. | Content-/Liquiditätsgate, noindex/consolidate; Seitenzahl kein KPI. | im Plan gelöst |
| AUD-LAUNCH-04 | Paketpreise/Features waren gesetzt, aber ohne Segment, Validierung oder Jahreslogik. | fünf Plans mit Zielkunde/Trigger, 10-für-12 Hypothese, Design-Partner-/Conversion-Messung. | Hypothese zu validieren |
| AUD-LAUNCH-05 | Neun Produkte erzeugten Feature-Bloat und teilweise nicht lieferbare Reichweite. | Boost/Contacts P0; targeted Zusatzstelle/approved Import P1 mit REQ-BIL-008/009; Featured/Newsletter/Social P2 nach Reichweitenbeleg; Success Fee später. | im Plan gelöst |
| AUD-LAUNCH-06 | Keine North Star/KPI-Definition oder Funnel-Events. | exact dedupe/response/cluster/month North Star plus typed funnel events and suppression v1. | Implementierungsbaseline gelöst; später versioniert kalibrieren |
| AUD-LAUNCH-07 | Cockpit-Signale „many views/near limit/churn“ waren undefiniert. | `COCKPIT_SIGNAL_POLICY_V1` fixes reason/evidence/window/threshold/action/owner/outcome and golden fixtures. | Implementierungsbaseline gelöst; spätere Version aus Daten |
| AUD-LAUNCH-08 | Kein Geschäftsmodell/CAC/LTV/Break-even. | drei explizite Szenarien und Formeln; keine Marktbehauptung. | im Plan gelöst als Annahme |
| AUD-LAUNCH-09 | Mehrsprachige landesweite Marke vs de-CH UI nicht priorisiert. | de-CH Launch; FR/IT und breite regionale Qualität P2/Expansion nach Beleg. | strategische Entscheidung |
| AUD-LAUNCH-10 | Keine Betriebs-/Support-/Moderationsqueues und SLAs. | `OPS_CASE_SLA_POLICY_V1` fixes elapsed-hour targets/order/warning/overdue evidence; values remain operational hypotheses. | Implementierungsbaseline gelöst; Pilot-Owner bestätigt |
| AUD-LAUNCH-11 | Deployment, Backup/Restore, Observability und Incident-Basis fehlten. | Phase 16/18, shared PostgreSQL rate store, Health/logs/runbooks and pg_dump→Age isolated restore. | im Plan gelöst; Umsetzung/E2E-08 offen |
| AUD-LAUNCH-12 | AGB, Datenschutzinformation, Steuerpflicht und reale Rechnung wurden durch Disclaimer nicht ersetzt. | ausdrückliche Legal/Tax/Privacy Go-live-Blocker; keine Compliancebehauptung. | Fachprüfung offen |

## 5. Nach MVP / später

| ID | Thema | Einstufung und Grund |
|---|---|---|
| AUD-POST-01 | Reale Payment-, E-Mail-, Storage-, AI-, Job-Room-, Commute- und PDF-Provider | später; benötigen DPA/Legal/Security/Webhook/Retry/Monitoring und externe Credentials |
| AUD-POST-02 | Background Worker/Outbox für Alerts, Expiry, Aggregation, Import und Renewal | P1; für echten Betrieb wichtig, aber kontrolliertes Mock-MVP kann Commands nutzen |
| AUD-POST-03 | Postgres FTS/GIN oder Suchservice | P2; erst bei Relevanz-/Volumenbeleg, ausser P0-Ranking ist sonst nicht korrekt |
| AUD-POST-04 | Externe Recruiter-Agentur mit mehreren Mandanten | P1; Core unterstützt Company Context, Mandate brauchen zusätzliche Isolation |
| AUD-POST-05 | ATS/API/SSO und Enterprise-Vertragsbilling | später; Enterprise-Verkauf/Integration separat |
| AUD-POST-06 | Arbeitgeberseitiges Match-Ranking | P1/später nach Bias-, Consent- und Rechtsprüfung; keine Auto-Entscheidung |
| AUD-POST-07 | Refund, Chargeback, Dunning, Credit Notes | P2 mit realem Billing; MVP dokumentiert unsupported states |
| AUD-POST-08 | volle FR/IT-Lokalisierung und alle Kantons-/Berufscluster | P2/Expansion nach de-CH-Liquiditätsbeleg |
| AUD-POST-09 | native Apps | später; responsive Web validiert erst Kernnutzen |

## 6. Bewusst verworfen

| ID | Verworfen | Begründung |
|---|---|---|
| AUD-DROP-01 | Scraping/Kopieren fremder Jobportale | Rechts-/Qualitäts-/Vertrauensrisiko; explizit untersagt |
| AUD-DROP-02 | nicht gekennzeichnete Seed-/Demo-Aktivität in Production | irreführender Marktplatz und Vertrauensbruch |
| AUD-DROP-03 | bezahlte Veränderung des Fair-Job-Scores | widerspricht Fairness/Transparenz |
| AUD-DROP-04 | globale/arbeitgeberinitiierte Identitätsfreigabe | Privacy- und Kontrollbruch |
| AUD-DROP-05 | automatische Ablehnung/Rangentscheidung durch Match-Score im MVP | Fairness-/Rechts-/Erklärbarkeitsrisiko |
| AUD-DROP-06 | Success Fee im MVP | rechtliche und operative Prüfung fehlt |
| AUD-DROP-07 | tausende dünne SEO-Seiten | Such-/Markenqualität und operative Komplexität ohne Nutzerwert |
| AUD-DROP-08 | UI-Placeholders für nicht modellierte Gallery/Video/Downloads | verletzt No-Fake-UI-Standard |

## 7. Duplikate und Ownership-Konflikte

| Bereich | Alter Konflikt | Neue Ownership |
|---|---|---|
| Auth UI | Phase 06 und Polish Phase 07 | 06 funktionaler Auth-Flow; 07 nur shared visual refinement ohne Logikduplikat |
| Search/SEO | Phase 07 und 15 | 07 funktionale Discovery; 15 Ranking-/SEO-/Index-Hardening |
| Reveal/Privacy | Phase 09 und 14 | 09 Candidate Consent/Case basics; 14 Employer Contact + scoped Reveal E2E |
| Admin/Billing | Phase 11 und 12 | 11 Operations/Moderation; 12 alle Billing-Use-Cases und Admin-Billing-Routen |
| Upgrade UI | Phase 10 und 12 | Phase 12 shared `UpgradeDialog`; 10 zeigt bis dahin safe locked/unavailable state |
| Boost | Phasen 03/07/12/13/15 | 03 pure rules; 12 generic fulfillment; 13 lifecycle/use case; 15 final search integration |
| Job expiry | ursprünglich erst 15 | active predicate ab 03/07; operational expiry projection/worker later |
| Analytics/Cockpit | 03/11/12 | 03 event/metric primitives; 11 action schema/ops shell; 12 revenue definitions |

## 8. Verbleibende Fachfreigaben mit Deadline

| Fachfreigabe (Implementierungsbaseline ist bereits gebunden, soweit genannt) | Muss freigegeben sein vor | Owner/Fachprüfung |
|---|---|---|
| Frozen P0 prices/packaging validate; annual remains inactive and no Trial exists | Design-Partner-Angebot / public pricing | Product/Commercial |
| ADR-028 downgrade/seat/job baseline validate (implementation does not wait/reinterpret) | real payment activation | Product + Support |
| ADR-028 credit expiry/order/no-auto-refund baseline validate | real paid contacts/credits | Product + Finance/Legal |
| Per-line VAT/invoice-number baseline validate; actual tax liability/legal invoice remains open | real invoice/payment | Finance/Tax |
| `EMPLOYER_RESPONSE_POLICY_V1` thresholds and non-guarantee copy validate | public LIVE badge/filter | Product/Ops/Legal |
| `RADAR_PRIVACY_POLICY_V1` cohort/buckets/rates/opaque retention validate | Production Radar | Privacy/Security/Product |
| Datenaufbewahrung, Export, Löschung, internationale Bekanntgabe | Pilot-Go-live | Legal/Privacy |
| Exact `CLUSTER_LAUNCH_POLICY_V1` values and the particular LIVE pair receive Product+Ops approval | public acquisition/indexing | Marketplace/Growth |
| RPO≤24h/RTO≤8h, 30-daily/12-monthly encrypted retention and Incident Owner | Pilot-Go-live | Ops/Owner |
| reale Provider und Datenstandorte | eigenes Post-MVP Gate | Security/Legal/Ops |

The listed implementation baselines are executable and may not be paused or reinterpreted as “open”; Fachfreigabe can approve, reject or create a new version before the named LIVE gate. Actual retention/deletion, providers, tax/legal texts and incident ownership remain true blockers.

## 9. Verbesserte Planartefakte

### Neu

- `repository-audit.md`
- `product-strategy.md`
- `architecture-blueprint.md`
- `requirements-matrix.md`
- `implementation-plan.md`

### Grundlegend überarbeitet

- `00-PLAN.md`
- dieses Auditregister
- `decisions.md`, `glossary.md`, `product-quality-gates.md`, `99-rules-quickref.md`
- alle Phasen 01–18 durch Zielstatus-/Execution-Contract- und Dependency-Korrekturen
- Root `README.md` als Plan-Navigation und Statushinweis

## 10. Implementierungsbereitschaft

Phase 01 ist implementiert und verifiziert. Der nächste Implementierungsschritt ist **Phase 02**; die offenen Business-/Legal-Entscheidungen besitzen weiterhin harte Deadlines vor ihren betroffenen Phasen beziehungsweise vor Pilot-Go-live. Keine spätere Phase darf wegen vorhandener Quellfiles oder alter Soll-Evidence übersprungen werden.
