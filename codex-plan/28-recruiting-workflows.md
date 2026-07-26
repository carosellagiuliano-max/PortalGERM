# Phase 28 — Bedarfsgegatete Recruiting-Workflows

> **Planstatus: GEPLANT, standardmässig DEFERRED. Technikstatus: NICHT
> IMPLEMENTIERT. Quality-Gate: NICHT GELAUFEN. Aktivierung: DISABLED.**
> Diese Phase besteht aus zwei unabhängig freigebbaren P3-Tracks. Weder ein
> externer Bewerbungs-Tracker noch ein Vollscheduler ist Voraussetzung für den
> bestehenden internen Bewerbungsflow. Ein Track wird erst nach dokumentiertem
> Demand-Gate umgesetzt und ist danach P0 nur für eine Launchklasse, die ihn
> ausdrücklich verspricht.

Die gemeinsamen Regeln aus
[`remediation-execution-contract.md`](./remediation-execution-contract.md)
gelten vollständig. Die folgende Instanziierung darf sie nicht abschwächen.

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Track | Plan | Technik | Quality-Gate | Aktivierung | Standardpriorität |
|---|---|---|---|---|---|
| 28A externer Tracker | `DEFERRED` bis Demand-Go | nicht implementiert | nicht gelaufen | `DISABLED` | P3; P0 nur falls im Angebot versprochen |
| 28B Interview-Scheduler | `DEFERRED` bis Demand-Go | nicht implementiert | nicht gelaufen | `DISABLED` | P3; P0 nur falls im Angebot versprochen |

Ein Research-Go erlaubt Planung/Prototyping, aber noch keine Produktaktivierung.

### 2. Ziel und messbarer Nutzerwert

- **28A:** Kandidat:innen können einen externen Bewerbungsweg freiwillig,
  ehrlich und ohne ATS-Behauptung selbst fortschreiben. Erfolg wird an
  bestätigtem Bedarf, wiederholter Nutzung und korrekter `Click ≠ Submitted`-
  Semantik gemessen.
- **28B:** Kandidat:in und berechtigter Arbeitgeber können einen realen
  Interviewtermin mit Zeitzone, RSVP, Verschiebung, Storno, ICS und Reminder
  verwalten. Erfolg ist ein konsistenter Termin auf beiden Seiten ohne
  Doppelbuchung oder Reminder-Duplikat.
- Der bestehende interne Apply→Pipeline→Messages-Flow bleibt unabhängig
  vollständig nutzbar.

### 3. Tatsächlicher Repositoryzustand

- `STH-015`: `app/(public)/jobs/actions.ts` schreibt bei `APPLY_URL` nur
  `EXTERNAL_APPLY_CLICKED`; `lib/applications/service.ts` lehnt externe Jobs für
  interne Applications korrekt ab.
- `STH-016`: `INTERVIEW`/`SCHEDULED_INTERVIEW` sind Status-/Mock-Semantik ohne
  persistente Slots, RSVP, Zeitzone, ICS oder Reminder.
- Interne Application-, Conversation-, Snapshot-, Assignment- und
  Tenant-Grenzen sind implementiert und historisch verifiziert.
- Es gibt noch keine Demand-Evidence, die Bau und Betrieb beider Tracks
  rechtfertigt.

### 4. Findings und Requirements

- Bestehend: `STH-015`, `STH-016`, `REQ-CAN-003`, `REQ-EMP-005`,
  `REQ-DATA-001`, `REQ-QA-001/002`.
- Querliegend: `STH-009`, `STH-013`, `STH-026`, `STH-030`, `STH-031`,
  `STH-033`, `STH-034`.
- Neue Requirements der Phase:
  - `REQ-REC-028A-001`: externe Zustände sind candidate-owned und
    quellengekennzeichnet;
  - `REQ-REC-028B-001`: Interview und Pipeline sind getrennte,
    versionierte Statusmaschinen;
  - `REQ-REC-028-002`: kein optionaler Track blockiert interne Applications.

