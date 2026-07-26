# Phase 28 — Vollständige Recruiting-Workflows

> **Status: GEPLANT / NICHT BEGONNEN.** Interne Bewerbungen und ihre Pipeline
> sind belastbar; externe Bewerbungen enden nach Klick und `INTERVIEW` ist nur
> ein Status ohne Terminobjekt.

## Ziel

Die Kandidatenreise von interner oder externer Bewerbung bis Interview,
Entscheidung, Wiedervorlage und Archiv vollständig nachvollziehbar machen.

## Ausgangslage und Problem-IDs

- `STH-015`: externer Weg persistiert nur `EXTERNAL_APPLY_CLICKED`.
- `STH-016`: kein Interview, Slot, Teilnehmer, Zeitzone, RSVP, ICS, Reminder
  oder Reschedule; `SCHEDULED_INTERVIEW` ist dormant.
- Interne Application-, Conversation-, Snapshot-, Status- und Tenant-Grenzen
  bleiben maßgeblich.

## In Scope

- Kandidateneigener externer Bewerbungs-Tracker: begonnen, eingereicht,
  Interview, Angebot, Absage, eingestellt, zurückgezogen/archiviert.
- Click ist niemals automatisch Submitted.
- Job-/Unternehmenssnapshot und Resume nach unauthentifiziertem Klick.
- Interview Entity, Terminvorschläge, Zeitzone, Teilnehmer und RSVP.
- Accept/Decline/Reschedule/Cancel, ICS und Reminder.
- Vollständige Timeline, Templates, Follow-ups und Wiedervorlagen.
- Arbeitgeber-Talent-Pool/Archiv nur mit klarer Rechtsgrundlage, Consent und
  Retention; gegebenenfalls als separat gegatetes Teilpaket.
- ATS-/E-Mail-Synchronisierung nur als spätere Adaptergrenze.

## Out of Scope

- Scraping externer ATS-Portale oder Lesen privater Mailboxen ohne Freigabe.
- Click als Conversion/Hire behaupten.
- Generischer Kalender-/ATS-Ersatz, Video-Meeting-Hosting oder automatische
  Auswahl/Ablehnung.
- Employer-Ranking nach Candidate Match Score.

## Rollen und Prozesse

Candidate besitzt externen Tracker und RSVP. Employer Owner/Admin/zugewiesener
Recruiter verwaltet interne Interviews. Viewer ist read-only nach Policy.
System sendet Reminder. Support/Admin hat keinen pauschalen Zugriff auf
Kandidatennotizen oder Interviewdetails.

## Betroffene Dateien und Module

- `lib/applications/**`, `lib/employer/applications.ts`
- Public apply Actions, Candidate Applications/Dashboard/Timeline
- Employer Applicant Detail/Pipeline/Actions
- Conversations, Notifications/Outbox, Worker
- `prisma/schema.prisma`, Migrationen, Templates, Seeds und E2E
- optional Calendar/ATS Provider Ports

## Datenmodelländerungen

ExternalApplicationTracker mit immutable JobSnapshot und append-only Events;
Interview, Slot/Proposal, Participant/RSVP, Reminder/Delivery und Calendar
Artifact. Interne Application Status und Interview Lifecycle werden getrennt,
aber konsistent verknüpft. Alle Mutationen tragen Version/IdempotencyKey.
Jedes neue personenbezogene Feld wird zugleich in das zentrale
Dateninventar sowie die EXPORT-/DELETE-/CORRECT-/Retention-/Legal-Hold-
Verträge aus Phase 22 aufgenommen; ICS-/Reminder-Artefakte und Snapshots sind
dabei ausdrücklich eingeschlossen.

## Sicherheits- und Datenschutzfolgen

- External Tracker ist candidate-owned; Employer sieht ihn nicht ohne echte
  Integrations-/Consentgrundlage.
- Interviewzugriff ist tenant-, assignment- und participant-scoped.
- ICS enthält nur nötige Felder und keine privaten Notes.
- Reminder folgt Preferences/Pflichtmatrix; Timeline und Audit redigieren PII.
- Talent Pool benötigt Zweck, Ablauf, Widerruf und dokumentierte Rechtsbasis.

## Migrationsstrategie

- [ ] Additive Tracker-/Interview-/Eventmodelle.
- [ ] `SCHEDULED_INTERVIEW` Legacy-Enum nicht als erfüllten Termin backfillen.
- [ ] Bestehende `INTERVIEW` Applications bleiben Status-only/Legacy, bis
  explizit ein Termin ergänzt wird.
- [ ] Feature Flags getrennt für Tracker, Scheduler und ATS Adapter.
- [ ] Keine bestehende Application-ID oder Snapshot-Historie ändern.

## Implementierungsschritte

