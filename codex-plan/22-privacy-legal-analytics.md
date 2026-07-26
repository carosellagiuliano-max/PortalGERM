# Phase 22 — Datenschutzvollzug, Rechtsgrundlagen und LIVE-Analytics

> **Status: GEPLANT / NICHT BEGONNEN.** Die bestehende Privacy-Statusmaschine
> ist stark, Export und Delete bleiben jedoch bewusst kontrollierte Mocks.
> Rechtsinhalte und optionale LIVE-Produktanalytics sind nicht freigegeben.

## Ziel

Betroffenenrechte tatsächlich vollziehbar machen, Rechtsdokumente versioniert
ausliefern und Produktanalytics nur auf einer dokumentierten, datensparsamen
und widerrufbaren Grundlage aktivieren.

## Ausgangslage und Problem-IDs

- `STH-006`: Export liefert fünf Zählerkategorien; Delete endet ohne Erasure.
- `STH-007`: Checkbox/Hash existieren, vollständige verlinkte AGB,
  Datenschutz-, Impressum-, Cookie-/Analytics- und Zahlungsdokumente fehlen.
- `STH-017`: optionale Product-Usage-Telemetrie ist in Staging/Production
  fail-closed; essentielle operative Events bleiben aktiv.
- STH-002 wird technisch in Phase 20 erreichbar gemacht.

## In Scope

- Versioniertes Dateninventar je Entität, Zweck, Rechtsgrundlage und Retention.
- Vollständiger, verständlicher, portabler Export inklusive Messages,
  Bewerbungen/Snapshots, Consents, Radar/Reveal-Evidence, zulässiger eigener
  CV-/Dokumentbytes beziehungsweise gleichwertig verschlüsselter und im
  Manifest gehashter Artefakte, Support und zulässiger Billingdaten.
- Verschlüsseltes Exportartefakt, kurzlebiger Download, Ablauf und erneute
  Bereitstellung.
- Lösch-/Anonymisierungsmatrix, Legal Hold, Accounting-/Fraud-/Audit-Retention,
  Proof of Erasure, Crash/Resume und Restore-Schutz.
- Korrektur- und Consent-Widerruf bis in abhängige Projektionen.
- Versionierte Legal-Dokumente mit Draft/Review/Publish/Re-consent.
- Event-für-Event Analytics-Basis, Consent/Opt-out, Pseudonymisierung,
  Retention und serverseitige Aggregation.

## Out of Scope

- Rechtsberatung durch das Engineering-Team.
- Pauschales Cookie-Banner ohne tatsächliche Technologie-/Rechtsbewertung.
- Third-Party-Ad-Pixel, Cross-Site-Tracking oder freie PII-Properties.
- Löschen von Audit-/Accountingdaten entgegen freigegebener Retention.
- Success Fee oder AVG-Freigabe; dies bleibt extern und in Phase 31 gegatet.

## Rollen und Prozesse

Public liest veröffentlichte Rechtsversionen. Candidate, Employer Owner/Admin,
Recruiter, eingeladene Nutzer sowie identifizierbare Leads und
Missbrauchsmelder erhalten einen explizit definierten
Export/Delete/Correct-/Anonymize-Vertrag; nicht-kontoführende Data Subjects
bekommen einen sicheren alternativen Identitätsnachweis. Privacy Admin
bearbeitet capability- und step-up-gesichert; Legal/Finance geben Policy frei;
System führt Retention/Erasure aus. Product/Admin liest nur suppressierte
Analytics.

## Betroffene Dateien und Module

- `lib/privacy/**`, Candidate-/Admin-Privacy-Routen und Notification-Outbox
- alle personenbezogenen Prisma-Modelle, Storage aus Phase 21
- `lib/auth/registration-consent.ts`, `lib/privacy/user-consent.ts`
- neue Public Legal Routes/CMS, Footer, Registration und Checkout
- `lib/analytics/**`, Public Actions, Admin Funnels und Cockpit
- Worker/Retention aus Phase 23, Runbooks und Evidence

## Datenmodelländerungen