### 5. In Scope

- **28A nach Demand-Go:** begun/submitted/interview/offer/rejected/hired/
  withdrawn/archived, immutable Job-/Company-Snapshot, Resume nach
  unauthentifiziertem Klick, freiwillige Reminder und klare Herkunft
  `CANDIDATE_CONFIRMED`.
- **28B nach Demand-Go:** Interview, Slot/Proposal, IANA-Zeitzone,
  Teilnehmer, RSVP, Accept/Decline/Reschedule/Cancel, ICS, Reminder und
  Timeline.
- Version, Idempotency Key, Eventhistorie, Privacy-Lifecycle, Notifications,
  Mobile/A11y und Cross-Tenant-Schutz für jeden aktivierten Track.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

- Scraping externer ATS, Lesen privater Mailboxen, automatisches
  Submission-/Hire-Signal, Video-Meeting-Hosting und generischer ATS-/
  Kalenderersatz.
- Talent Pool, automatische Auswahl/Ablehnung, Arbeitgeberranking nach
  Candidate Match Score sowie ATS-/Kalender-Sync ohne separaten Provider-,
  Legal- und Demand-Go.
- Solange ein Track deferred ist: keine Navigation/CTA, kein Event, kein
  Worker, keine Marketingbehauptung; Direct Actions und geplante Routen
  antworten fail-closed.

### 7. Rollen und Owner

- Candidate besitzt 28A und RSVP/Consent in 28B.
- Employer Owner/Admin und zugewiesener Recruiter verwalten nur Interviews der
  eigenen Firma/Assignments; Viewer bleibt read-only.
- Product Owner entscheidet Demand-Go; Privacy Owner Retention/Export;
  Operations Owner Reminder/SLA; Security Owner Abuse-/ATO-Vertrag.
- Support/Admin erhält keinen pauschalen Zugriff auf Candidate-Notizen oder
  Interviewdetails.

### 8. Portale, Routen, Services und Worker

- Bestehend zu schützen: Public Apply, `/candidate/applications/**`,
  `/employer/applicants/**`, Conversations und Notifications.
- Geplant hinter getrennten Flags:
  `/candidate/applications/external/**`,
  `/candidate/interviews/**`,
  `/employer/applicants/[id]/interviews/**`.
- Services: `lib/recruiting/external-tracker.ts`,
  `lib/recruiting/interviews.ts`, Privacy-Serializer, Outbox-Templates.
- Worker: Reminder/Expiry erst über Phase-23-Queue; Calendar-/ATS-Port bleibt
  optional und standardmässig `DISABLED`.

### 9. Datenmodell, Constraints, Indizes und Klassifikation

- 28A: `ExternalApplicationTracker`, immutable `ExternalJobSnapshot`,
  append-only `ExternalApplicationEvent`; unique Candidate×Source×External-ID
  beziehungsweise deduplizierter Snapshotfingerprint.
- 28B: `Interview`, `InterviewProposal`, `InterviewParticipant`,
  `InterviewResponse`, `InterviewEvent`, `CalendarArtifact`; eindeutige
  aktive Proposal-Version und Reminder-Dedupe-Key.
- Jede Mutation trägt Version und Idempotency Key; Events sind append-only.
- Candidate-Notizen, Teilnehmerdaten und ICS sind personenbezogen/vertraulich
  und werden in Phase-22-Inventar, Export/Delete/Correct/Retention/Hold
  aufgenommen.

### 10. Expand–Migrate–Contract und Backfill

- Additive Tabellen/Indizes; keine Änderung bestehender Application-IDs.
- `EXTERNAL_APPLY_CLICKED` wird nie zu `SUBMITTED` backgefüllt.
- Bestehende `INTERVIEW`-Applications bleiben `LEGACY_STATUS_ONLY`; erst eine
  ausdrückliche Aktion erzeugt ein Terminobjekt.
- Backfill ist wiederaufnehmbar und prüft Counts, Orphans, Candidate-/Company-
  Tenant und Eventreihenfolge. Kein Contracting vor G3 und Restore-Probe.