- [ ] Status-/Timeline-/Ownership-ADR für externen Tracker und Interview.
- [ ] Schema/Constraints/Indizes/Events migrieren.
- [ ] External Click → Resume → candidate-confirmed Submission.
- [ ] Candidate Tracker CRUD/Transitions/Reminder/Archive.
- [ ] Employer Slot Proposal und Candidate RSVP.
- [ ] Reschedule/Cancel/Concurrency/Timezone und ICS.
- [ ] Worker Reminder und Outbox-Templates.
- [ ] Timeline, Follow-up und optional gegateter Talent Pool.
- [ ] Adapter Ports für Calendar/ATS definieren, Realadapter nicht vortäuschen.
- [ ] Cross-role-/Cross-tenant-/DST-/E2E-Gates.

## Abhängigkeiten

Phasen 20, 21, 22, 23 und 25; Phase 27 falls Multi-Persona vorab freigegeben
ist. Calendar-/ATS-Vendor ist für den internen ICS-Kern nicht zwingend.

## Risiken und Regressionen

- Tracker suggeriert externen Submission-Nachweis ohne Evidence.
- Status und Termin werden unzulässig gekoppelt.
- DST/Zeitzonen und parallele Reschedules erzeugen doppelte Termine.
- Employer sieht fremde Candidate-/Company-Daten.
- Bestehende Application Exactly-once, Snapshot und Conversation bleiben grün.

## Abwärtskompatibilität und Rollback

Neue Modelle sind additiv. Bestehende Pipeline funktioniert ohne Scheduler
weiter. Feature Gate kann neue Vorschläge pausieren; bestehende Termine bleiben
sichtbar und stornierbar. ICS-/Reminderadapter kann auf `PAUSED` wechseln, nicht
still Mock-Versand behaupten.

## Akzeptanzkriterien und Tests

### Unit

- [ ] External Tracker und Interview State Machines.
- [ ] Click≠Submitted, Snapshot und Timeline-Copy.
- [ ] Zeitzone/DST/ICS Golden Files und Preference-Regeln.

### PostgreSQL / Integration

- [ ] Owner/Tenant/Assignment/Participant-Matrix.
- [ ] Idempotent submit/propose/accept/decline/reschedule/cancel.
- [ ] parallele RSVP/Reschedule, Reminder-Dedupe und Worker Retry.
- [ ] Job expiry/deactivation ändert historischen Snapshot nicht.
- [ ] Candidate/Employer Notes und Privacy/Retention bleiben getrennt.
- [ ] Export enthält alle erlaubten Tracker-/Interview-/Participant-/ICS-/
  Reminder-/Snapshot-Daten; Delete/Correct/Retention/Hold wirken nach der
  Phase-22-Matrix und schliessen fremde Tenant-/Candidate-Canaries aus.

### E2E und manuell

- [ ] externer Klick → Candidate bestätigt → Dashboard → Status/Archiv.
- [ ] Employer schlägt Slots → Candidate akzeptiert → beide Timeline/ICS.
- [ ] Decline/Reschedule/Cancel/Reminder/Providerausfall.
- [ ] Candidate, Employer, Recruiter auf Desktop/360 px, Keyboard/Screenreader.

## Evidence und Definition of Done

- [ ] Externe Bewerbungen können ehrlich candidate-owned verfolgt werden.
- [ ] Click wird nie als Submission oder Hire gezählt.
- [ ] Interview besitzt persistierten Termin-/RSVP-/Reschedule-Lifecycle.
- [ ] ICS und Reminder sind idempotent, preference- und workergebunden.
- [ ] Tenant/Assignment/Participant/Privacy-Grenzen sind vollständig belegt.
- [ ] Loading-, Empty-, Locked-, Error-, Retry-, Conflict-, Cancelled- und
  Success-Zustände sind für beide Seiten auf Desktop und Mobile umgesetzt.
- [ ] Alle Unit-/DB-/Integration-/E2E-/Mobile-/A11y-Gates sind grün.

## Offene externe Voraussetzungen

Calendar-/ATS-Integration, Datenverträge und Talent-Pool-Rechtsgrundlage sind
optional spätere Gates. Der interne Scheduler darf ohne sie vollständig
funktionieren.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Schließt die Recruiting-Blackbox nach Apply und bringt Interviews in den Workflow. |
| Problem-IDs | STH-015, STH-016. |
| Prerequisites | 20, 21, 22, 23, 25; optional 27. |
| Deliverables | Externer Tracker, Interview/Slots/RSVP/ICS/Reminder, Timeline. |
| Security / Privacy | Candidate ownership, tenant/assignment scope, minimale ICS sowie Phase-22-Export/Delete/Correct/Retention/Hold. |
| Tests | Click semantics, concurrency, DST, cross-role, Privacy-Lifecycle und full recruiter/candidate E2E. |
| Expected Result | Bewerbung bis Interview/Outcome bleibt nachvollziehbar. |
| Risks / Limits | ATS/Calendar-Sync ist separat; keine automatische Auswahl. |