Versionierte LegalDocument/Revision/Publication, Consent-Evidence mit exakter
Dokumentreferenz, ExportArtifact/Delivery, ErasureJob/EntityOutcome,
LegalHold/RetentionPolicy und Proof-of-Erasure. Analytics kann zusätzliche
Consent-/Pseudonym-Epochen benötigen. Bestehende `PrivacyRequest`,
`UserConsentEvent`, Events und Audit werden erweitert, nicht durch eine zweite
Parallel-Domain ersetzt.

## Sicherheits- und Datenschutzfolgen

- Exportpakete sind verschlüsselt, owner-bound, kurzlebig und no-store.
- Admin darf Inhalt nur sehen, soweit die Capability und Fallbearbeitung dies
  erfordern.
- Delete ist eine explizite Policy pro Entität, keine generische Cascade.
- Proof enthält Digests/Outcomes, keine gelöschten Inhalte.
- Analytics ist default-off, bis die jeweilige Basis freigegeben ist; Widerruf
  stoppt neue optionale Erfassung.

## Migrationsstrategie

- [ ] Dateninventar und Retention zuerst freigeben.
- [ ] Additive Policy-/Artifact-/Hold-/Outcome-Modelle.
- [ ] Bestehende Consent-Versionen als `LEGACY_SHORT_NOTICE` klassifizieren;
  Re-consent nicht fälschen.
- [ ] Export V2 parallel zum Mock-Manifest validieren, bevor UI umschaltet.
- [ ] Erasure zuerst Dry Run, dann feature-gegatete kleine Kohorten.
- [ ] Analytics pro Eventfamilie aktivieren, nie global per unkontrolliertem
  Boolean.

## Implementierungsschritte

- [ ] Schweizer DSG-/DSGVO-/Aufbewahrungs-/AVG-/Tax-Owner und Dokumente klären.
- [ ] Vollständiges personenbezogenes Dateninventar mit Owner und Retention.
- [ ] Pro Data-Subject-Klasse Identity-Challenge, Ownership, Export,
  Delete/Anonymize und Correct festlegen; kein „später“ ohne benannte
  Folgephase.
- [ ] Legal CMS/Revision/Publish/Hash/Re-consent und echte Links implementieren.
- [ ] Export-Builder V2 und verschlüsselte Delivery integrieren.
- [ ] Delete/Anonymize/Legal-Hold-Policy als resumable Jobs implementieren.
- [ ] Korrektur und Consent-Widerruf auf abhängige Daten/Projektionen anwenden.
- [ ] Analytics Event-/Legal-Basis-Matrix und Preference-Bindung definieren.
- [ ] LIVE-Erfassung nur für freigegebene Events aktivieren; Retentionworker
  und Suppression belegen.
- [ ] Privacy Admin UX, SLA, Audit, Fehler-/Retry-/Appeal-State fertigstellen.
- [ ] Riskante Privacy-Aktionen als fail-closed Zwei-Actor-Workflow
  vorbereiten; LIVE-Execution erst nach personell getrennten Grants und
  Step-up aus Phase 25 aktivieren.
- [ ] Restore-Test beweist, dass Erasure nicht unkontrolliert reaktiviert wird.

## Abhängigkeiten

Phasen 19–21 für Identity und Storage-Hooks. Phase 22 schliesst Policy,
idempotente bounded Handler und lokale/isolierte Vertical Tests. Autonome
Ausführung aus Phase 23 sowie personell getrennte Admin-Grants/Step-up aus
Phase 25 sind Aktivierungs-Gates für produktiven Privacy-Betrieb, keine
Rückwärtsabhängigkeit des technischen Phase-22-Abschlusses. Externe
Legal/Privacy/Tax-/AVG-Freigaben bleiben separat.

## Risiken und Regressionen

- Unvollständiger Export oder überbreiter Export fremder Daten.
- Destruktive Löschung von Accounting/Audit/Employer-Evidence.
- Re-consent-Lockout oder unwirksame Legacy-Annahme.
- Analytics-Widerruf beeinflusst essentielle Security-/Operational-Events.
- Bestehende Radar-Reveal- und Candidate-Anonymity-Tests bleiben unverändert
  streng.

## Abwärtskompatibilität und Rollback

Legal- und Analytics-Publikationen sind versioniert. Export V1 bleibt während
Vergleichsmessung sichtbar als Mock, aber nicht als vollständiger Abschluss.
Erasure-Jobs besitzen Dry Run, Checkpoint und Stop/Pause; kein Rollback stellt
gelöschte PII aus Backup stillschweigend wieder her.