### 11. Serverlogik, Queue und Provider

- 28A akzeptiert nur owner-scoped, erlaubte Transitionen und speichert die
  Signalquelle; Kandidatenselbstauskunft wird nie als ATS-Bestätigung gewertet.
- 28B trennt Interview- von Application-Status, verwendet IANA-Zeitzonen und
  optimistische Versionen; Accept/Decline/Reschedule/Cancel sind idempotent.
- Reminder werden atomar mit Outbox geplant, durch Phase 23 geleast, dedupliziert
  und nach Retrybudget in DLQ verschoben.
- ICS enthält nur notwendige Felder. Ein Providerfehler ändert den persistierten
  fachlichen Termin nicht und wird sichtbar als Delivery-Fehler behandelt.

### 12. UX-Zustände

Für jeden aktivierten Track sind Loading, Empty, Locked/Deferred, Pending,
Error, Retry, Conflict/Stale Version, Expired, Cancelled und Success Pflicht.
28A zeigt stets Quelle und „von dir bestätigt“. 28B zeigt Zeitzone,
Teilnehmer, letzten Änderungsactor und Deliverystatus. Ein deaktivierter Track
zeigt keine Fake-Aktion.

### 13. Mobile und Accessibility

Alle Hauptaktionen funktionieren bei 320/360 px, Touch und 200/400 % Zoom.
Timeline, Slotwahl und RSVP sind keyboard-/screenreaderbedienbar; Dialoge
besitzen Fokus-Rückgabe und Fehlerzusammenfassung. Zeitzonen werden nie nur
farblich unterschieden.

### 14. Authentisierung, Step-up, Autorisierung und Tenant

- 28A: Candidate Ownership bei jedem Read/Write; fremde IDs ergeben sichere
  404 ohne Datenänderung.
- 28B: Candidate-Participant oder aktive Company Membership plus Assignment;
  Kontextwechsel ist keine Berechtigung.
- Export grösserer Interview-/Candidate-Datenmengen und kritische
  Teilnehmeränderung folgen `STH-030`-Step-up.
- Direct Actions, stale Sessions, suspendierte Actor/Company und Cross-Tenant-
  IDs werden serverseitig abgelehnt.

### 15. Datenschutz, Retention, Export, Löschung und Audit

- Zweckbindung je Track; Datenminimierung in ICS, Logs, Analytics und Audit.
- Export umfasst eigene Tracker-, Termin-, Participant-, ICS-, Reminder- und
  Snapshotdaten; fremde Tenant-Canaries dürfen nie enthalten sein.
- Delete/Correct/Retention/Hold folgt der versionierten Phase-22-Matrix;
  bereits zugestellte ICS werden nicht fälschlich als rückholbar behauptet.
- Jede Transition, Delivery und privilegierte Einsicht wird redigiert auditiert.

### 16. Abuse-, Fraud- und Missbrauchsszenarien

- Reminder-Spam, Masseneinladungen, manipulierte Zeitzonen/ICS, Cross-Tenant-
  Teilnehmer, Replay, Statusfälschung, Account Takeover und kompromittierte
  Firmenkonten.
- Rate Limits und per-Actor/Tenant-Quotas; ungewöhnliche Volumen gelangen in
  die `STH-031`-Riskqueue.
- Kein importierter Kalendertext wird als HTML gerendert; keine privaten Notes
  in ICS/Audit/Analytics.

### 17. Externe und organisatorische Voraussetzungen

- Datierte Demand-Evidence aus Phase 29: mindestens fünf Kandidat:innen für
  28A beziehungsweise fünf Employer/Recruiter plus fünf Kandidat:innen für 28B,
  klarer wiederkehrender Bedarf und ein benannter Product Owner.
- Privacy-/Retention-Freigabe, Support-/Operationskapazität und gegebenenfalls
  Calendar-/ATS-DPA. Vendor ist für den internen ICS-Kern nicht erforderlich.

