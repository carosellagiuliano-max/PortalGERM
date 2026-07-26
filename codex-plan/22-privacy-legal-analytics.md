# Phase 22 — Datenschutzvollzug, stabile Rechtsgates und LIVE-Analytics

> **Planstatus:** IN UMSETZUNG / TECHNISCHER CANDIDATE IN PRÜFUNG
> **Technikstatus:** IMPLEMENTIERT; COMMITGEBUNDENES G3 NOCH AUSSTEHEND
> **Quality-Gate:** AUTOMATISIERT AUF ARBEITSBAUM GRÜN; COUNSEL UND
> MODERIERTE FORSCHUNG NICHT GELAUFEN
> **Aktivierung:** DISABLED
>
> Die bestehende Privacy-Case-Maschine ist wertvolle Vorarbeit. Export und
> Delete sind jedoch bewusst Mocks; keine AVG-/AVV-/DSFA-, Legal-, Privacy-
> oder LIVE-Analytics-Freigabe ist durch diesen Plan erteilt.

## 1. Status in vier Dimensionen

Policy-, Code- und Migrationserstellung können den Technikstatus
`TECHNISCH ABGESCHLOSSEN` erreichen. Das Quality-Gate wird nur nach der
vollständigen vertikalen G3-Matrix `BESTANDEN`. Veröffentlichung einer
Rechtsversion, Verarbeitung realer Betroffenenrechte und optionale
LIVE-Analytics besitzen jeweils eigene Aktivierung und bleiben ohne
schriftliche, versionierte Fachfreigabe `BLOCKED BY EXTERNAL GATE`.

## 2. Ziel und messbarer Business-/Nutzerwert

Jede unterstützte betroffene Person erhält einen vollständigen, verständlichen
und technisch vollziehbaren Export-, Korrektur- und Lösch-/Anonymisierungsweg.
Jeder personenbezogene Datenort und externe Processor besitzt eine
versionierte Rechtsgrundlage, Retention und Legal-Hold-Entscheidung.
Rechtsseiten und Analytics werden nur gegen exakt freigegebene Versionen
aktiviert.

Messbarer Zielzustand:

- 100 % der Daten-/Providerinventarzeilen haben Data Subject, Zweck,
  Rechtsgrundlage, Processor, Retention, Export-, Correction-, Erasure- und
  Hold-Outcome sowie Owner;
- Export enthält 100 % freigegebener eigener Kategorien und 0 Foreign Canaries;
- ein Case wird erst `COMPLETED`, wenn 100 % erforderlicher Processor-Outcomes
  terminal erfolgreich beziehungsweise rechtlich begründet retained sind;
- jeder wiederholte/fortgesetzte Lauf erzeugt genau ein fachliches Outcome;
- optionale Analytics erzeugt nach Opt-out/Widerruf 0 neue Events;
- moderierte Kernaufgaben erreichen die vorab definierte Verständnisschwelle
  ohne kritische Fehlannahme über Löschung, Hold, Radar oder Analytics.

## 3. Tatsächlicher Repositoryzustand

- Die additive Phase-22-Migration liefert immutable Inventarversionen,
  Legal-Revisions/Publikationen, flowspezifische Processing Approvals,
  processorweise Executions/Outcomes, verschlüsselte Exportartefakte,
  Legal Holds, Erasure-Proofs/Tombstones und append-only Analytics-Consents.
- `lib/privacy/export-v2.ts` erstellt ownergebundene, manifestierte
  Streamingpakete einschließlich eigener zulässiger Dokumentbytes; Download
  ist step-up-gebunden, höchstens 15 Minuten gültig und single-use.
- `lib/privacy/execution-v2.ts` vollzieht Korrektur und irreversible
  Anonymisierung processorweise, bewahrt immutable/retained Evidence, bleibt
  bei Teilfehlern `RETRY_REQUIRED` und kann checkpointed fortgesetzt werden.
- `lib/privacy/restore-reconciliation.ts` wendet Tombstones nach einem
  simulierten Restore erneut an und verhindert die stille PII-Reaktivierung.
- `/admin/legal`, `/legal/privacy`, `/legal/terms`, `/legal/imprint`,
  Candidate-Privacy-UX und `/api/privacy/exports/[id]` sind vorhanden. Ohne
  exakte Publication-/Processing-Gates zeigen öffentliche Seiten einen
  ehrlichen gesperrten Zustand und mutierende Flows schreiben nichts.
- `lib/analytics/live-consent-policy.ts` trennt essentielle Domain-/Security-
  Events von optionalen Eventfamilien und verlangt exakte Publication,
  Processing Approval, aktuelle Einwilligung, Property-Allowlist, Retention
  und LIVE-Provenienz.
- Alle neuen Runtimeflags stehen standardmäßig auf `false`, Mode
  `disabled` und Cohort `none`. Externe Counsel-/AVG-/DSFA-/DPA-/Region-
  Entscheide sind nicht freigegeben; der statische Inventoryhash ist daher
  keine Legal-Signatur.
- Accountgebundene Candidate-/Employer-/Invitee-/Lead-/Reporter-Daten sind
  im V2-Export abgedeckt. Ein sicherer Nicht-Kontoinhaber-Intake bleibt
  fail-closed, bis Phase 25 den alternativen Identity-/Risk-/Step-up-Vertrag
  liefert; er wird nicht durch ein Schattenkonto simuliert.