## Akzeptanzkriterien und Tests

### Unit / Policy

- [ ] Vollständigkeitsmatrix und Foreign-data-Abgrenzung.
- [ ] Retention/Hold/Anonymize je Entität.
- [ ] Legal-Version, Hash, Re-consent und Withdraw.
- [ ] Analytics consent off/on/revoke und Essential-vs-Optional.

### PostgreSQL / Integration

- [ ] Export enthält alle freigegebenen Kategorien und keine fremde PII.
- [ ] Bekannte eigene CV-/Dokumentdatei ist byte- oder hash-identisch als
  manifestiertes Artefakt enthalten; fremdes Tenant-/Candidate-Objekt dient als
  ausgeschlossener Canary.
- [ ] Erasure/Anonymize mit aktiver Bewerbung, Messages, Billing, Audit und Hold.
- [ ] Candidate, Employer Owner/Admin, Recruiter, eingeladene Nutzer sowie
  identifizierbare Lead-/Reporter-Daten besitzen jeweils positive
  Policy-Outcomes und Foreign-/Identity-Denials.
- [ ] CORRECT läuft request→verify→approve→apply über abhängige Projektionen,
  Audit und Notification; Retry ist idempotent und fremde Daten bleiben
  unverändert.
- [ ] Crash/Resume, Exactly-once Outcomes und Proof.
- [ ] Consent-/Analytics-Retention und Pseudonymrotation.
- [ ] Capability/Step-up/Owner-Denials vor Datenzugriff.

### E2E und manuell

- [ ] Register → Verify → Request → Challenge → Export Download.
- [ ] Delete Dry Run → Hold/Approve → Execution → post-delete Login/IDOR.
- [ ] Correct Request → Verify → Approve → Correction → Projektion/
  Notification sowie mindestens ein Nicht-Candidate-Data-Subject-End-to-End.
- [ ] Legal Links in Registration, Footer und Checkout auf exakt sichtbare
  Version.
- [ ] Analytics Preference/Consent auf Desktop/360 px, Keyboard/Screenreader.
- [ ] Restore-/Retention- und Incident-Drill.

## Evidence und Definition of Done

- [ ] Export liefert ein echtes portables Paket, nicht nur Counts.
- [ ] Delete/Anonymize führt freigegebene Outcomes tatsächlich aus.
- [ ] Holds und gesetzliche Retention sind beweisbar.
- [ ] Öffentliche Legal-Dokumente sind versioniert, verlinkt und extern
  freigegeben.
- [ ] Optionale LIVE-Analytics ist minimal, widerrufbar und retention-bound.
- [ ] Loading-, Empty-, Error-, Locked-, Retry-, Conflict- und Success-Zustände
  sind für Privacy Cases, Legal/Consent und Analytics Preferences umgesetzt.
- [ ] Alle Gates und vertikalen Privacy-/Restore-E2Es sind grün.
- [ ] Evidence trennt technische Fertigstellung von juristischer Freigabe.

## Offene externe Voraussetzungen

Datenschutz-, Vertrags-, Impressums-, Cookie-/Analytics-, Steuer-, Rechnungs-
und AVG-Freigabe sowie benannte Legal-/Privacy-Owner. Ohne schriftliche
Freigabe bleiben Dokumente Draft und optionale LIVE-Analytics aus.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Tatsächlich ausübbare Rechte, belastbare Vertragsbasis und messbare Produktsteuerung. |
| Problem-IDs | STH-006, STH-007, STH-017. |
| Prerequisites | 19–21; Legal/Privacy/Tax; 23/25 für Vollbetrieb. |
| Deliverables | Export V2, Erasure/Holds/Proof, Legal CMS, consentgebundene Analytics. |
| Security / Privacy | Owner-bound Download, minimale Adminsicht, keine pauschale Löschung/Telemetrie. |
| Tests | Entity-Matrix, crash/resume, restore, re-consent, analytics revoke, E2E. |
| Expected Result | Kein Mock-Abschluss eines realen Betroffenenrechts. |
| Risks / Limits | Engineering erteilt keine Rechtsfreigabe. |