### 18. Harte Abhängigkeiten

- Beide Tracks: Phase 19; für Aktivierung Phasen 20, 22, 23, 25 und grünes
  Phase-29-Demand-Gate.
- Reale CV-Bytes in 28A benötigen Phase 21.
- Phase 27 nur, wenn Multi-Persona separat freigegeben ist.
- Interne Applications hängen von keinem Phase-28-Track ab.

### 19. Geordnete Implementierungsschritte

1. Research-/Demand-Gate je Track dokumentieren.
2. Separaten Status-/Ownership-/Retention-ADR freigeben.
3. Additive Migration und Backfill-/Rollbacktests.
4. Domain-State-Machine, Idempotenz, RBAC und Audit.
5. Privacy-Serializer und Outbox/Worker.
6. UI-Zustände und Route-/Rolleninventar.
7. Unit/PostgreSQL/Failure/E2E/Mobile/A11y.
8. G3, Allowlist, Smoke und erst danach Aktivierungsentscheid.

### 20. Feature-Flags, Kill Switch und Aktivierung

- Getrennte serverseitige Gates `external_application_tracker` und
  `interview_scheduler`; keine gemeinsame „recruiting-v2“-Freigabe.
- Reihenfolge: `DISABLED → TEST → ALLOWLIST → LIVE` je Track.
- Kill Switch stoppt neue Mutationen/Reminder, erhält Historie und erlaubt
  sichere Storno-/Exportpfade. Calendar/ATS besitzt ein separates Providergate.

### 21. Akzeptanzkriterien und Testmatrix

- `AC-28-01`: Interne Applications bleiben ohne 28A/28B vollständig grün.
- `AC-28-02`: 28A wird ohne Demand-Go überall fail-closed deaktiviert.
- `AC-28-03`: Click ist nie Submitted; externe Outcomes sind owner- und
  quellengebunden.
- `AC-28-04`: 28B wird ohne Demand-Go überall fail-closed deaktiviert.
- `AC-28-05`: Termin, RSVP, Reschedule, Cancel, ICS und Reminder sind
  persistent, idempotent und zeitzonenkorrekt.
- `AC-28-06`: Tenant/Assignment/Participant/Privacy-Grenzen halten.
- `AC-28-07`: Migration, Retry/DLQ und Rollback sind belegt.
- `AC-28-08`: Aktivierte Flows bestehen E2E, Mobile und A11y.

