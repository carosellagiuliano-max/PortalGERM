# Phase 20 — Identität, E-Mail und zuverlässige Benachrichtigungen

> **Status: GEPLANT / NICHT BEGONNEN.** Kein produktiver E-Mail-Provider,
> Verifizierungs-Lifecycle oder Outbox-Worker ist derzeit implementiert.

## Ziel

Eine verlässliche Identity- und Delivery-Kette schaffen: neue Konten
verifizieren, transaktionale Benachrichtigungen dauerhaft zustellen und
optionale Kommunikation zentral steuerbar machen, ohne Pflichtnachrichten oder
Privacy-Grenzen zu schwächen.

## Ausgangslage und bestätigte Probleme

- `STH-001`: Candidate-, Employer- und Einladungsregistrierungen stellen sofort
  eine Session aus; ein E-Mail-Verifizierungsweg fehlt.
- `STH-002`: Privacy Identity Challenge verlangt `emailVerifiedAt`, regulär neu
  registrierte Nutzer können diesen Zustand nicht erreichen.
- `STH-013`: Domainwrites und E-Mail sind nicht über eine transaktionale Outbox
  verbunden; nach Providerfehler gibt es keine garantierte Wiederholung.
- `STH-026`: Es existiert kein zentrales Preference Center.
- `STH-004` (E-Mail-Anteil): Composition Root ist fest auf Mock gestellt;
  Provider-Env muss derzeit leer bleiben.

## In Scope

- Gehashte, zeitlich begrenzte, einmalige E-Mail-Verifikation mit Resend.
- E-Mail-Adresswechsel mit Address-Epoch/Snapshot, Invalidierung alter Tokens,
  Reverification und definierter Session-/Capability-Wirkung.
- Abstufung zulässiger Aktionen für unverifizierte Konten; kein clientseitiges
  Gating als Sicherheitsgrenze.
- Candidate-, Employer- und Invitation-Registrierung sowie bestehende Nutzer.
- Transactional Outbox, Delivery Attempts, Lease, Retry/Backoff, DLQ und Replay.
- Freigegebener realer E-Mail-Adapter, Sandbox und fail-closed Composition Root.
- Bounces, Suppression, Zustellstatus, Redaction und Provider-Dedupe.
- Preference Center für Kanal/Frequenz/optionale Zwecke; Pflichtkommunikation
  bleibt technisch und rechtlich getrennt.
- Vollständiges repositoryweites Inventar aller E-Mail-Callsites und
  Templates. Jeder produktive Pfad – einschliesslich Auth, Invitations,
  Applications, Messages, Billing/Boosts, Privacy, Radar, Abuse, Moderation,
  Leads und Commercial Signals – wird atomarer Outbox-Produzent oder im
  Realmodus explizit deaktiviert.

## Out of Scope

- Multi-Persona-Umbau (Phase 27).
- Admin-MFA/Step-up (Phase 25).
- SMS/Push als produktive Kanäle.
- Marketing-Automation, Referral und Newsletter.
- Abschwächung der bestehenden Privacy-Challenge.

## Rollen und Prozesse

Public registriert; Candidate, Employer und Recruiter verifizieren und verwalten
Präferenzen; Support/Ops untersucht DLQ ohne Payload-PII; Privacy/Finance können
Pflichtzustellungen auslösen, aber nicht als Marketing deklarieren.

## Betroffene Dateien und Module

- `lib/auth/auth-service.ts`, `lib/auth/current-user.ts`,
  `lib/auth/route-guards.ts`, `lib/employer/team.ts`
- `app/(auth)/**`, `components/auth/**`, private Layouts/Navigation
- `lib/providers/email/**`, `lib/notifications/**`,
  `lib/applications/service.ts`, `lib/candidate/job-alerts.ts`
- `prisma/schema.prisma`, additive Migrationen und Seeds
- `app/admin/system/**` oder ein capability-geschütztes Delivery-Cockpit
- Auth-, Notification-, Provider-, Privacy- und E2E-Tests

## Datenmodelländerungen

Die endgültigen Namen werden in einem ADR fixiert; mindestens werden benötigt:

- Verification Token/Challenge mit `tokenHash`, `expiresAt`, `usedAt`,
  `supersededAt`, gebundener E-Mail-/Address-Epoch, Purpose und
  Rate-/Auditkontext;
- Outbox Message mit stabiler fachlicher Dedupe-ID, Template-/Schema-Version,
  Empfängerreferenz, verfügbar ab, Lease, Attempts und Terminalstatus;
- envelope-verschlüsseltes, kurzlebiges Delivery-Material mit Key-Version, wenn
  ein nach Restart identischer Einmallink zugestellt werden muss; der
  fachliche Consume-Pfad vergleicht weiterhin ausschliesslich den Hash;
- append-only Delivery Attempt ohne unredigierte Providerpayloads;
- versionierte Notification Preference/Consent Events mit Zweck, Kanal und
  Frequenz;
