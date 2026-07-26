# Phase 21 — Reales Dokumenten- und CV-Vault

> **Status: GEPLANT / NICHT BEGONNEN.** Der aktuelle Storage-Adapter speichert
> absichtlich nur Metadaten und erzeugt keinen Download.

## Ziel

CVs und spätere Bewerbungsdokumente als echte, private, geprüfte und
versionierte Dateien übertragen, speichern, freigeben und löschen, ohne die
bestehenden Bewerbungs-Snapshots oder Radar-Privacy zu beschädigen.

## Ausgangslage und Problem-IDs

- `STH-003` bestätigt: JobPass sendet Dateiname, MIME und Größe, keine Bytes.
- `STH-004` (Storage-Anteil) bestätigt: Composition Root ist fest Mock.
- `CandidateDocumentMetadata` und `ApplicationSubmissionDocument` sind eine
  gute Metadaten-/Snapshot-Basis, aber kein Dokument-Vault.

## In Scope

- Private Object-Storage-Region und DPA.
- Serverseitig autorisierte Upload-Sessions und begrenztes Streaming.
- Dateigröße, Extension, MIME, Magic Bytes und Inhaltsprüfung.
- Malware-Quarantäne, Scanstatus, Retry und sichere Ablehnung.
- Verschlüsselung at rest/in transit, Keyrotation und Objektversionen.
- Immutable Bewerbungsreferenz auf exakt die eingereichte Dokumentversion.
- Kurzlebige, single-purpose Downloadberechtigung nach Owner/Tenant/Assignment.
- Zugriffsaudit sowie stabile Object-/Version-/Delete-/Export-Hooks für die
  zentrale Retention-, Legal-Hold-, Export- und Erasure-Policy aus Phase 22.
- Candidate-, Employer-/Recruiter-, Privacy- und Ops-UX einschließlich
  Pending/Infected/Failed/Expired/Deleted.

## Out of Scope

- Öffentliche CV-URLs, globale Employer-Bibliothek oder Radar-Download.
- OCR, automatische CV-Bewertung oder employerseitiges Ranking.
- Beliebige Dateitypen, ZIP-Archive oder clientseitige Malwareaussagen.
- Firmenverifikationsdokumente; sie können denselben Vault erst in Phase 26
  mit eigenem Purpose nutzen.

## Rollen und Prozesse

Candidate besitzt Upload und aktive Profilversion. Employer/Recruiter darf nur
die immutable Version einer berechtigten internen Bewerbung lesen. Privacy
Admin steuert Export/Erasure nach Policy; Ops sieht technische Zustände, nicht
Dokumentinhalt. Radar Reveal erteilt niemals automatisch Downloadrechte.

## Betroffene Dateien und Module

- `lib/providers/storage/**`, `lib/candidate/profile.ts`,
  `app/candidate/jobpass/**`, `components/candidate/JobPassForm.tsx`
- `lib/applications/**`, `app/employer/applicants/**`
- `lib/security/authorized-repositories.ts`, Audit/Notification/Outbox
- `lib/privacy/**`, Worker aus Phase 23
- `prisma/schema.prisma`, additive Migrationen, Seed und Testfixtures

## Datenmodelländerungen

Mindestens: Upload Session, immutable Document Object/Version, Scan Attempt,
Access Grant oder Download Audit, fachliche Purpose-Bindung und referenzierbare
Object-Lifecycle-Outcomes. Phase 21 führt keine konkurrierende
Retention-/Legal-Hold-/Erasure-Zustandsmaschine ein; deren einzige fachliche
Autorität ist Phase 22. Storage-Key bleibt opaque und wird nie als URL gerendert.
`ApplicationSubmissionDocument` referenziert die unveränderliche ObjectVersion
und behält die bisherigen Hash-/Metadatensnapshots.

## Sicherheits- und Datenschutzfolgen

- Untrusted Bytes werden nie vom App-Server ausgeführt oder öffentlich
  ausgeliefert.
- Download verlangt bei jeder Ausstellung und beim Abruf aktuelle
  Autorisierung; URL ist kurzlebig, audience-/purpose-gebunden und no-store.
- Scan `PENDING|INFECTED|FAILED` ist niemals downloadbar.
- Logs enthalten keine Dateinamen, Inhalte, signed URLs oder Storage-Secrets.
- Storage-Retention und DB-Referenzen werden koordiniert; keine orphaned
  personenbezogenen Objekte.

## Migrationsstrategie

- [ ] Additive Modelle/Constraints und Purpose-Enum einführen.
- [ ] Legacy-Metadaten als `METADATA_ONLY_LEGACY` markieren; keine fiktiven
  Bytes oder erfolgreichen Scans erzeugen.
- [ ] Dual Read zeigt Legacy ehrlich als nicht downloadbar.
- [ ] Neue Uploads nur hinter serverseitigem Feature Gate zulassen.
- [ ] Backfill-/Cleanup-Worker dry-run-fähig und auditiert entwickeln.

## Implementierungsschritte

- [ ] Storage-/Scanner-Threat-Model und ADR mit Region, DPA und Limits.
- [ ] Provider-Port um Upload Session, Object Version, Read Grant und Delete
  erweitern; Mockvertrag weiterhin separat erhalten.
