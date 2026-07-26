# Phase 25 — Admin-MFA, Least Privilege und kritische Freigaben

> **Status: GEPLANT / NICHT BEGONNEN.** Capability-Namen und Audit-Seams sind
> vorhanden; jeder aktive globale `ADMIN` erhält derzeit aber alle
> implementierten Admin-Capabilities und benötigt keinen zweiten Faktor.

## Ziel

Interne Plattformrechte pro Person auf das notwendige Minimum begrenzen,
kritische Aktionen mit starker frischer Authentisierung schützen und
Break-glass/Recovery nachvollziehbar beherrschen.

## Ausgangslage und Problem-IDs

- `STH-010`: globale Adminrolle besitzt alle 36 implementierten Capabilities.
- `STH-011`: Passwort und bis zu 30 Tage alte Session genügen; kein
  WebAuthn/TOTP/Recovery/Assurance-Level.
- Dual Approval bei Cluster Launch speichert zwei Schritte, erzwingt aber nicht
  zwei unterschiedliche Personen und ist kein Vier-Augen-Prinzip.

## In Scope

- Verpflichtende Admin-MFA: WebAuthn/Passkey bevorzugt, kontrolliertes TOTP.
- Gehashte Single-use Recovery Codes und sichere Enrollment/Reset-Prozesse.
- Session Assurance und Step-up-Freshness pro kritischer Aktion.
- Persistierte Adminrollen/Capability Grants, deny-by-default.
- Support, Moderation, Finance, Privacy, Content/Supply, Platform Admin und
  enges Superadmin/Break-glass.
- Grant/Revocation, Sessionwiderruf, zeitliche Begrenzung und Audit.
- Actor Separation/Vier-Augen für definierte Hochrisikoaktionen.
- Capability-gesteuerte Adminnavigation als UX, niemals einzige Schranke.

## Out of Scope

- Candidate/Employer-Multi-Persona (Phase 27).
- Company Memberships ersetzen oder globale Userrolle pauschal refactoren.
- Shared Admin Accounts oder E-Mail-only Recovery.
- Automatische Rechtevergabe aus UI-/Clientparametern.

## Rollen und Prozesse

Interne Rollen werden explizit modelliert. Privacy, Finance und Superadmin
benötigen stärkste Step-up-Regeln. Break-glass ist zeitlich begrenzt,
begründet, separat alarmiert und automatisch widerrufen.

## Betroffene Dateien und Module

- `lib/admin/capabilities.ts`, sämtliche `lib/admin/**` Commands
- `lib/auth/**`, Session/Credential/Route Guards
- `app/admin/**`, Sidebar und Actions
- Privacy Actor Construction, Cluster Approval, Billing/Credits/User Actions
- `prisma/schema.prisma`, Migrationen, Seeds, Audit und Notifications
- alle Admin Unit-/PostgreSQL-/E2E-Tests

## Datenmodelländerungen

AdminRole, Capability/RoleAssignment oder äquivalente persistierte Grants;
Authenticator/Credential, WebAuthn Challenge, Recovery Code und Session
Assurance; BreakGlassGrant/Approval. Grants und Sicherheitsereignisse sind
append-only oder vollständig evented. Bestehende `AuditLog.capability` bleibt
Evidence, nicht Autoritätsquelle.

## Sicherheits- und Datenschutzfolgen

- Authenticator-Secrets und Recovery Codes verschlüsselt/gehasht.
- WebAuthn bindet RP-ID, Origin, Challenge und Counter/Backup-Status.
- Grantänderung wirkt serverseitig sofort und widerruft betroffene Sessions.
- Step-up kann nicht als Client-Boolean behauptet werden.
- Break-glass löst Alert und unveränderliches Audit aus.

## Migrationsstrategie

- [ ] Additive Modelle; bestehende Admins explizit in eine minimale
  Bootstrap-Rolle überführen.
- [ ] Kein Default-Grant „alle Capabilities“ in Production.
- [ ] Zwei benannte, getrennte Recovery-/Bootstrap-Verantwortliche vor Cutover.
- [ ] Capability-Checks dual gegen neue Grants beobachten, danach erzwingen.
- [ ] Alte globale Semantik erst nach vollständiger Matrix entfernen.

## Implementierungsschritte

- [ ] Admin Identity/RBAC/MFA/Break-glass-ADR und Rollenmatrix.
- [ ] Authenticator-, Assurance- und Grant-Schema migrieren.
- [ ] WebAuthn/TOTP Enrollment, Login-Step und Recovery implementieren.
- [ ] zentrale serverseitige `requireAdminCapability` gegen persistierte Grants.
- [ ] jede Page, Read-Query und Mutation einem Capability Owner zuordnen.
- [ ] Step-up-Policy für Privacy, Finance, Credits, Roles, Reveal und Recovery.
- [ ] Grant Admin, Revocation, Sessionwiderruf und Break-glass.
- [ ] Actor-Separation für definierte Dual-Approval-Workflows.
- [ ] Seeds/Testadmins migrieren, ohne Production-Bootstrap zu simulieren.
- [ ] Security-, Lockout-, Recovery- und Privilege-Escalation-Drills.