- Bounce/Suppression-Evidence und capability-gebundene Replay-Audits.

Keine Provider-Message-ID wird zur fachlichen Autorität. `EmailLog` wird
kompatibel migriert oder als Zustellprojektion weitergeführt, nicht blind
ersetzt.

## Sicherheits- und Datenschutzfolgen

- Verifikationstokens werden fachlich nur gehasht geprüft und erscheinen
  niemals in Logs, DTOs oder Klartextspalten. Für crash-sichere Zustellung darf
  die Outbox ausschliesslich envelope-verschlüsseltes, kurzlebiges
  Delivery-Material beziehungsweise einen gleichwertig sicheren,
  nonce-gebundenen Rekonstruktionsvertrag speichern; Schlüsselrotation und
  kryptografische Löschung sind Teil des ADR.
- Generische Antworten für bekannte und unbekannte Adressen.
- Resend-, Verify- und Enumeration-Rate-Limits über PostgreSQL.
- Outbox enthält nur die minimal notwendige versionierte Payload; keine freien
  Domainobjekte, Passwörter, Klartexttokens oder Reveal-Ciphertexte.
- Unverifizierte Sessions besitzen serverseitig definierte Minimalrechte.
- Preference Center darf Security-, Privacy-, Vertrags- und
  Rechnungsnachrichten nicht deaktivieren.

## Migrationsstrategie

- [ ] Additive Tabellen/Enums/Indizes und Constraints einführen.
- [ ] Legacy-LIVE-User explizit klassifizieren; keine stille Massenverifikation.
- [ ] Bestehende DEMO/TEST-Fixtures deterministisch auf Verifizierungszustände
  erweitern.
- [ ] Alte synchrone Mailpfade hinter einem dual-read/dual-observe Gate
  schrittweise auf Outbox umstellen.
- [ ] Erst nach Backfill- und Replay-Evidence Legacy-Pfade entfernen.

## Implementierungsschritte

- [ ] ADR für Verifizierungs-, Outbox-, Provider- und Preference-Vertrag
  freigeben.
- [ ] Token-/Outbox-/Attempt-/Preference-Schema additiv migrieren.
- [ ] Verification Request, Resend, Consume und Sessionrotation implementieren.
- [ ] Adresswechsel mit Address-Epoch, Token-/Outbox-Supersession und
  Reverification implementieren; alte Links dürfen die neue Adresse nicht
  bestätigen.
- [ ] Serverseitige `verified-email-required`-Policy für sensible Aktionen
  definieren; Safe Next und Locked States ergänzen.
- [ ] Registrierung und Invitation atomar mit Verification-Outbox verbinden.
- [ ] Dispatcher mit Lease, Backoff, Max Attempts, DLQ und idempotentem Replay
  implementieren.
- [ ] Reale Provider-Composition nur mit explizitem Mode, Secret und
  erfolgreich validierter Konfiguration aktivieren; kein Fallback auf Mock.
- [ ] Alle E-Mail-Callsites/Templates inventarisieren und jeden Pfad atomar auf
  Outbox umstellen oder im Realmodus explizit fail-closed deaktivieren.
- [ ] Preference Center und Pflicht-/Optional-Taxonomie integrieren.
- [ ] Admin/Ops-Cockpit redigiert und auditiert anbinden; Replay/PII-Reads
  ausserhalb Sandbox bleiben bis zu den Grants und Step-up-Gates aus Phase 25
  fail-closed.
- [ ] Privacy Journey Registrierung → Verifizierung → Challenge beweisen.

## Abhängigkeiten

- Phase 19 abgeschlossen.
- E-Mail-Vendor, DPA, Absenderdomain, SPF/DKIM/DMARC und Secret-Management.
- Phase 20 schliesst Handler, Adaptervertrag und lokale/Sandbox-
  Failure-Evidence. Autonomes Hosting, Scheduling und übergreifendes
  Monitoring sind ein Aktivierungs-Gate aus Phase 23, keine
  Implementierungsabhängigkeit zurück auf Phase 20.
- Eine konservative Pflicht-/Optional-Taxonomie wird in Phase 20
  versioniert und fail-closed eingeführt. Optionale LIVE-Kommunikation bleibt
  bis zur Legal-/Consent-Freigabe aus Phase 22 deaktiviert.

## Risiken und Regressionsschutz

- Lockout bestehender Nutzer oder Einladungskonflikte.
- Doppelte Zustellung bei Crash nach Providerannahme.
- Falsches Preference-Gating unterdrückt Pflichtkommunikation.
- Providerfehler darf Domaintransaktionen nicht zurückrollen.
- Bestehende Password-Reset-, Application-, Invitation-, Alert- und
  Notification-Tests bleiben grün.

## Abwärtskompatibilität und Rollback

