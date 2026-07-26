# Phase 27 — Multi-Persona-Identity und Portalwechsel

> **Status: GEPLANT / NICHT BEGONNEN.** Ein User besitzt derzeit genau eine
> globale Rolle. Multi-Company-Memberships sind bereits tenant-sicher; sie
> dürfen durch diesen Umbau nicht ersetzt oder aufgeweicht werden.

## Ziel

Eine Person kann Candidate und Company-Mitglied sein, ohne doppelte
E-Mail-Konten, fragmentierte Privacy-Historie oder automatische
Rechteerweiterung. Interne Adminrollen bleiben separat.

## Ausgangslage und Problem-ID

- `STH-012` bestätigt: Candidate/Admin kann eine Company Invitation nicht mit
  derselben Identity annehmen; `emailNormalized` verhindert ein zweites Konto.
- Company Membership und Job Assignment funktionieren bereits für mehrere
  Firmen und bleiben Autoritätsquelle des Employer-Portals.
- Das ist kein aktueller Cross-Tenant-Defekt, sondern eine strategische
  Identity-/Journey-Lücke mit sehr hohem Änderungsrisiko.

## In Scope

- Identity getrennt von Persona und interner Plattformrolle.
- Optionale Candidate Persona/Profile sowie Company Memberships pro Identity.
- Sicherer Portal-/Company-Kontextwechsel und Default Destination.
- Registrierung, Invitation, Login, Safe Next und Navigation.
- Migration der vier Legacy-Rollen ohne Rechteausweitung.
- Vollständiger Privacy Export/Delete über die gesamte Identity.
- Session-/Audit-/Analytics-Kontext und Suspension-Semantik.

## Out of Scope

- Ersetzen von Company Membership/Job Assignment durch globale Persona.
- Agenturmandate/REQ-REC-002, SSO/SCIM oder Account-Sharing.
- Automatisches Zusammenführen gleichnamiger oder ähnlich adressierter Konten.
- Admin-RBAC aus Phase 25 in dasselbe Rollenmodell mischen.

## Rollen und Prozesse

Identity kann Candidate-Persona und null bis viele Company Memberships tragen.
Employer/Recruiter-Rechte stammen weiterhin je Firma aus Membership/Assignment.
Interne Adminrollen/Grants bleiben getrennt und werden nie durch Persona Switch
verliehen.

## Betroffene Dateien und Module

- `prisma/schema.prisma`: User, Role, Candidate/Employer Profile, Membership
- `lib/auth/**`, `lib/employer/team.ts`, Current User/Context/Safe Next
- Candidate-/Employer-/Admin-Layouts und Navigation
- alle Route Guards, Analytics/Audit/Privacy/Notifications
- Seeds, Browserfixtures und praktisch alle Cross-role-Tests

## Datenmodelländerungen

Ein neuer versionierter Identity-/Persona-Vertrag wird vor Code festgelegt.
Mögliche additive Brücke: PersonaAssignment und getrennte InternalRole/
AdminGrant, während Legacy `User.role` temporär read-kompatibel bleibt. Company
Membership bleibt unverändert tenant-spezifisch. Keine Big-Bang-Enum-Löschung.

## Sicherheits- und Datenschutzfolgen

- Portal-/Company-Kontext ist keine Berechtigung; jede Query prüft Membership,
  Assignment und Owner erneut.
- Persona Switch rotiert/bindet Sessionkontext und Safe Next.
- Candidate-Daten erscheinen nie im Employerkontext ohne konkreten
  Application-/Reveal-Vertrag.
- Merge/Duplicate-Account-Prozess ist separat, step-up- und auditpflichtig.

## Migrationsstrategie

- [ ] Identity-/Persona-ADR und vollständige Route-/Policy-Matrix.
- [ ] Additive Persona-Relationen und Backfill aus Legacy-Rollen.
- [ ] Dual Read mit Vergleichstelemetrie; keine automatische Grantable Persona.
- [ ] Invitations für bestehende Candidate Identity erst hinter Feature Flag.
- [ ] Legacy Role erst nach vollständigem Backfill/Reverse-Check deprecaten.
- [ ] Expand/contract über mehrere Deployments mit Rollback.

## Implementierungsschritte

