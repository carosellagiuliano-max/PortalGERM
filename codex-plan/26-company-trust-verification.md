# Phase 26 — Firmen-Trust und belastbare Verifizierung

> **Status: GEPLANT / NICHT BEGONNEN.** Der bestehende Lifecycle ist
> transaktional und auditiert, die Evidence besteht jedoch aus einer
> Beschreibung und freien Referenz. Das öffentliche Badge darf nicht mehr
> Sicherheit behaupten als technisch geprüft wurde.

## Ziel

Firmenidentität und Verifizierungsumfang mit strukturierten, nachvollziehbaren,
ablaufenden Nachweisen belegen und die daraus abhängigen Job-/Radar-Gates
fail-closed halten.

## Ausgangslage und Problem-ID

- `STH-014` bestätigt: UID und Registrierungsdomain existieren als Signale,
  aber weder Registerabgleich noch Domain-Challenge, Vault-Dokument,
  Ablauf/Re-review oder strukturierter Nachweis.
- Bestehende Submit/Review/Verify/Reject/Revoke-, Lock-, Supersession-,
  Notification- und Radar-Widerrufsketten werden erhalten.

## In Scope

- Evidence-Typen `UID_REGISTER`, `DOMAIN_CHALLENGE`, `DOCUMENT`,
  `MANUAL_EXCEPTION` oder fachlich äquivalente Versionen.
- UID-/Registerabgleich mit Quelle, Zeit, Ergebnis und redigiertem Digest.
- Domain-Control-Challenge mit Ablauf, Bindung und Domainwechsel.
- Optionales Nachweisdokument über den Vault aus Phase 21.
- Risk Level, `verifiedAt`, `expiresAt`, Re-review und Revocation.
- Legacy-Policy für bestehende textuell `VERIFIED` Firmen.
- Präzise Public-Badge-Semantik: Methode/Umfang/Datum ohne private Evidence.
- Admin Least Privilege/Step-up und gegebenenfalls Vier-Augen-Ausnahme.

## Out of Scope

- Behauptung, Zefix/UID oder ein Provider sei freigegeben, bevor Vertrag und
  Nutzungsbedingungen geklärt sind.
- Öffentliche Verifikationsdokumente oder interne Reviewer-Notizen.
- Multi-Persona-Identity, ATS-Import oder generisches KYC.
- Automatisches Publish allein wegen einer schwachen Legacy-Evidence.

## Rollen und Prozesse

Company Owner/Admin beantragt; Recruiter/Viewer nicht. Trust/Moderation Admin
prüft mit begrenzter Capability und Step-up. System revalidiert/expiriert.
Public sieht nur sicheren Scope. Candidate profitiert über Job- und Radar-Trust.

## Betroffene Dateien und Module

- `lib/employer/company.ts`, `components/employer/verification-panel.tsx`
- `lib/admin/companies.ts`, Admin Company Detail/Queue
- `lib/companies/public-read-model.ts`, Public Company UI
- `lib/jobs/public-eligibility.ts`, `lib/talentradar/**`
- Email/Outbox, Worker, Document Vault und Audit
- `prisma/schema.prisma`, Migrationen, Seeds und Tests

## Datenmodelländerungen

Versionierte Verification Evidence/Check/Challenge mit Provider/Source,
normalized identifier, response digest, validity, risk and status; referenziertes
Document Purpose; Decision/Exception Approval. Bestehende Request/Event-Modelle
bleiben Autorität für Lifecycle und werden additiv verknüpft.

## Sicherheits- und Datenschutzfolgen

- Providerantworten und Dokumente sind private Evidence, keine Public DTOs.
- Domain-Challenge-Token gehasht, kurzlebig und company-bound.
- Register-/Domainausfall führt nicht zu stiller Verifizierung.
- Manuelle Ausnahme ist zeitlich begrenzt, begründet, auditiert und je Risiko
  mit separatem Approver.
- Ablauf/Revoke entfernt Badge sowie Job-/Radar-Eligibility atomar oder über
  nachweislich fail-closed Reads.

## Migrationsstrategie

- [ ] Additive Evidence-/Challenge-/Validity-Modelle.
- [ ] Bestehende `VERIFIED` Zyklen als `LEGACY_MANUAL` klassifizieren.
- [ ] Kein Legacy-Backfill auf starke UID-/Domain-Verifikation.
- [ ] Public Copy und Eligibility per Policy-Version migrieren.
- [ ] Eine abwärtskompatible Trust-Projektion stellt sicher, dass N-1-App und
  N-1-Worker abgelaufene, widerrufene oder scoped Evidence niemals als
  unbeschränkt `VERIFIED` lesen; falls das nicht beweisbar ist, ist ein
  Binary-Rollback nach Cutover verboten und nur Roll-forward zulässig.
- [ ] Re-review in kontrollierten Kohorten; vorher kein stilles Downgrade,
  aber klare Legacy-Kennzeichnung.

## Implementierungsschritte