| Criterion / Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC-28-01 / REQ-REC-028-002 | P0 Regression | PostgreSQL + E2E | interner Apply→Pipeline→Message bei beiden Flags aus | bestehende Reise bleibt vollständig | Direct Action darf kein neues Trackmodell voraussetzen | Candidate, Employer | Public/Candidate/Employer | interner LIVE-like Job, zwei Tenants | isoliertes PostgreSQL + Chromium | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/applications-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase17-journeys.spec.ts --project=chromium-journeys` | 100 % bestehende Assertions grün; 0 neue Trackrows | Testreport + DB-Fingerprint | Recruiting Engineering | PLANNED |
| AC-28-02 / STH-015 | P3 default | Contract/Security | 28A ohne Demand-Go | Route/CTA/Event/Worker fehlen | Direct Action/URL/Flagmanipulation bleibt denied | Candidate/Public | Router, Server Action | Flag off, Candidate | Test | `npx vitest run --config vitest.config.ts tests/unit/recruiting/phase28-demand-gates.test.ts` | 0 persistierte Tracker/Events; definierter `FEATURE_UNAVAILABLE` | Unitreport | Product + Security | PLANNED |
| AC-28-03 / REQ-REC-028A-001 | P0 falls aktiviert | Unit + PostgreSQL | click→resume→candidate-confirmed submit→outcome | Events in erlaubter Reihenfolge, Snapshot stabil | fremder Candidate, Replay, Click-as-submit und invalid transition denied | Candidate | 28A Service/Portal | anonymer Klick, zwei Candidates, expired Job | isoliertes PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/recruiting/external-application-tracker.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/recruiting/external-application-tracker-postgres.test.ts` | Click erzeugt 0 Submitted; Retry erzeugt genau 1 Event; Cross-user 0 Reads/Writes | JUnit + Eventtimeline | Recruiting Engineering | PLANNED |
| AC-28-04 / STH-016 | P3 default | Contract/Security | 28B ohne Demand-Go | keine Schedulerbehauptung | alte `INTERVIEW`-Zeile wird nicht als Termin ausgegeben | Candidate, Employer | UI/Service | Legacy status-only Application | Test | `npx vitest run --config vitest.config.ts tests/unit/recruiting/phase28-demand-gates.test.ts` | 0 Interviewrows; UI nennt keinen Termin | Unitreport/Snapshot | Product + Security | PLANNED |
| AC-28-05 / REQ-REC-028B-001 | P0 falls aktiviert | Unit + PostgreSQL | propose→accept→reschedule→cancel; DST und ICS | beide Seiten sehen denselben Instant | parallele Accept/Reschedule, stale Version, doppelte Reminder | Candidate, Recruiter | Scheduler/Outbox | Zürich DST, zwei Slots, duplicate delivery | isoliertes PostgreSQL + Fake Clock | `npx vitest run --config vitest.config.ts tests/unit/recruiting/interview-scheduler.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/recruiting/interview-scheduler-postgres.test.ts` | genau 1 aktive Version/ICS/Reminder je Dedupe-Key; Instant identisch | JUnit + ICS Golden + DB Counts | Recruiting + Ops | PLANNED |
| AC-28-06 / STH-030/031 | P0 | Security/PostgreSQL | Rollen×Tenant×Assignment×Participant | berechtigter Actor liest/minimiert | Company B, Viewer mutation, stale Step-up, Masseneinladung denied/alerted | Candidate, Owner, Recruiter, Viewer | Repositories/Actions | Company A/B, suspended actor | isoliertes PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/recruiting/recruiting-authorization-postgres.test.ts` | 0 Foreign-Canary-Leaks; 100 % Denials ohne Zielmutation | Securitymatrix + Audit | Security Owner | PLANNED |
| AC-28-06 / Phase 22 | P0 Privacy | PostgreSQL | Export/Delete/Correct/Retention/Hold | eigene erlaubte Daten vollständig | fremde Notes/ICS/Participant-Canary ausgeschlossen | Candidate, Privacy Admin | Privacy lifecycle | beide Tracks, foreign tenant canaries | isoliertes PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/privacy/recruiting-lifecycle-postgres.test.ts` | Vollständigkeitscount stimmt; 0 fremde Canaries; Hold unverändert | Exportmanifest + DB Report | Privacy Owner | PLANNED |
| AC-28-07 / STH-009/013 | P0 falls aktiviert | Migration + Worker Failure | clean/upgrade/interrupted migration; crash/retry/DLQ | wiederaufnehmbar, dedupliziert | Poison, out-of-order, Provider timeout | System/Ops | DB/Queue/Outbox | Legacy INTERVIEW, queued reminder | PostgreSQL + Worker Test Harness | `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase28-recruiting-migration-postgres.test.ts tests/integration/recruiting/recruiting-worker-postgres.test.ts` | Orphans 0; doppelte Fachwirkung 0; Poison nach Retrybudget genau 1 DLQ | Migration-/Workerreport | DB + Ops Owner | PLANNED |
| AC-28-08 | P0 falls aktiviert | Browser/A11y | komplette 28A- und 28B-Reise | Hauptaufgaben abschliessbar | locked/error/conflict/expired/cancelled und fremde URL sicher | Candidate, Employer, Recruiter | Candidate/Employer | alle Zustände, 320/360/Desktop | Chromium; Phase 29 zusätzlich 3 Engines/AT | `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase28-external-tracker.spec.ts tests/e2e/flows/phase28-interview-scheduler.spec.ts --project=chromium-journeys && npx playwright test --config=playwright.config.ts tests/e2e/quality/phase28-recruiting-mobile.spec.ts --project=chromium-mobile-360` | Retry 0; 0 critical/serious Axe; keine versteckte Hauptaktion | Playwright HTML + Screens | QA/A11y Owner | PLANNED |
| AC-28-01–08 | G3 | Vollregression | technischer Trackabschluss | alle owning + globale Gates grün | Skip/Retry/anderer Commit macht Gate rot | Engineering/Ops | gesamtes Repository | isolierte DB/Fixtures | CI/PostgreSQL 16 | `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e:http && npm run test:e2e:browser` | Exit 0; Fail/Skip/Retry 0; exakt ein Zielcommit | Phase-28-Evidence | Release Owner | PLANNED |