## 4. Findings und Requirements

| Finding / Requirement | Verantwortung dieser Phase | Launchpriorität |
| --- | --- | --- |
| `STH-006`, `REQ-PRIV-004`, Erweiterung `REQ-CAN-006` | reales Export-/Correction-/Erasure-System, Inventory, Holds, Provider-Reconciliation | LC1 P3; LC2–LC6 P0 |
| `STH-007` | versionierte Legal-Dokumente und stabile AVG/AVV/DSFA-/Flow-Gates | LC1 P3; LC2–LC6 P0 je betroffenem Flow |
| `STH-017`, `REQ-DATA-001` | eventweise Legal-/Consent-/Retention-Freigabe optionaler LIVE-Analytics | LC1 P3; LC2/3 P1; LC4–LC6 P0 |
| Beitrag `STH-030`, `REQ-ID-004` | Step-up-Guard für Export/Delete/Consent-Hochrisikoaktionen; Risk-Policy bleibt Phase 25 | LC2–LC6 P0 |
| Beitrag `STH-031`, `REQ-TRUST-001` | Export-/Erasure-/Consent-Anomaliesignale und Incident-Hooks | LC2–LC6 P0 |
| Beitrag `STH-033`, `REQ-UX-003` | owning moderierte Verständlichkeitsprüfung; Researchprogramm bleibt Phase 29A | LC2–LC6 P0 |
| Beitrag `STH-036`, `REQ-SRCH-002` | Privacy-Gate für Search-Learning, keine Rohquery-/Rare-query-Reidentifikation | je aktiviertem Search-Learning P0 |
| `REQ-QA-003` | 28-Punkte-/AC→Test-Vertrag | alle P0 |

## 5. In Scope

- versioniertes Privacy-/Processor-Inventar für DB-Domains, Object Store,
  Mail, Payment, Analytics, Audit/Logs, Backups, Support, Leads und Reporter;
- Data-Subject-Klassen Candidate, Employer/Membership/Invitee,
  identifizierbarer Lead, Missbrauchsmelder und Nicht-Kontoinhaber;
- AVG-/DSG-/DSGVO-/AGB-/Impressum-/Cookie-/Analytics-/AVV-/DPA- und
  DSFA-Entscheid pro aktivierbarem Flow, ohne Rechtsentscheidung durch Code;
- stabile `LegalGate`-/`ProcessingApproval`-Version mit Scope, Region,
  Processor, Dokumentreferenz, Owner, Gültigkeit, Revoke und Re-review;
- echtes verschlüsseltes, manifestiertes Exportpaket samt eigener zulässiger
  Dokumentbytes, single-use Download und Ablauf;
- processorweise Correction und Erasure/irreversible Anonymisierung mit
  Legal Holds, Retention, Proof, Crash/Resume und Provider-Reconciliation;
- Restore-Schutz gegen Wiederbelebung gelöschter PII;
- versionierte Legal-Dokumente, Review/Publish/Re-consent und echte Links;
- optionale Analytics eventweise default-off, Consent-/Opt-out-/Retention-
  gebunden, suppressiert und serverseitig aggregiert;
- verständliche UX und moderierte Privacy-/Legal-/Consent-Prüfung;
- sichtbare Failure Propagation bis Case, Notification, Audit und Ops.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- Engineering-Rechtsberatung oder implizite AVG-/DSFA-Freigabe;
- Success Fee, Arbeitsvermittlung oder bezahlte Angebote ohne Phase-31-/24-
  Gates;
- Third-Party-Ad-Pixel, Cross-Site-Tracking, Session Replay und freie
  Analytics-Properties;
- pauschale Cascade-Löschung oder Löschung freigegeben gebundener
  Accounting-/Security-/Consent-/AVG-Evidence;
- Search-Learning-Implementierung: Phase 30A; Phase 22 liefert nur Privacy-
  Policy/Gate;
- autonome Jobs/Pager: Phase 23; personell getrennte Adminrollen und
  risikobasierter Step-up: Phase 25.

Alle rechtlich ungeklärten Flows sind serverseitig über exakte Flowflags in
UI, API, Marketing, Worker und Provider `DISABLED`.

## 7. Benutzerrollen und organisatorische Owner

| Rolle | Befugnis | Owner |
| --- | --- | --- |
| Public | nur veröffentlichte exakte Legal-Version lesen | Legal |
| Candidate | eigene Cases, Artefakte und Consents | Privacy + Candidate |
| Employer Owner/Admin/Recruiter/Invitee | nur definierte eigene/Company-bezogene Daten entsprechend Membership und Pflicht | Privacy + Employer |
| Lead/Reporter/Nicht-Kontoinhaber | sicherer alternativer Identitätsnachweis und begrenzter Case | Privacy |
| Privacy Read/Verify/Process | getrennte Need-to-know-Capabilities und Assignment | Privacy Operations |
| Legal/AVG/Tax/Finance | Policy-/Hold-/Dokumentfreigabe, keine technische Selbstfreigabe | jeweiliger Fachowner |
| System/Ops | processorweise Ausführung/Monitoring ohne freie Inhaltsansicht | Platform/Ops |

Riskante Execution benötigt zwei getrennte Actors, sobald Phase 25 die
personell getrennten Grants bereitstellt.

## 8. Portale, Routen, Services, Provider und Worker