- [ ] Ist-Guards, Destinations, Memberships und Privacy Inventory erfassen.
- [ ] Schema/Backfill/Constraints additiv implementieren.
- [ ] Current Identity, Persona Context und sichere Portalwahl.
- [ ] Candidate/Employer Registration und Invitation auf Identity-Lifecycle.
- [ ] alle Guards/Repositories auf Persona + Membership/Assignment umstellen.
- [ ] Navigation/Portal Switcher und Locked/Error States.
- [ ] Privacy, Audit, Analytics, Notifications und Suspension konsolidieren.
- [ ] Duplicate-/Legacy-Konflikte als manuelle Queue behandeln.
- [ ] Cross-Persona-/Cross-Tenant-E2E und Migrations-/Rollback-Drill.

## Abhängigkeiten

Phasen 20, 22 und 25; Phase 19 Baseline; Produktentscheidung, ob
Multi-Persona vor erstem Launch wirklich erforderlich ist. Kann nach Phase 26
parallel zu Phase 28 vorbereitet, aber nicht mit Admin-RBAC refactored werden.

## Risiken und Regressionen

- Sehr hoher Blast Radius über alle Portale.
- Persona Context wird fälschlich als Tenantautorität verwendet.
- Candidate-Datenleak an Company oder Admin-Grant durch Switch.
- Safe Next/Default Route Schleifen.
- Privacy Export/Delete erfasst nur eine Persona.

## Abwärtskompatibilität und Rollback

Legacy `User.role` bleibt während Expand-Phase lesbar. Alte Sessions werden
gezielt migriert oder widerrufen. Feature Gate kann neue Persona-Anlage
pausieren; bereits angelegte Memberships bleiben wirksam. Kein destruktives
Contracting vor erfolgreichem Restore-/Rollbacktest.

## Akzeptanzkriterien und Tests

### Unit / Policy

- [ ] Identity×Persona×Membership×Assignment-Matrix.
- [ ] Safe Next/Default Destination/Portal Switch.
- [ ] Candidate Privacy bleibt vom Employerkontext getrennt.

### PostgreSQL / Integration

- [ ] Candidate akzeptiert Company Invitation mit derselben Identity.
- [ ] mehrere Firmen bleiben isoliert; Assignment wirkt unverändert.
- [ ] Membership Suspension sperrt nur Firma, User Suspension alles.
- [ ] Admin Grants entstehen nie aus Persona.
- [ ] Export/Delete/Audit umfasst gesamte Identity.
- [ ] Backfill und Reverse-/Rollbackmigration aller Legacy-Rollen.

### E2E und manuell

- [ ] Candidate ↔ Employer/Recruiter Portalwechsel.
- [ ] Company A/B, Direct URL, Safe Next und Sessionrotation.
- [ ] Invitation existing/new, duplicate e-mail und unsupported merge.
- [ ] Desktop/360 px, Keyboard, Screenreader und alle vier Legacyrollen.

## Evidence und Definition of Done

- [ ] Eine Identity kann mehrere fachliche Personas ohne Doppelkonto besitzen.
- [ ] Company Membership/Assignment bleibt alleinige Tenantautorität.
- [ ] Kein Portalwechsel erzeugt Rechte oder Datenleak.
- [ ] Privacy/Audit/Analytics sind identity-weit konsistent.
- [ ] Loading-, Empty-, Locked-, Error-, Retry-, Conflict- und Success-Zustände
  des Persona-/Tenant-Wechsels sind auf Desktop und Mobile eindeutig.
- [ ] Migration, Rollback, Cross-role und Cross-tenant Gates sind grün.
- [ ] Produktentscheidung und Blast-Radius-Evidence sind dokumentiert.

## Offene externe Voraussetzungen

Produktpriorität, Support-/Account-Recovery-/Merge-Policy und gegebenenfalls
Re-consent. Kein zwingender Go-live-Blocker für einen bewusst segmentierten
ersten MVP.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Rollenwechsel ohne Doppelkonto und fragmentierte Identität. |
| Problem-ID | STH-012. |
| Prerequisites | 20, 22, 25; explizite Produktfreigabe. |
| Deliverables | Persona-Modell, Switcher, Registration/Invitation, vollständige Migration. |
| Security / Privacy | Membership bleibt Autorität; kein Cross-Persona-Leak; identity-weite Rechte. |
| Tests | Matrix, company A/B, safe next, migration/rollback, full E2E. |
| Expected Result | Mehrfachpersonas ohne Tenant- oder Adminrechte-Erweiterung. |
| Risks / Limits | XL-Umbau; nicht mit Admin-RBAC als pauschales Rollenrefactoring koppeln. |