### 22. Performance- und Skalierungsgrenzen

- Trackerlisten p95 ≤ 300 ms bei 10.000 owner-scoped Events; kein unbounded
  Timeline-Read.
- Scheduler-Command p95 ≤ 500 ms ohne Providerdelivery; Reminderclaim bleibt
  bounded und besitzt Backpressure.
- Maximal 20 offene Vorschläge pro Interview und versionierte
  Teilnehmer-/Textlimits; Kalenderpayload unter freigegebenem Limit.
- Demand-Go enthält erwartete Nutzung und Supportminuten; ohne Budget kein
  Allowlist-Rollout.

### 23. Geschützte Phase-01–18-Invarianten

Interne Application Exactly-once, Job-/Company-Snapshot, Withdraw, Pipeline,
Conversation, Candidate-/Company-Tenant-404, Notification/Audit-Redaction und
Radar-Reveal bleiben grün. Owning-Suites: `tests/integration/candidate/*`,
`tests/integration/employer/applications-postgres.test.ts`,
`phase17-journeys.spec.ts` und Security-/Privacy-Suites.

### 24. Rollback / Roll-forward

Additive Modelle bleiben lesbar. Ein Kill Switch stoppt neue Tracker-/Scheduler-
Mutationen, lässt bestehende Termine stornieren/exportieren und löscht keine
Historie. Nach extern versandter ICS gilt Roll-forward/Cancel statt
„ungeschehen“. Contracting erst nach Restore- und N-1-Reader-Gate.

### 25. Evidence

Demand-Protokoll, Start-/Zielcommit, Migrationcounts, State-Machine-Golden,
Rollen-/Tenantmatrix, Worker-/DLQ-Report, ICS-Artefakte ohne PII, Privacy-
Vollständigkeit, Playwright/A11y/Mobile, Flags, Providerstatus und Go/No-go je
Track.

### 26. Definition of Done

Ein Track ist technisch fertig, wenn AC-28-01–08, Migration, G3 und sein
vollständiger E2E auf demselben Commit grün sind. LIVE ist er erst nach
Demand-, Privacy-, Ops-, Support- und gegebenenfalls Providerfreigabe.
Die Gesamtphase bleibt offen, solange ein Track nur geplant oder deferred ist;
deferred ist kein Defekt, wenn sämtliche Oberflächen fail-closed sind.

### 27. Folgephasen-Gate

Phase 29B übernimmt nur aktivierte 28-Tracks in ihre finale UX-Matrix. Phase 31
darf keinen Tracker/Scheduler verkaufen, bevor dessen Track LIVE-freigegeben
ist. Phase 32 verlangt Phase 28 nur für Launchklassen, deren Angebot oder Copy
28A beziehungsweise 28B ausdrücklich verspricht.

### 28. Ausdrücklich nicht bewiesen

Diese Phase beweist keine ATS-Zustellung, keinen Arbeitgeber-bestätigten
externen Outcome, keine höhere Bewerbungsquote, keinen Bedarf für einen
Vollscheduler, keine Calendar-/ATS-Providerreife und keine automatische
Einstellungsentscheidung. Ein grüner optionaler Track macht interne
Applications nicht „realer“ und beweist keinen Product-Market-Fit.