Bestehend und Phase-22-erweitert: `/candidate/privacy`,
`/candidate/privacy/requests/[id]`,
`/candidate/privacy/requests/[id]/verify`,
`/admin/privacy-requests`, `/admin/privacy-requests/[id]`, `/admin/legal`,
`/legal/privacy`, `/legal/terms`, `/legal/imprint` und
`/api/privacy/exports/[id]`.
Weiterhin erst nach Folgephasengate:

- alternative Intake-/Identity-Challenge für Nicht-Kontoinhaber;
- personell persistierte statt nur actor-getrennt geprüfte Admin-Grants und
  risikobasierte echte Step-up-Evidence aus Phase 25.

Services: DataInventory Registry, Legal Publication/Gate Service, Privacy
Orchestrator, Export Builder, Correction-/Erasure Processors, Hold Resolver,
Provider Reconciler, Consent/Analytics Policy. Phase 22 liefert bounded,
resumable Commands; Phase 23 betreibt sie autonom.

## 9. Datenmodelle, Constraints, Indizes und Klassifikation

ADR-033 wird vor Migration konkretisiert. Mindestens:

- immutable `PrivacyDataInventoryVersion` mit processor-/entity-/field-/
  subject-/purpose-/basis-/retention-/export-/correct-/erase-/hold-Regeln;
- versionierte `LegalDocument`, `LegalRevision`, `LegalPublication` und
  `ProcessingApproval`/`LegalGate` samt exact Scope, AVG-/AVV-/DSFA-Referenz,
  Owner, effective/expiry/revoked;
- `PrivacyExportArtifact` mit encrypted Object Version, Key-Version,
  Manifesthash, expiry, single-use Delivery und Status;
- `PrivacyExecution`/`PrivacyProcessorOutcome` je Inventory-Version,
  checkpoint, attempt, error class und next retry;
- `LegalHold` mit Subject/Entity/Scope, Basisreferenz, Start/End, Reviewer und
  minimaler sichtbarer Begründung;
- append-only `ErasureProof`/Tombstone ohne gelöschten Inhalt;
- Consent-Evidence mit exakter Legal-/Analytics-Policy-Version und
  Pseudonym-Epoch.

Unique-/Checkconstraints verhindern doppelte aktuelle Publication,
doppeltes Artifactconsume, Completion bei offenen Processor-Outcomes,
cross-subject Artefakte und in-place Mutation von Evidence.

## 10. Expand–Migrate–Contract, Backfill und Datenprüfung

1. Fachowner signieren Inventory V1 und Retention-/Hold-Matrix vor Codecutover.
2. Additive Policy-/Publication-/Artifact-/Outcome-/Hold-Modelle auf leerer
   und Phase-19-Bestandsdatenbank.
3. Legacy Consents werden `LEGACY_SHORT_NOTICE`, nie als neue Zustimmung.
4. Export V2 dual-run gegen Mockmanifest; kategorieweise Count-/Digest-/
   Foreign-Canary-Abgleich.
5. Erasure startet Dry-run und kleine TEST/Sandbox-Cohort; kein Requestpfad-
   Bulkdelete.
6. Analyticsfamilien werden einzeln migriert/aktiviert; kein globaler
   unkontrollierter Boolean.
7. abgebrochener Backfill/Processor wird checkpointed wiederholt; zweite
   Ausführung erzeugt keine Doppelwirkung.
8. Contract V1-/Mockpfade erst nach G3, Restore- und Provider-Evidence.

## 11. Serverlogik, Orchestrierung, Retry und Providervertrag

- Jeder Case versiegelt Subject, Inventory-/Policy-Version und erforderliche
  Processorliste. Neue Inventory-Version schreibt laufende Evidence nicht um.
- Export streamt DB-/Providerdaten in ein verschlüsseltes Paket; Manifest
  nennt Kategorie, Schema, Count, Byte-/Digest-Outcome und Auslassungsgrund.
  Fremde Tenant-/Candidate-Daten sind ausgeschlossen.
- Artifact Download prüft Owner, aktuelle Challenge/Step-up, single-use,
  Expiry und `no-store`; Object Key ist keine Authorization.
- Erasure/Anonymize fragt pro Entität Legal Hold/Retention ab. Ein retained
  Outcome nennt nur freigegebene Basis/Frist, kein Content.
- Processor besitzt stabile Dedupe-ID, Timeout, Retryklasse, Checkpoint und
  terminales Outcome. Teilfehler propagiert als `PARTIAL/RETRY_REQUIRED` in
  Case, UI, Audit, Ops und Pflichtnotification; `COMPLETED` ist unmöglich.
- Providerfehler, Notification-Outbox und Case-State werden so gekoppelt,
  dass kein erfolgreicher Abschluss ohne durable Outcome/Notification
  behauptet wird.
- Correction propagiert in abhängige Readmodels/Provider oder zeigt
  processorweise Failure; Historienevidence wird nicht umgeschrieben.
- Analytics prüft vor Write Eventkind, Purpose, LegalGate, Consent,
  Provenienz, Property-Allowlist und Retention. Widerruf blockiert sofort neue
  optionale Writes.

## 12. UI-Zustandsvertrag