- [ ] Schema/Migration/Constraints für State Machine und Immutability.
- [ ] Upload init/complete/abort mit Owner-, Size- und checksum-Bindung.
- [ ] Magic-Byte-/MIME-Validierung und Quarantäne-Scanner asynchron integrieren.
- [ ] JobPass UX mit echter Progress-, Retry- und Scanstatusanzeige.
- [ ] Application Submit blockiert ungeprüfte Dokumente und snapshottet exakt
  die freigegebene Version atomar.
- [ ] Employer Download Repository tenant-/assignment-scoped anbinden.
- [ ] Byte-/Manifest-Export, Object Delete/Anonymize, Hold-Abfrage und Access
  Audit als idempotente Adapter-Hooks bereitstellen; Policy, Orchestrierung und
  Rechtszustände bleiben Eigentum von Phase 22.
- [ ] Storage-Degradation, Cleanup und Incident-Runbook ergänzen.

## Abhängigkeiten

Phase 19; Outbox/Identity aus Phase 20 sowie Vendor/DPA/KMS/Scanner. Phase 21
schliesst Storage-/Scan-/Object-Handler und Sandbox-Contracttests. Die
zentrale Privacy-Policy aus Phase 22 sowie autonome Worker/Monitoring aus
Phase 23 sind Aktivierungs- und Integrations-Gates für den Vollbetrieb, keine
Rückwärtsabhängigkeiten des Vault-Grundvertrags.

## Risiken und Regressionen

- Neue Uploadfläche für Malware, Zip Bombs, Polyglots und Kostenmissbrauch.
- Cross-Tenant-IDOR oder geleakte Signed URL.
- Profiländerung darf historische Bewerbung nicht umschreiben.
- Erasure darf gesetzlich gebundene Bewerbung nicht unkontrolliert löschen.
- Metadaten-Mock-Tests bleiben als expliziter Demo-Vertrag erhalten.

## Abwärtskompatibilität und Rollback

Additive Migration, Legacy-Read bleibt möglich. Feature Gate kann neue Uploads
pausieren, bestehende saubere Dokumente aber weiter autorisiert bereitstellen.
Rollback löscht keine Objekte automatisch. Providerwechsel benötigt
manifestierte Objektmigration und Checksums.

## Akzeptanzkriterien und Tests

### Unit

- [ ] MIME/Magic/Extension/Size/Checksum-Matrix.
- [ ] Upload-/Scan-/Retention-State Machine und signed URL policy.
- [ ] Safe DTO enthält keinen Key oder Providerdetail.

### PostgreSQL / Integration

- [ ] Owner-/Tenant-/Assignment-/Privacy-Capability-Matrix.
- [ ] Paralleles Complete/Abort/Scan, idempotente Retries und immutable
  Submission-Version.
- [ ] Infected/failed/pending nie downloadbar.
- [ ] Access Audit sowie idempotente Byte-/Manifest-Export-, Hold-Abfrage- und
  Object-Delete-Outcomes; Phase-22-Orchestrierung wird dort vertikal getestet.
- [ ] Orphan- und Race-Reconciliation.

### E2E und manuell

- [ ] Candidate Upload → Scan → Apply → autorisierter Employer Download.
- [ ] Profil-CV ersetzen; alte Bewerbung behält zulässige alte Version.
- [ ] Foreign Employer/Recruiter, abgelaufene URL und suspendierter User.
- [ ] 360-px Progress/Retry/Fehlerzustände, Keyboard und Screenreader.
- [ ] Sandbox-Scanner- und Storage-Ausfall.

## Evidence und Definition of Done

- [ ] Reale Bytes existieren nur im privaten freigegebenen Storage.
- [ ] Jeder Download ist kurzlebig, autorisiert und auditiert.
- [ ] Keine ungeprüfte Datei wird als verfügbar dargestellt.
- [ ] Submission-Snapshot bleibt unveränderlich.
- [ ] Export-/Delete-/Hold-/Retention-Adapter-Hooks sind vollständig und
  fail-closed geprüft; die vertikale Rechts-/Privacy-Orchestrierung bleibt
  Phase 22.
- [ ] Loading-, Empty-, Error-, Locked-, Quarantine-, Retry-, Conflict- und
  Success-Zustände sind in Candidate- und Employer-UX vollständig.
- [ ] Unit, Integration, DB, E2E, Mobile, A11y und Provider-Sandbox sind grün.
- [ ] Evidence nennt Vendor-/DPA-/Region-/Scannerstatus ehrlich.

## Offene externe Voraussetzungen

Storage-/Scannervertrag, DPA, Datenregion, KMS, Kostenlimits, Retention- und
Legal-Freigabe. Ohne diese bleibt Realmodus geschlossen.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Macht interne Bewerbungen mit CV operativ nutzbar. |
| Problem-IDs | STH-003; Storage-Anteil STH-004. |
| Prerequisites | 19, 20; Storage/Scanner/DPA; 22/23 für Vollbetrieb. |
| Deliverables | Private Uploads, Scan, Versionen, Downloads, Audit und Lifecycle. |
| Security / Privacy | Quarantäne, least-privilege Download, keine öffentlichen Keys, Erasure/hold. |
| Tests | Hostile files, concurrency, cross-tenant, immutable submission, E2E. |
| Expected Result | Echte Datei statt Metadatenattrappe. |
| Risks / Limits | OCR/AI und öffentliche CV-Suche bleiben ausgeschlossen. |