## Abhängigkeiten

Phase 20 Identity/Outbox. Schema, Policy und lokale WebAuthn-/TOTP-
Contracttests können darauf technisch aufbauen. Reale HTTPS-/Staging-Domain,
Secret Manager und Phase-23-Operations sind Aktivierungs-Gates für
Production-RP-ID, Recovery und Alarmierung. Benannte, organisatorisch
getrennte Admin-/Recovery-Owner bleiben extern. Phase 24/26 sowie produktive
Privacy-/Replay-Aktionen warten mit ihrem LIVE-Cutover auf diese Phase.

## Risiken und Regressionen

- Betreiber-Lockout durch fehlerhaftes Enrollment oder Backfill.
- Navigation blendet Funktion aus, Server erlaubt sie weiterhin.
- Grant Cache/Session bleibt nach Revocation wirksam.
- Privacy-/Finance-Commands bauen weiterhin implizit alle Capabilities.
- Bestehende Tenant-404- und User-Suspension-Regeln dürfen nicht schwächer
  werden.

## Abwärtskompatibilität und Rollback

Bootstrap erfolgt mit zeitlich begrenztem, auditiertem Verfahren. Rollback
aktiviert niemals still die alte All-Admin-Semantik; stattdessen wird der
Adminbetrieb pausiert oder ein kontrollierter Break-glass genutzt. Additive
Grants können deaktiviert, nicht destruktiv gelöscht werden.

## Akzeptanzkriterien und Tests

### Unit

- [ ] vollständige Role×Capability×Action Allow/Deny-Matrix.
- [ ] WebAuthn/TOTP/Recovery/Step-up-Challenge, Replay und Clock.
- [ ] falsche RP-ID/Origin, Challenge-Replay, Sign-Counter-/Backup-State,
  deaktivierter Authenticator und letzte-Faktor-Entfernung fail-closed.
- [ ] Recovery-Code-Konkurrenz/Single-use sowie Assurance-Erhalt und
  -Downgrade bei Sessionrotation.
- [ ] Break-glass TTL, Reason und automatische Revocation.

### PostgreSQL / Integration

- [ ] eingeschränkter echter Admin kann fremde Bereiche weder lesen noch
  mutieren.
- [ ] Grant/Revocation wirkt auf nächste Serverprüfung und Sessions.
- [ ] suspendierter Admin und deaktiviertes Verfahren verlieren unmittelbar
  Login, Step-up und bestehende Assurance.
- [ ] Privacy/Finance/Support/Moderation/Content getrennt.
- [ ] zwei verschiedene Actor-IDs bei Vier-Augen-Aktionen.
- [ ] Bootstrap-/Legacy-Admin-Migration ohne All-Grant.

### E2E und manuell

- [ ] Admin Enrollment/Login/Step-up/Recovery/Device Loss.
- [ ] sensibles Command mit alter Assurance wird abgewiesen.
- [ ] Navigation und Direkt-URL folgen derselben Capability.
- [ ] Break-glass Incident und Alert.
- [ ] 360 px, Keyboard, Screenreader und mehrere Authenticatorbrowser.

## Evidence und Definition of Done

- [ ] Kein aktiver Admin erhält allein wegen `role=ADMIN` alle Rechte.
- [ ] Admin-MFA ist verpflichtend; Recovery erzeugt keine einfache Bypassroute.
- [ ] Kritische Aktionen verlangen aktuelle serverseitige Assurance.
- [ ] Grants, Revocations, Vier-Augen und Break-glass sind auditiert.
- [ ] Kein Betreiber-Lockout im dokumentierten Recovery-Drill.
- [ ] Loading-, Empty-, Locked-, Step-up-, Error-, Recovery-, Conflict- und
  Success-Zustände sind ohne informationsleckende Rechtehinweise umgesetzt.
- [ ] Vollständige Security-/Privilege-/Tenant-/E2E-Gates sind grün.

## Offene externe Voraussetzungen

Staging-/Production-RP-ID und HTTPS, Security-Key-/Authenticator-Policy,
Recovery-Owner, On-call und organisatorische Funktionstrennung.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Begrenzter Schadensradius und belastbare interne Verantwortlichkeit. |
| Problem-IDs | STH-010, STH-011. |
| Prerequisites | 20, 23; benannte Admin-/Recovery-Owner. |
| Deliverables | MFA/Recovery/Assurance, persistierte Grants, Step-up, Vier-Augen, Break-glass. |
| Security / Privacy | Deny-by-default, sofortige Revocation, kein shared account, vollständiges Audit. |
| Tests | Capability matrix, auth replay, session revoke, actor separation, recovery drill. |
| Expected Result | Ein kompromittiertes Admin-Konto besitzt nicht automatisch die ganze Plattform. |
| Risks / Limits | Multi-Persona bleibt Phase 27 und wird nicht mit internem RBAC vermischt. |