Privacy Case, Artifact, Legal Publication und Analytics Preference besitzen
Loading, Empty, Draft, Review, Locked, Identity Required, Step-up Required,
Pending, Processing, Partial, Hold, Retry, Provider Degraded, Conflict,
Expired, Cancelled, Ready, Downloaded, Corrected, Anonymized/Erased, Retained
und Success. UI benennt pro Kategorie verständlich, was geliefert, korrigiert,
gelöscht, anonymisiert oder aus welchem freigegebenen Grund behalten wird.

## 13. 360 px, Touch, Keyboard, Screenreader und Verständlichkeit

- komplette Case-/Legal-/Preference-Reise auf 360×800, 200-%-Zoom,
  Keyboard und Screenreader;
- Progress-/Partial-/Hold-Status textuell und per `aria-live`;
- Download/Erase-Confirmations besitzen klaren Fokus, Abbruch und irreversible
  Wirkung ohne Dark Pattern;
- 0 `critical`/`serious` Axe und 0 Clipping;
- vor LC2 moderiertes Protokoll mit mindestens fünf Candidate und fünf
  Employer/Invitee: Task Success ≥80 %, 0 kritische Fehlannahmen über
  vollständige Löschung, Legal Hold, Radar-Reveal oder optionale Analytics.
  Rote Erkenntnisse gehen an Phase 22 zurück; Phase 29A verwaltet das
  übergreifende Researchprogramm.

## 14. Authentisierung, Step-up, Autorisierung und Tenantgrenzen

Owner-/Subject-/Membership-/Assignment-/Capability-Prüfung erfolgt vor jedem
Repository-/Providerread. Candidate sieht nur eigene Cases/Artefakte;
Companydaten werden nicht pauschal an Recruiter exportiert. Nicht-Kontoinhaber
erhalten eine separate, enumeration-safe Challenge.

Exportdownload, Delete/Anonymize, Consent-Hochrisikoänderung, Hold-Override und
Admin-Execution verlangen actor-/session-/purpose-/action-/subjectgebundene
frische Step-up-Evidence. Bis Phase 25 bleibt Production Execution
serverseitig gesperrt. Read, Verify und Process sind getrennte Capabilities;
kein Actor darf seinen eigenen riskanten Entscheid allein freigeben.

## 15. Datenschutz, Zweck, Minimierung, Retention, Export, Löschung und Audit

Das Inventory ist die einzige technische Quelle für Datenorte und Outcomes.
AVV/DPA- und Subprozessorenreferenzen sind versioniert. Export enthält nur
eigene, freigegebene Daten; Evidence und Audit keine Paketbytes. Legal Holds
sind eng, befristet/reviewbar und dürfen keinen pauschalen „alles behalten“-
Schalter bilden. Backups erhalten verschlüsselte Retention plus Erasure-
Tombstones/Restore-Reconciliation, damit alte PII nicht still reaktiviert
wird. Search-Learning speichert ohne separate Phase-22-Freigabe keine
Rohquery, Identifier oder rare-query Cluster.

### Phase-22 Audit-log extension matrix

Die historische Phase-16-Matrix bleibt unverändert. Folgende additive
Phase-22-Aktionen erweitern ihren kanonischen, typisierten Vertrag; der
Unit-Contract vergleicht beide Matrizen gemeinsam mit Prisma und
`AUDIT_ACTIONS_V1`.

| Audit action | Owning workflow |
| --- | --- |
| `PRIVACY_INVENTORY_ACTIVATED` | versioniertes Inventory aktivieren oder widerrufen |
| `LEGAL_REVISION_REVIEWED` | unabhängiges Review einer Legal-Revision |
| `LEGAL_PUBLICATION_PUBLISHED` | exakte Legal-Version veröffentlichen |
| `LEGAL_PUBLICATION_REVOKED` | veröffentlichte Legal-Version widerrufen |
| `PROCESSING_APPROVAL_CHANGED` | flowspezifische Legal-/DSFA-/Processor-Freigabe |
| `PRIVACY_EXECUTION_STARTED` | Export-/Correction-/Erasure-Execution versiegeln |
| `PRIVACY_PROCESSOR_OUTCOME_CHANGED` | processorweises Terminal-/Retry-/Retention-Outcome |
| `PRIVACY_EXECUTION_COMPLETED` | Completion erst nach allen terminalen Outcomes |
| `PRIVACY_EXPORT_ARTIFACT_CREATED` | verschlüsseltes, manifestiertes Exportartefakt |
| `PRIVACY_EXPORT_ARTIFACT_DOWNLOADED` | ownergebundener Single-use-Download |
| `LEGAL_HOLD_CHANGED` | befristeten Hold setzen, reviewen oder freigeben |
| `ANALYTICS_CONSENT_CHANGED` | versioniertes opt-in/opt-out je Eventfamilie |
| `PRIVACY_RESTORE_RECONCILED` | Tombstone-basierte Restore-Reconciliation |

## 16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien

- Mass Export/Delete, Case-/Artifact-ID Enumeration, fremder Tenant,
  gestohlene Session und Challenge-/Download-Replay;
- bösartige Korrektur versucht Audit-, Invoice-, Company- oder Foreign-Daten
  zu überschreiben;
- Insider setzt Legal Hold, veröffentlicht Legal Text oder markiert Processor
  ohne Capability/zweitens Approval als fertig;
- Provider liefert Partial/timeout/falschen Subject-Receipt; Restore belebt
  gelöschte PII; DLQ/Notification verschweigt Failure;