Alte Sessions bleiben nach dokumentierter Übergangspolicy gültig oder werden
gezielt widerrufen. Additive Tabellen können bei Rollback ungenutzt bleiben.
Provider-Aktivierung ist ein serverseitiges, fail-closed Release-Gate; Rollback
schaltet Zustellung in `PAUSED`, nicht unbemerkt auf Mock.

## Akzeptanzkriterien und Tests

### Unit

- [ ] Token-Hash, TTL, Rotation, Resend und generische Resultate.
- [ ] Address-Epoch, alte/neue Adresse, paralleler Wechsel, alte Links und
  Session-/Capability-Wirkung.
- [ ] Rechte-Matrix unverifiziert/verifiziert je Rolle und Aktion.
- [ ] Preference-Matrix Pflicht/Optional, Kanal und Frequenz.
- [ ] Backoff, Lease, Redaction und Provider-Dedupe.

### PostgreSQL / Integration

- [ ] Domaincommit und Outbox sind atomar; Rollback erzeugt keine Message.
- [ ] Parallelverbrauch von Verification Token und Outbox Lease ist genau
  kontrolliert.
- [ ] Crash vor/nach Providerannahme, Retry, DLQ und Replay.
- [ ] Crash nach Commit vor Send, Restart mit demselben gültigen Einmallink,
  Envelope-Key-Rotation/-Widerruf und kein Secret in Log/DTO.
- [ ] Candidate-, Employer-, Invite-, Reset-, Application- und Privacy-Flows.
- [ ] Vollständiges Callsite-Inventar: jeder Mailproduzent besitzt atomare
  Outbox-Evidence oder ein getestetes Realmodus-Denial.
- [ ] Cross-User-/Admin-Capability-Denials vor Repositoryzugriff.

### E2E und manuell

- [ ] Registrierung → Mock/Sandbox-Mail → Verify → Sessionrotation → Portal.
- [ ] Privacy Request → Challenge ist danach erreichbar.
- [ ] Abgelaufen, wiederholt, rate-limited, bounced und suppressed.
- [ ] Preference Center auf 360 px, Keyboard und Screenreader.
- [ ] Sandbox-Zustellung, Bounce und DLQ im Ops-Cockpit ohne PII-Leak.
- [ ] Cockpit-/Replay-Direct-Action ist ohne Phase-25-Capability und frischen
  Step-up ausserhalb Sandbox gesperrt.

## Evidence

Ein späterer Phase-20-Record nennt unveränderlichen Commit, Provider-Mode,
Sandbox statt Live, DNS-/DPA-Status, Befehle, Testresultate und offene externe
Gates. Für den technischen Phasenabschluss genügen der idempotente, bounded
ausführbare Handler sowie Mock-/Sandbox-Delivery- und Failure-Evidence; die
autonome Production-Ausführung bleibt bis Phase 23 als Aktivierungs-Gate offen.

## Definition of Done

- [ ] Reguläre neue Konten besitzen einen sicheren erreichbaren
  Verifizierungs-Lifecycle.
- [ ] Sensitive Aktionen sind serverseitig korrekt gegatet.
- [ ] Kein relevanter Domainwrite kann eine E-Mail dauerhaft ohne Outbox
  verlieren oder ist im Realmodus ausdrücklich deaktiviert.
- [ ] Retry, DLQ, Replay, Suppression und Monitoring sind belegt.
- [ ] Preference Center schützt Pflichtkommunikation.
- [ ] Privacy-Challenge funktioniert über den echten Registrierungsweg.
- [ ] Loading-, Empty-, Error-, Locked-, Retry-, Conflict- und Success-Zustände
  sind für Verification, Recovery, Zustellung und Preferences umgesetzt.
- [ ] Lint, Typecheck, Unit, Integration, DB, E2E, Mobile und A11y sind grün.
- [ ] Mock- und Realmodus sind sichtbar getrennt und fail-closed.

## Offene externe Voraussetzungen

Vendorvertrag/DPA, Absenderdomain, DNS, Reputation, Produktionssecret,
Legal-Freigabe der Templates und On-call. Ohne sie darf Realmodus nicht als
produktiv abgeschlossen markiert werden.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Erreichbare Identität, zuverlässige Kommunikation und weniger verlorene Kernaktionen. |
| Problem-IDs | STH-001, STH-002, STH-013, STH-026; E-Mail-Anteil STH-004. |
| Prerequisites | Phase 19; Vendor-/DPA-Entscheid für Realaktivierung. |
| Deliverables | Verification, Outbox/Attempts/DLQ, Provider, Preference Center, Ops-Replay. |
| Security / Privacy | Hash-Tokens, generische Antworten, minimale Payloads, Pflicht-/Optional-Trennung. |
| Tests | Concurrency, Crash/Retry, Rollen, Privacy-E2E, Sandbox und Mobile/A11y. |
| Expected Result | Keine unverifizierte Vollfreigabe und keine best-effort-only Kernmail. |
| Risks / Limits | Exactly-once extern ist nicht behauptbar; stabile Dedupe und at-least-once sind Pflicht. |