- [ ] Trust-Level-, Provider-, Badge- und Legacy-ADR freigeben.
- [ ] Register-/Domain-/Document-Evidence-Schema migrieren.
- [ ] Domain Challenge und UID/Registeradapter fail-closed implementieren.
- [ ] Document-Vault-Purpose für Verification anbinden.
- [ ] Review/Exception/Expiry/Re-review Commands mit Capability/Step-up.
- [ ] Public DTO/Badge und Job-/Radar-Eligibility auf Policy-Version umstellen.
- [ ] Worker für Ablauf/Re-review und Notifications registrieren.
- [ ] Legacy-Migration und Operator-Queue mit SLA.
- [ ] Provider-, mismatch-, timeout-, fraud- und revocation-E2Es.

## Abhängigkeiten

Phasen 20, 21, 23 und 25; Register-/Domainprovider und Nutzungsrecht; Legal/
Privacy/Retention; benannte Trust Owner.

## Risiken und Regressionen

- Öffentliches Badge übertreibt Prüfumfang.
- Falscher Ablauf versteckt Jobs/Radar unerwartet.
- Legacy-Firmen erhalten unverdient starken Status oder werden ohne Plan
  ausgesperrt.
- Domainbesitz beweist nicht automatisch juristische Vertretungsbefugnis.
- Bestehende Company Claim, Team, Job Publish und Radar Eligibility bleiben
  durch Owning-Tests geschützt.

## Abwärtskompatibilität und Rollback

Policy-Versionen, Legacy-Level und eine Compatibility-Projection erlauben den
kontrollierten Rückweg nur, wenn N-1-Binaries Expiry, Scope und Revoke
fail-closed verstehen. Andernfalls ist der dokumentierte Rückweg ein
Roll-forward mit pausiertem Provider und deaktivierter Badge-/Eligibility-
Aktivierung; ein altes Binary darf nach Cutover nicht gestartet werden.
Realprovider kann pausiert werden; neue Verifizierungen bleiben dann `PENDING`,
nicht automatisch `VERIFIED`. Evidence wird bei Rollback nicht gelöscht.

## Akzeptanzkriterien und Tests

### Unit / Provider

- [ ] UID exact/not found/mismatch/timeout/malformed.
- [ ] Domain correct/wrong/expired/replay/domain change.
- [ ] Badgeprojektion je Evidence-Level ohne private Felder.

### PostgreSQL / Integration

- [ ] kein starker VERIFIED-Status ohne gültige Evidence.
- [ ] Owner/Admin submit; Recruiter/Viewer/fremde Firma denied.
- [ ] Reviewer Capability/Step-up/Actor Separation.
- [ ] Supersession, Concurrency, Expiry, Re-review und Revoke.
- [ ] Job-/Radar-/Reveal-Eligibility verliert Zugriff fail-closed.
- [ ] Legacy-Migration bleibt ehrlich.
- [ ] N-1-App-/Worker-Kompatibilität oder expliziter Roll-forward-only-Guard;
  Providerpause und Expiry/Revoke bleiben im Rollbackdrill fail-closed.

### E2E und manuell

- [ ] Company → Domain/Register/Document → Review → Public Badge.
- [ ] Mismatch/Changes Requested/Expiry/Revoke.
- [ ] Public, Employer und Admin auf Desktop/360 px, Keyboard/Screenreader.
- [ ] Providerausfall und Incident-/Manual-Exception-Drill.

## Evidence und Definition of Done

- [ ] Jeder öffentliche Verifizierungsstatus besitzt gültige strukturierte
  Evidence und verständliche Scope-Copy.
- [ ] Legacy-Textnachweise sind nicht still als stark verifiziert klassifiziert.
- [ ] Ablauf/Revoke schützt Public Jobs und Talent Radar.
- [ ] Reviewer ist least-privilege und step-up-gesichert.
- [ ] Loading-, Empty-, Pending-, Locked-, Error-, Retry-, Conflict-, Expired-,
  Revoked- und Success-Zustände sind verständlich und policytreu umgesetzt.
- [ ] Provider-/Mismatch-/Failure-/Cross-Tenant-/E2E-Gates sind grün.
- [ ] Externe Register-/Legal-Freigabe ist im Evidence-Record benannt.

## Offene externe Voraussetzungen

UID/Zefix- oder Registerzugang/Nutzungsbedingungen, Domain-/Mailinfrastruktur,
Document-Vault, DPA, Trust Policy und externe Legal-/Fraud-Bewertung.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Glaubwürdige Arbeitgeber und belastbares öffentliches Trust-Signal. |
| Problem-ID | STH-014. |
| Prerequisites | 20, 21, 23, 25 und externe Register-/Legal-Gates. |
| Deliverables | Strukturierte Evidence, Challenge/Register, expiry/re-review, präzises Badge. |
| Security / Privacy | Private Evidence, least-privilege Review, fail-closed Eligibility. |
| Tests | Provider mismatch/failure, roles, legacy, expiry/revoke, Public/Radar E2E. |
| Expected Result | „Verifiziert“ bedeutet einen klar benannten tatsächlich geprüften Umfang. |
| Risks / Limits | Domainkontrolle allein ist kein Handelsregister-/Vertretungsnachweis. |