- Consent-Spam, Purpose-Umetikettierung, Analytics nach Revoke,
  PII-Property und Search-Learning-Reidentifikation;
- ungewöhnliches Export-/Reveal-Volumen emittiert minimiertes RiskSignal für
  Phase 25, ohne Rohinhalt.

## 17. Externe und organisatorische Voraussetzungen

Benannte Schweizer Legal-/Privacy-/AVG-/Tax-/Finance-Owner; schriftliche
Entscheide zu DSG/gegebenenfalls DSGVO, AVG/AVV, AGB/Impressum,
Aufbewahrung, Arbeitsvermittlung/Success Fee/Radar-Kontaktfluss,
Subprozessoren/Datenregion, Cookie-/Analytics-Basis und DSFA
(`REQUIRED`, `NOT REQUIRED` mit Begründung oder `APPROVED`). Jeder Gate-
Eintrag besitzt exakten Flow, Dokumentversion, Gültigkeit, Reviewdatum und
Revoke-Owner. Ohne stabile Evidence bleibt der Flow disabled.

Planungsquellen, nicht Freigaben: die
[SECO-Übersicht zur privaten Arbeitsvermittlung](https://www.seco.admin.ch/de/private-arbeitsvermittlung-und-personalverleih)
für die flowspezifische Bewilligungsprüfung und das
[EDÖB-Merkblatt zur Datenschutz-Folgenabschätzung](https://www.edoeb.admin.ch/de/30082023-merkblatt-zur-datenschutz-folgenabschaetzung)
für den risikobasierten DSFA-Entscheid. Die konkrete Beurteilung bleibt beim
benannten Schweizer Fachowner.

## 18. Harte Abhängigkeiten

- Phase 19 grünes Baseline-Gate und ADR-033;
- Phase 20 für Verification, Privacy-Challenge und Pflicht-Outbox;
- Phase 21 für echte Dokumentbyte-/Hold-/Delete-Adapter;
- Phase 23 für autonome Execution, Retention und Provider Monitoring;
- Phase 25 für getrennte Adminrollen, Step-up und Dual Approval;
- Phase 30A darf Search-Learning erst nach Phase-22-Privacy-Gate aktivieren;
- Phase 24/31 benötigen die jeweils genaue Tax-/AVG-/Paid-Flow-Freigabe.

## 19. Geordnete Implementierungsschritte

1. Daten-/Processor-/Data-Subject-Inventar und offene Rechtsfragen erfassen.
2. Legal/Privacy/AVG/AVV/DSFA-/Retention-/Hold-Entscheide versionieren.
3. additive Policy-/Artifact-/Outcome-/Hold-/Publication-Migration.
4. Legal CMS/Review/Publish/Revoke/Re-consent mit echten Links.
5. Export Builder, Verschlüsselung und single-use Delivery.
6. Correction-/Erasure-Processor mit checkpointed Failure Propagation.
7. Storage/Mail/Payment/Analytics/Backup-Reconciliation anbinden.
8. Consent-/Analytics-Policy eventfamilienweise integrieren.
9. Admin-/Subject-UX, Step-up-/Dual-Approval-Guards und Opsstates.
10. Migration-, Foreign-Canary-, Failure-, Restore-, E2E-/A11y-Tests.
11. moderierte Verständlichkeitsprüfung, Befunde beheben, G3/Evidence.
12. erst danach flowweise Cohortaktivierung; kein globaler LIVE-Schalter.

## 20. Feature-/Legal-/Provider-/Cohort-Flags und Aktivierungsreihenfolge

Getrennte serverseitige Gates:
`LEGAL_PUBLICATION_<TYPE>`, `PRIVACY_EXPORT_V2`,
`PRIVACY_CORRECTION_EXECUTION`, `PRIVACY_ERASURE_EXECUTION`,
`PRIVACY_PROVIDER_<NAME>`, `OPTIONAL_ANALYTICS_<FAMILY>`,
`SEARCH_LEARNING_COLLECTION` und Cohort.

Reihenfolge: Inventory/Policy → additive Schema → Dry Run → Sandbox Processor →
moderierte Prüfung → Dual Approval/Step-up → kleine Allowlist → nach Phase 23
autonom. Revoke/Kill Switch stoppt neue Processing-/Analyticswrites, bewahrt
Evidence und markiert Partial Cases; er darf keinen Mockabschluss als Erfolg
anzeigen.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle genannten neuen Tests/Skripte sind anzulegen; nur reale Exit-0-Läufe auf
dem Abschlusscommit werden Evidence.

| Criterion | Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `22-AC-01` | `STH-006/007`, `REQ-PRIV-004` | vergessener Datenort/instabiles Rechtsgate, P0 | Contract + Unit | Inventory×Subject×Processor×Flow und AVG/AVV/DSFA-Gate | jede Zeile hat freigegebenes Outcome/Owner/Version | fehlende Basis, expired/revoked Gate, unbekannter Processor oder Flow blockiert Aktivierung | Legal/Privacy/System | Policy Registry | vollständige Entity-/Providerliste + Canary | Unit | `npx vitest run --config vitest.config.ts tests/unit/privacy/data-inventory-contract.test.ts tests/unit/privacy/legal-gate-policy.test.ts` | 100 % Inventarzeilen vollständig; 0 unbekannte/expired Aktivierungen; Hash stabil | signierte Inventory-/Gate-Matrix | Privacy + Legal + QA | PLANNED |
| `22-AC-02` | `STH-006`, `REQ-PRIV-004` | unvollständiger/fremder Export, P0 | PostgreSQL + E2E | Candidate/Employer/Invitee/Lead/Reporter Export mit DB + Dokumentbyte | eigenes Paket manifestiert alle freigegebenen Kategorien, decrypt/download einmal | Foreign Canary, expired/replayed URL, falscher Subject/Step-up und manipulierter Digest: 0 Daten | Data Subject | Privacy/DB/Object Store | je Subjectklasse, zwei Tenants, bekannte Bytehashes | PostgreSQL + Production Browser | `npm run test:integration -- tests/integration/privacy/privacy-export-v2-postgres.test.ts`; `npm run test:e2e:browser -- tests/e2e/flows/phase22-privacy-rights.spec.ts` | Kategorie-/Rowcounts exakt; Dokumenthash identisch; 0 Foreign IDs; zweiter Download 0; Manifesthash valide | verschlüsseltes Testmanifest, Trace | Privacy + Data | PLANNED |
| `22-AC-03` | `STH-006`, `REQ-PRIV-004` | unzulässige Löschung/False Complete, P0 | PostgreSQL + Failure/Restore | Erasure mit Application, Message, Radar, Billing, Audit, Hold und Providerteilfehler | freigegebene Daten gelöscht/anonymisiert, retained minimal begründet | aktiver Hold, Accounting/Audit, Provider timeout, Crash und Retry bleiben sichtbar; kein `COMPLETED` | Data Subject/Privacy/System | Privacy Orchestrator/Provider | Entitymatrix, Hold Canary, Fake Clock | isoliertes PostgreSQL + provider emulator | `npm run test:integration -- tests/integration/privacy/privacy-erasure-postgres.test.ts`; `npm run privacy:failure-drill`; `npm run privacy:restore-drill` | je Processor genau 1 terminales Outcome; Teilfehler `PARTIAL`; Hold unverändert; Restore 0 reaktivierte löschpflichtige PII | Processor-Timeline, Restore-Diff | Privacy + Legal + Ops | PLANNED |
| `22-AC-04` | `REQ-PRIV-004` | inkonsistente Korrektur/fremde Mutation, P0 | PostgreSQL + E2E | CORRECT request→verify→approve→apply→projection→notification | eigene korrigierbare Felder und abhängige Readmodels stimmen | immutable Evidence, Foreign Tenant, invalid value, Providerfehler bleiben unverändert/partial | Candidate + Nicht-Kontoinhaber | Privacy/Domain/Outbox | eigene/Foreign Canaries, downstream projection | PostgreSQL + Production Browser | `npm run test:integration -- tests/integration/privacy/privacy-correction-postgres.test.ts`; `npm run test:e2e:browser -- tests/e2e/flows/phase22-privacy-rights.spec.ts` | genau 1 Correction Event/Notification; alle erlaubten Projektionen gleich; Foreign 0 Writes; Retry ohne Doppelwirkung | Before/After-/Outboxmanifest | Privacy + Domain Owner | PLANNED |
| `22-AC-05` | `STH-007` | falscher/ungeprüfter Rechtstext oder AVG-Flow, P0 | PostgreSQL + E2E + Manual Legal | Draft→Review→Publish→Revoke/Re-consent; flow-spezifisches Gate | öffentliche Links zeigen exakt veröffentlichte Version/Hash | Draft, self-approval, expired/revoked AVG/AVV/DSFA-Gate und alter Consent aktivieren 0 Flow | Public/Legal/User | Legal CMS/Registration/Footer/Checkout/Radar | zwei Revisionen, alte Consents, revoked Gate | PostgreSQL + Production Browser + Legal Review | `npm run test:integration -- tests/integration/legal/legal-publication-postgres.test.ts`; `npm run test:e2e:browser -- tests/e2e/flows/phase22-legal-consent.spec.ts`; manueller Abgleich jeder sichtbaren Hash-/Version gegen signierte Counsel-Matrix | 1 current Publication; 0 Draftleak; Re-consent nur wenn Policy verlangt; ungeklärter Flow serverseitig 0 Writes | Publication-/Link-/Counsel-Manifest | Legal + Privacy + QA | PLANNED |
| `22-AC-06` | `STH-017`, `REQ-DATA-001`, Beitrag `REQ-SRCH-002` | Tracking ohne Basis/Reidentifikation, P0 | Unit + PostgreSQL Security | Environment×Event×Purpose×Consent×Retention; revoke und Search-Learning-Gate | nur freigegebene optionale Eventfamilie mit aktuellem Consent | opt-out/revoke, PII property, raw/rare query, DEMO/LIVE mix und unknown event ergeben 0 Writes | Visitor/Candidate/Employer | Analytics/Consent/Search Gate | vollständiger Eventkatalog + PII Canaries | Unit + isoliertes PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/analytics/live-consent-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/analytics/live-consent-postgres.test.ts` | 100 % Policy-Matrix; nach Revoke 0 optionale Events; Essential unverändert; 0 Rawquery/PII | Event-/Retention-/Redactionreport | Privacy + Data | PLANNED |
| `22-AC-07` | `STH-030`, `REQ-ID-004`, `REQ-PRIV-004` | IDOR/Insider/gestohlene Session, P0 | Security + PostgreSQL | Owner/Subject/Membership/Capability/Assignment/Step-up/Two-Actor Matrix | erlaubter Actor bewirkt genau eine Action | stale/replay/cross-purpose/cross-subject/direct action/self-approval liest/schreibt 0 | Candidate/Employer/Privacy Admin | Privacy Repositories/Actions | zwei Tenants, getrennte Adminactors, stale grants | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.config.ts tests/unit/privacy/privacy-case-capability-matrix.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/privacy/privacy-authorization-postgres.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/security/authorized-repositories.test.ts` | alle Denials vor Providerread; 0 Foreign IDs; genau 2 getrennte Actors bei riskanter Execution | Capability-/Provider-call-Manifest | Security + Privacy | PLANNED |
| `22-AC-08` | `REQ-PRIV-004`, `REQ-NOT-001`, Beitrag `STH-031` | verschluckter Teilfehler/Doppelwirkung, P0 | Failure Injection + PostgreSQL | jeder DB-/Storage-/Email-/Analytics-Processor timeout/429/5xx/crash/restart | Resume ab Checkpoint, Pflichtnotification durable | Failure kann Case nicht Complete markieren; Poison landet bounded DLQ; Repeat erzeugt keine Doppelwirkung | System/Ops | Orchestrator/Outbox/Provider | N Processor, Fail an jeder Grenze | isoliertes PostgreSQL + Provider emulators | `npm run test:integration -- tests/integration/privacy/privacy-provider-reconciliation-postgres.test.ts`; `npm run privacy:failure-drill` | 0 False Complete; je Dedupe-Key 1 Outcome; jeder Fehler in Case/Audit/Ops/Outbox sichtbar | Failure-Matrix/Timeline | Privacy + Ops | PLANNED |
| `22-AC-09` | `STH-033`, `REQ-UX-003`, `REQ-QA-002` | unverstandene irreversible Entscheidung, P0 | E2E + A11y + moderiert | Request, Verify, Download, Hold-Erklärung, Delete und Analytics Opt-out | Nutzer lösen Aufgabe und erklären Wirkung korrekt | kritische Fehlannahme/Abbruch oder unzugänglicher State blockiert Cohort | Candidate/Employer/Invitee | Browser/Research | n≥5 Candidate + n≥5 Employer/Invitee, anonymisierte Fixtures | Desktop/360 + moderierte Session | `npm run test:e2e:browser -- tests/e2e/quality/phase22-privacy-legal-quality.spec.ts`; manueller Ablauf nach `codex-plan/research/phase22-privacy-comprehension-protocol.md` | 0 critical/serious Axe; Task Success ≥80 % je Rolle; 0 kritische Fehlannahmen; rote Findings geschlossen/re-scope | Axe-/Researchprotokoll | UX Research + Privacy | PLANNED |
| `22-AC-10` | ADR-033, `REQ-QA-003` | Migration/Restore reaktiviert PII, P0 | Migration + Recovery | leer, Legacy Consents/Cases, Partial Backfill, Wiederholung, Restore | additive Migration und korrekte Legacyklassifikation | Fake Re-consent, Duplicate Outcome, restored erased PII oder fehlendes Inventory blockiert | System/Data | Prisma/Backup/Privacy | Phase-19-Bestand + erased tombstone | isoliertes PostgreSQL 16 + isolierter Restore | `npm run test:integration -- tests/integration/schema/phase22-privacy-legal-migration-postgres.test.ts`; `npm run db:migrate`; `npm run db:migrate:status`; `npm run privacy:restore-drill` | 0 gefälschte Consents; 0 Duplicate Outcomes; Restore-Reconcile entfernt/blockiert 100 % Tombstone-Canaries | Migration-/Restoremanifest | Data + Privacy + Ops | PLANNED |
| `22-AC-11` | `REQ-QA-001`, `REQ-QA-003` | Radar/Billing/Audit/Privacy-Regression, P0 | G3 Portal-Golden | alle Owning-/Regression-/Browser-/Recovery-Gates | kompletter Vertrag auf identischem Commit | Skip, Retry, anderer Digest oder offene Pflichtzeile blockiert | alle | Repository/Portale | deterministischer Seed | Clean Clone, PostgreSQL 16, Production Browser | nacheinander `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e:http`, `npm run test:e2e:browser`, `npm run test:e2e:hsts`, `npm run test:release` | alle Exit 0; Retry 0; keine unerklärten Skips; Restore isoliert; gleicher Commit/Digest | G3-/Recovery-Manifest | QA + Ops | PLANNED |

## 22. Performance-, Query-, Queue-, Datei-, Latenz- und Lastgrenzen

- Case-/Processorbatch ≤100, checkpoint nach jedem bounded Batch;
- Export wird gestreamt; Peak-Heap wächst nicht proportional zur Paketgröße.
  Referenztest: 10.000 Rows plus 5-MiB-Dokument, Heapdelta ≤32 MiB;
- Artifact Download TTL höchstens 15 Minuten und single-use; keine CDN-/Proxy-
  Cachebarkeit;
- je Processor expliziter Timeout ≤30 s pro Call, danach retryable Partial;
- Case-SLA stammt aus versionierter, freigegebener Policy. Testfixture nutzt
  30 Kalendertage; overdue threshold und Eskalation sind deterministisch;
- Analytics-/Consent-Write p95 ≤250 ms bei 50 parallelen Events in der
  isolierten Referenzumgebung; keine unbounded Properties/Queries;
- beide Referenzgrenzen werden gemeinsam reproduzierbar mit
  `npm run privacy:load` geprüft;
- Production-Kapazität, p95 Handling Time und Unit Cost werden mit Phase 23/
  `STH-034` gemessen, nicht aus Demo-Zeiten behauptet.

## 23. Geschützte Phase-01–18-Invarianten und Owning-Regressionen

```powershell
npx vitest run --config vitest.config.ts tests/unit/privacy tests/unit/analytics/event-contracts.test.ts tests/unit/auth/registration-consent.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/privacy/privacy-case-service.test.ts tests/integration/privacy/privacy-export-postgres.test.ts tests/integration/privacy/privacy-postgres.test.ts tests/integration/privacy/talent-radar-candidate-eligibility-loss-postgres.test.ts tests/integration/privacy/talent-radar-contact-request-postgres.test.ts tests/integration/privacy/talent-radar-reveal-postgres.test.ts tests/integration/analytics/admin-funnels-postgres.test.ts
npx playwright test --config=playwright.config.ts tests/e2e/flows/phase17-talent-radar.spec.ts tests/e2e/flows/phase17-journeys.spec.ts --project=chromium-journeys
```

Geschützt bleiben Candidate-/Tenant-Ownership, bestehende Challenge,
Radar-Anonymität/Eligibility-Loss/Reveal-Revocation, immutable
Application/Billing/Audit-Evidence, Essential Analytics, Consenttrennung und
ehrliche Mock-Copy bis zum wirklichen Cutover.

## 24. Rollback oder Roll-forward-only

Draft Legal Publications, Analyticsflags und noch nicht ausgeführte additive
Schemaänderungen sind rückschaltbar. Nach versandtem Export, wirksamer
Correction/Erasure, externer Providerlöschung oder veröffentlichter
Rechtsversion gilt Roll-forward: Evidence bleibt, Fehler werden korrigiert,
PII wird nicht aus Backup/DB-Rollback wiederbelebt. Kill Switch pausiert neue
Jobs/Analytics und erhält Partial-/Hold-/Proof-Zustände.

## 25. Benötigte Evidence und Artefakte

Der Phase-22-Record enthält Commit/Digest, signierte Inventory-/LegalGate-/
AVG-/AVV-/DSFA-/Retention-/Hold-Versionen, Migration-/Backfill-Counts,
Exportmanifest/-hash ohne Bytes, Foreign-Canary- und Processor-Matrix,
Failure-/Resume-/DLQ-Timeline, Providerreceipts, Restore-Diff, Consent-/
Analyticsreport, Rolle-/Step-up-/Tenantmatrix, Legal-Link-/Hash-Abgleich,
Mobile/A11y, anonymisiertes moderiertes Researchprotokoll, Flags/Kill-Switch
und G3. Externe Freigaben bleiben getrennt von Teststatus.

Die maschinenlesbare technische Matrix und alle noch fehlenden
Fachentscheidungen stehen in
[`phase22-external-gates.md`](./phase22-external-gates.md). Das
vorregistrierte, noch nicht durchgeführte Researchverfahren steht in
[`research/phase22-privacy-comprehension-protocol.md`](./research/phase22-privacy-comprehension-protocol.md).

## 26. Definition of Done für Technik und Quality-Gate

Technikstatus verlangt vollständiges Inventory, stabile LegalGates, echte
Export-/Correction-/Erasure-Processor, Holds, Proof, Failure Propagation,
Legal Publication und eventweise Analytics-Policy. Quality verlangt
`22-AC-01` bis `22-AC-11` `PASS` auf demselben Commit, G3/Restore grün,
keine Pflichtzeile `N/A`, kein Skip/Retry und geschlossene kritische
Verständlichkeitsbefunde. Fachfreigaben dürfen trotzdem Aktivierung blockieren.

## 27. Gate für abhängige Folgephasen

Phase 23 übernimmt nur versionierte, bounded, idempotente Processor mit
vollständiger Failure-Evidence. Phase 24/26/30A/31 dürfen einen Paid-,
Verification-, Search-Learning-, Radar- oder AVG-relevanten Flow erst
aktivieren, wenn dessen exakte `ProcessingApproval`-Version freigegeben ist.
Phase 25 muss Step-up und getrennte Grants liefern, bevor riskanter
Productionvollzug startet.

## 28. Ausdrücklich nicht bewiesene Aussagen und Referenzen

Nicht bewiesen sind Rechtskonformität ohne Counsel, AVG-/DSFA-Freigabe,
Production-SLA, vollständige Löschung gesetzlich gebundener Evidence,
autonome Worker, reale Provider, Marktvertrauen oder generelle
Analyticsfreigabe. Ein erfolgreicher technischer Export ist kein Beweis, dass
das Inventory rechtlich vollständig ist; der signierte Fachentscheid bleibt
Pflicht.

Verbindlich ergänzend gelten
[`remediation-execution-contract.md`](./remediation-execution-contract.md),
ADR-031/032/033/034/036/037 in [`decisions.md`](./decisions.md),
[`requirements-matrix.md`](./requirements-matrix.md),
[`remediation-traceability.md`](./remediation-traceability.md) und
[`route-role-matrix.md`](./route-role-matrix.md).
