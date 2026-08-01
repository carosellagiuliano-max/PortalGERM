# Phase 25 — Privileged Action Assurance, Least Privilege und Trust & Safety

## 1. Status

| Dimension | Status |
| --- | --- |
| Planstatus | `TECHNISCH ABGESCHLOSSEN` |
| Technikstatus | `LOCAL/CI CONTRACT IMPLEMENTED AND VERIFIED` |
| Quality-Gate | `LOCAL G3 PASSED` |
| Aktivierung | `DISABLED / BLOCKED BY EXTERNAL GATE` |

Diese Phase besteht aus drei getrennt abnehmbaren, aber gemeinsam modellierten
Tracks:

- **25A — Admin Least Privilege, MFA, Separation of Duties und Break-glass**;
- **25B — non-admin risk-based Step-up für Candidate und Employer**;
- **25C — Fraud, Scam, Account Takeover und Trust-&-Safety-Operations**.

Alle drei Tracks sind als zusammenhängender, standardmässig deaktivierter
Local-/CI-Vertrag implementiert. Der commitgebundene vollständige G3-Abschluss
ist auf Candidate `eb8cbcd` mit Unit-, PostgreSQL-, Desktop-/360-/A11y-,
Migration-/Seed-, HTTP/HSTS- und Clean-Clone-Recovery-Evidence grün; siehe
[Phase-25-Evidence](./evidence/2026-07-28-phase-25.md). Technische Abnahme
aktiviert keinen Track implizit.

## 2. Ziel und messbarer Business-/Nutzerwert

Ein kompromittiertes Konto soll nur den minimalen, explizit freigegebenen
Schadensradius besitzen. Hochrisikoaktionen benötigen frische,
aktionsgebundene Authentisierung; verdächtige oder kompromittierte Identitäten,
Firmen, Stellen, Nachrichten-, Radar-, Export- und Paymentflüsse werden schnell
gehalten beziehungsweise widerrufen, ohne Betroffene rechtlos einer geheimen
Automatik auszuliefern.

Messbare Zielwerte:

- `0` Admin-Capabilities allein aufgrund `User.role=ADMIN`;
- `0` Wirkung einer Hochrisikoaktion ohne passenden frischen
  actor-/purpose-/tenant-/action-bound Nachweis;
- `0` gleiche Actor-ID in einem vorgeschriebenen Vier-Augen-Entscheid;
- Session-/Grant-/Trust-Revocation wirkt bei der nächsten serverseitigen
  Autorisierungsprüfung;
- jeder Hold/Revoke besitzt Reason, Policy-Version, Evidence, Owner, Ablauf oder
  Review und Appealpfad;
- False Positives werden messbar erfasst und dürfen nicht durch stille
  manuelle Datenbankänderung „gelöst“ werden.

## 3. Tatsächlicher Repositoryzustand

- `STH-010`: zehn persistierte Adminrollen verteilen 50 explizite
  Capabilities. Die globale Plattformrolle `ADMIN` öffnet nur den internen
  Portalrahmen und gewährt allein exakt `0` Capabilities.
- `STH-011`: WebAuthn, TOTP, gehashte Single-use Recovery Codes,
  Session-Assurance, Authenticator-Reset mit Freigabe, SoD und zeitgebundenes
  Break-glass sind serverseitig und persistent umgesetzt.
- `STH-030`: eine zentrale `StepUpPolicy` schützt inventarisierte
  Candidate-/Employer-Aktionen mit opaque Single-use Grants, gebunden an
  Actor, Session, Purpose, Action, Tenant und Resource.
- `STH-031`: versionierte Risk Signals und Decisions, deduplizierte
  Trust-&-Safety-Cases, bounded Hold/Revoke, Appeal, unabhängiges Restore und
  fail-closed Expiry-/Revocation-Worker sind integriert.
- Sieben additive Phase-25-Migrationen, der Seedvertrag
  `phase-25-demo-v14`, 119 Seiten/18 Handler im Routeninventar sowie
  owning Unit-, PostgreSQL-, Desktop-/360- und A11y-Tests liegen vor.

Die Durchsetzung bleibt über sichere Defaults geschlossen beziehungsweise im
Observe-Modus, bis die externen Owner-, Staging-, Policy- und
Operationsgates aus Abschnitt 17 erfüllt sind.

## 4. Findings und Requirements

| ID | Phase-25-Vertrag |
| --- | --- |
| `STH-010` / `REQ-ADM-007` | persistierte deny-by-default Adminrollen und Capabilities |
| `STH-011` / `REQ-ADM-007` | Admin-MFA, Recovery, frische Assurance, SoD, Break-glass |
| `STH-030` / `REQ-ID-004` | Step-up für Owner/Billing/Team, Login-E-Mail, Export/Delete, Consent/Reveal |
| `STH-031` / `REQ-TRUST-001` | Credential Stuffing, ATO, Fake/Duplicate Jobs, Scam, Massennachrichten, Reveal/Export-/Payment-Anomalien |
| `REQ-ID-005` | Login-E-Mail-/Recovery-Lifecycle aus Phase 20 sicher einbinden |
| `REQ-OPS-005` | autonome Risk-/Alert-/Expiry-/Revocation-Aufträge über Phase 23 |
| `REQ-EMP-008` | kompromittierte Firma verliert Trust/Badge/Jobs/Radar über Phase 26 |
| `REQ-PAY-001` / `REQ-BIL-010` | Finance-/Payment-/Recovery-Aktionen aus Phase 24 schützen |
| `REQ-QA-003` | 28-Punkte- und criterion-level Testvertrag |

ADR-036 ist der gemeinsame Risiko- und Assurance-Entscheid. Phase 25
operationalisiert dessen Admin- und non-admin-Vertrag in 25A/25B und führt mit
25C den darin beschriebenen Trust-&-Safety-Fall, Risk Decision, Revocation und
Appeal als eigenen abnehmbaren Track aus.

## 5. In Scope

### 25A

- verpflichtende Admin-MFA: Passkey/WebAuthn bevorzugt, kontrolliertes TOTP;
- gehashte Single-use Recovery Codes, Enrollment, Device Loss und Reset;
- persistierte Adminrollen/Capability Grants, deny-by-default;
- Support, Moderation, Finance, Privacy, Content/Supply, Trust & Safety,
  Platform Admin und enges Superadmin;
- sofortige Grant-/Session-Revocation, zeitliche Grants und Audit;
- Separation of Duties, unterschiedliche Actor-IDs und Vier-Augen-Prinzip;
- zeitlich begrenztes, alarmiertes Break-glass ohne stilles All-Admin-Fallback.

### 25B

- zentrale `StepUpPolicy` und kurzlebiger `StepUpGrant`;
- Employer Owner: Billing, Zahlungsmittel/Checkout, Team-/Rollen-/Ownerwechsel,
  Bulk Export, Radar Reveal/Export und sensible Company-/Trustaktionen;
- Candidate: Login-E-Mail, Account Recovery, Export/Delete, kritische
  Consent-/Radar-/Reveal-Aktionen;
- Login-E-Mail-Änderung bindet alte/neue Adresse, aktuelle Session und
  Reverification aus Phase 20;
- action-, actor-, purpose-, tenant-, resource- und optional
  quote-/amount-bound Grants;
- Recovery und Supportidentitätsprüfung ohne E-Mail-only-Bypass.

### 25C

- versionierte minimale Risk Signals und Decision Engine;
- Credential Stuffing, Session-/Device-Anomalien, Velocity, wiederholte
  Beschwerden, kompromittierte VERIFIED Company, Fake-/Duplicate-Jobs,
  Massennachrichten, Reveal-/Export-/Payment-Fraud-Signale;
- TrustSafetyCase mit Hold, Allow, Step-up, Review, Revoke, Expiry und Appeal;
- schnelle serverseitige Revocation von Session, Badge, Public Jobs,
  Messaging, Radar, Export und Paymentoperationen;
- False-Positive-Review, Incident-Eskalation und auditiertes Restore nur nach
  erneuter Prüfung.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- Multi-Persona-/Portalmodell aus Phase 27;
- fachliche Firmen-Evidence/Registry-/Domainprüfung aus Phase 26;
- Job-Freshness-/Duplicate-Search-Core aus Phase 30D; 25C verarbeitet Signale,
  ersetzt aber dessen Fachvertrag nicht;
- autonome Worker-/Pagerplattform aus Phase 23;
- generisches Behavioral Advertising, biometrische Identifikation oder
  undurchsichtiger „Fraud Score“ als alleinige Endentscheidung;
- automatische irreversible Accountlöschung oder Geldbewegung durch ein
  Risikosignal;
- Shared Admin Accounts, E-Mail-only Recovery oder Client-Boolean für Step-up;
- öffentliche Offenlegung geheimer Riskweights, Device-Fingerprints oder
  interner Reviewer-Notizen.

Bis zum jeweiligen Gate bleiben privilegierte Aktionen, Trust-Revoke und
öffentlicher Paid Checkout serverseitig deaktiviert.

## 7. Benutzerrollen und organisatorische Owner

- interne Rollen: Support, Moderation, Finance, Privacy, Content/Supply,
  Trust & Safety, Security, Platform Admin, zeitgebundenes Break-glass;
- Employer: Owner, Admin, Recruiter, Viewer je Company Membership;
- Candidate und Visitor;
- System Worker und Provideridentitäten;
- Security Owner: MFA, Assurance, Session, Riskpolicy;
- Trust-&-Safety-Owner: Signal-/Case-/Appealpolicy;
- Privacy Owner: Zweck, Retention und Zugriff auf Risk-/Device-/Case-Daten;
- Ops/On-call: Alerts, Expiry, Queue und Incident;
- unabhängige Approver für Rollen, Break-glass, Cluster-/Trust- und definierte
  Finance-/Privacy-Hochrisikoaktionen.

Kein Rollenname ist selbst Autorität. Jede Serverprüfung löst aktuelle,
persistierte Grants beziehungsweise Company Membership/Assignment neu auf.

## 8. Portale, Routen, Services, Provider und Worker

Implementiertes Route Delta:

- Admin Security: `/admin/security/roles`, `/admin/security/grants`,
  `/admin/security/authenticators`, `/admin/security/break-glass`;
- Trust & Safety: `/admin/trust-safety`, `/admin/trust-safety/[id]`;
- User Security: `/candidate/settings/security`,
  `/employer/settings/security`, `/security/step-up` und
  `/security/account-recovery`;
- bestehende Admin-, Finance-, Privacy-, Company-, Radar-, Export-/Delete-,
  Team-/Billing- und Jobactions werden an zentrale Guards gebunden.

Implementierte Services:

- `lib/auth/assurance/**`;
- `lib/admin/role-policy.ts`, `lib/admin/security-governance.ts` und zentrale
  persistierte Capability Resolution;
- `lib/security/risk/**`, `lib/trust-safety/**`;
- Worker für Security-/Case-Expiry, Alert und Revocation-Projektion über den
  Phase-23-Handlerkatalog;
- Notification-Outbox aus Phase 20.

Das generierte Ist-Inventar enthält 119 Seiten und 18 Handler.

## 9. Datenmodelle, Constraints, Indizes und Datenklassifikation

Implementierte additive Modelle:

- `AdminRole`, `AdminCapabilityGrant`, `AdminRoleAssignment`;
- `Authenticator`, `WebAuthnCredential`, `TotpCredential`,
  `RecoveryCode`, `AuthenticatorEvent`;
- `SessionAssurance`, `StepUpChallenge`, `StepUpGrant`;
- `BreakGlassGrant`, `PrivilegedApproval`;
- `RiskSignal`, `RiskDecision`, `TrustSafetyCase`, `TrustSafetyCaseEvent`,
  `TrustSafetyAppeal`.

Pflichtinvarianten:

- aktive Grant-/Assignment-Kombinationen sind eindeutig und zeitlich bounded;
- Recovery Code gehasht und genau einmal verbrauchbar;
- WebAuthn Challenge, RP-ID, Origin und Credentialbindung; Counter-/Backup-State
  wird policygerecht behandelt;
- StepUpGrant ist opaque, gehasht/referenzbasiert, single-purpose,
  actor-/tenant-/resource-bound und kurzlebig;
- SoD-Approval verlangt unterschiedliche Actor-IDs und zulässige Duties;
- Case/Event-/Grant-/Securityhistorie ist append-only oder vollständig evented;
- Risk Signals tragen Zweck, Quelle, Retention und minimale redigierte Werte;
- Indizes für aktive Grants, Challenge Expiry, Case Status/Priority/Assignee,
  Signal Subject/Window und offene Appeals.

Authenticator-Secrets, Recovery Codes, Device-/Risk-Daten und interne Evidence
sind `RESTRICTED`; Public/Support DTOs enthalten nur minimal nötige Zustände.

## 10. Migration, Backfill und Kompatibilität

1. additive Modelle/Enums/Constraints; keine Big-Bang-Änderung an `User.role`;
2. bestehende Admins explizit in eine minimal freigegebene Bootstrap-Rolle
   überführen; Production erhält nie Default-`*`;
3. Capability Resolution zunächst dual beobachten und Abweichungen messen;
4. jede Admin Page, Read Query und Mutation erhält vor Enforcement einen Owner;
5. Admin-MFA kohortenweise enrollen; zwei benannte getrennte Recovery-Owner vor
   Cutover;
6. StepUpPolicy zunächst report-only auf inventarisierten Actions, danach
   serverseitig erzwingen;
7. 25C-Signale zunächst observe-only; Holds/Revoke erst nach Policy-/False-
   Positive-Review;
8. leere DB, alle Legacyrollen, teilweise Grants/Challenges/Cases,
   unterbrochene Backfills und idempotente Wiederholung testen;
9. Contract der globalen All-Admin-Semantik erst nach vollständiger
   Role×Capability×Action-Matrix;
10. Rollback darf nie still All-Admin oder Step-up-Bypass reaktivieren.

## 11. Server-, Worker-, Queue- und Providervertrag

- `requireAdminCapability` löst aktive persistierte Grants serverseitig auf;
- `requireStepUp` prüft Actor, Session, Purpose, Action, Tenant, Resource,
  Policy-Version, issued/expiry und Revocation;
- Authenticator-Challenges sind servergeneriert, single-use und an
  RP-ID/Origin/Session gebunden;
- Risk Engine gibt versionierte `ALLOW|STEP_UP|HOLD|REVIEW|REVOKE`-Entscheide
  mit Reason Codes aus; geheimer Score allein autorisiert nichts;
- riskante Mutationen re-checken Risk/Trust unmittelbar vor Commit;
- Worker verarbeitet Expiry/Revocation/Alerts idempotent über Phase-23-Leases;
  öffentliche/privilegierte Reads bleiben trotzdem fail-closed und hängen
  nicht allein am Worker;
- jede Case-/Grant-/Break-glass-/Appeal-Mutation schreibt Audit/Outbox
  transaktional;
- Provider-/Identityausfall führt zu Hold/Retry oder sicherem Denial, nicht
  stiller Abschwächung.

## 12. UX-Zustände

Alle Enrollment-, Step-up-, Grant-, Break-glass- und Trust-Safety-Flows besitzen:

- **Loading:** Challenge/Authenticator/Case sicher laden;
- **Empty:** kein Faktor, keine Grants, keine Fälle, keine Appeals;
- **Locked:** Enrollment erforderlich, Risiko-Hold, Capability fehlt,
  Recoverylimit;
- **Pending:** Challenge, zweiter Approver, Review oder Appeal;
- **Error:** generische sichere Fehler-ID ohne Enumeration/Riskdetails;
- **Retry:** erlaubter neuer Challenge-/Recovery-/Caseversuch mit Limits;
- **Conflict:** stale Grant, parallel verbrauchter Code, anderer Approver,
  zwischenzeitlich widerrufene Rolle;
- **Expired:** Challenge, StepUpGrant, Grant, Break-glass oder Reviewfrist;
- **Cancelled:** Nutzer bricht Step-up/Enrollment ab; kein fachlicher Effekt;
- **Success:** Faktor aktiv, Action genau einmal ausgeführt, Grant/Case
  nachvollziehbar entschieden.

Trust-Holds erklären sichere nächste Schritte und Appeal, ohne geheime Signale
oder andere Nutzer offenzulegen.

## 13. Mobile und Accessibility

- Enrollment, Step-up, Recovery, Case Triage und Appeal funktionieren bei
  360 px, Touch, Tastatur und Screenreader;
- Passkey-/TOTP-Auswahl und Fallback sind semantisch, ohne QR-only-Zwang;
- Recovery Codes sind sicher kopier-/druckbar, aber nicht in Analytics/DOM nach
  Verlassen erneut verfügbar;
- Countdown/Expiry besitzt Text und keine rein visuelle Zeitinformation;
- Fokus wechselt nach Challenge-/Fehler-/Success-Zustand nachvollziehbar;
- Risk/Status/Severity ist nicht nur farbcodiert;
- Admin-/Case-Tabellen bieten mobile Kernaktionen in zugänglicher Detailansicht.

## 14. Authentisierung, Step-up, Autorisierung und Tenant

### 25A

- Admin-Login verlangt nach Bootstrap verpflichtende registrierte MFA;
- jede Page, Query und Action benötigt die genaue persistierte Capability;
- Navigation ist Capability-UX, niemals einzige Schranke;
- Grant/Revocation wirkt bei der nächsten Serverprüfung und widerruft Sessions;
- Privacy, Finance, Security, Trust & Safety und Superadmin bleiben getrennt;
- Break-glass ist zeitlich begrenzt, zweckgebunden, alarmiert und ohne
  Capability-Vererbung.

### 25B

- Employer-/Candidate-Rechte stammen weiterhin aus Membership/Ownership,
  Candidate Ownership und fachlichen Policies;
- Step-up ergänzt, ersetzt aber nie Authorization/Tenantprüfung;
- direkte Action, alte UI, anderer Tenant/Resource/Purpose und Replay scheitern;
- Login-E-Mail-/Recovery-/Accountlöschungsflows widerrufen relevante Sessions
  und alte StepUpGrants.

### 25C

- Trust-Signal ist keine Tenantautorität;
- Case Reviewer sieht nur Need-to-know; Support sieht keinen geheimen Riskinput;
- Revoke/Hold kann Rechte enger machen, niemals Grants erzeugen;
- Restore benötigt aktuellen fachlichen Trustnachweis und je Risiko SoD.

## 15. Datenschutz, Retention, Export, Löschung und Audit

- Datenminimierung: keine uneingeschränkten Device-Fingerprints, keine
  Inhaltskopien aus CV/Nachricht/Query in RiskSignal;
- Zweck/Quelle/Policy-Version/Retention je Signal und Case;
- Authenticatorsecrets verschlüsselt; Recovery Codes gehasht;
- Export erklärt Security-/Trust-Entscheide in zulässigem Umfang, offenbart
  keine internen Missbrauchsregeln oder Daten Dritter;
- Löschung folgt Phase-22-Matrix; Security-/Fraud-/Grant-/Appeal-Evidence bleibt
  nur minimal und rechtsgrundgebunden;
- keine Risk-/Case-Inhalte in Product Analytics;
- Access auf Restricted Evidence wird selbst auditiert;
- falsche Positiventscheidungen, Appeals, Restores und manuelle Overrides sind
  unveränderlich nachvollziehbar.

## 16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien

- Credential Stuffing, Password Spray, Session Theft und Recovery Social
  Engineering;
- WebAuthn Challenge Replay, falsche RP-ID/Origin, geklonte/backupfähige
  Credential-Signale und TOTP-Replay;
- MFA-Fatigue, Recovery-Code-Race und letzte-Faktor-Entfernung;
- gestohlene Employer-Owner-Session: Rollen, Billing, Job, Massennachricht,
  Radar, Reveal oder Export;
- kompromittierte VERIFIED Company und schnelle öffentliche Schadensbegrenzung;
- Fake-/Duplicate-/Copy-Job, Phishinglink, Massennachricht, Beschwerdevelocity;
- Reveal-/Export-Scraping, Enumeration und ungewöhnlicher Download;
- Payment-/Refund-/Chargeback-/Service-Recovery-Abuse;
- Admin-Selbstgrant, Grant Cache, SoD-Kollusion, Break-glass-Missbrauch,
  Trust-Case-Manipulation und unautorisierter Restore;
- Risk-Signal-Poisoning und diskriminierende/Proxy-sensitive Regel.

Alle automatischen Signale benötigen Negativ-, False-Positive-, Appeal- und
Insiderfälle. Geschützte Attribute oder unzulässige Proxies sind keine
Risikofeatures.

## 17. Externe und organisatorische Voraussetzungen

| Gate | Owner | Evidence |
| --- | --- | --- |
| Authenticator-/Recoverypolicy | Security | zugelassene Passkey/TOTP-Geräte, Device-Loss-/Recovery-Verfahren |
| Production RP-ID/HTTPS | Ops/Security | Phase-23-Stagingdomain, TLS und Origin-Konfiguration |
| Duties-/Capability-Matrix | Geschäfts-/Fachowner | benannte Personen je Support/Moderation/Finance/Privacy/Trust/Platform |
| Recovery/Break-glass | Security/Management | zwei getrennte Owner, On-call, Alarm- und Incident-Runbook |
| Risk-/Trustpolicy | Trust & Safety/Legal/Privacy | Signalkatalog, Zweck, Retention, Decision-/Appeal-SLA, DSFA-Entscheid |
| Operationskapazität | Ops/Commercial | Queue-/Reviewer-/Coverage-Modell nach `REQ-OPS-004` |

Ohne benannte getrennte Owner bleibt 25A/25C `BLOCKED BY EXTERNAL GATE`.

## 18. Interphase-Abhängigkeiten

- Phase 19 G0 und ADR-/Requirement-Synchronität;
- Phase 20 Identity, Reverification, Notification-Outbox und gemeinsame
  Assurance-Basis;
- Phase 22 Retention/Export/Erasure/Legal;
- Phase 23 HTTPS/RP-ID, Worker, Queue, Alerting und On-call;
- Phase 24 wartet mit Public Checkout/Finance-Reparatur auf 25A/B/C;
- Phase 26 nutzt 25C für compromised Company/rapid revoke;
- Phase 30D liefert Job-Freshness-/Duplicate-Signale;
- Phase 31A liefert Operationskapazität und kommerzielle Scopegrenzen;
- Phase 32 prüft nur aktivierte Teiltracks auf demselben Artefakt.

Phase 27 ist keine Abhängigkeit und wird nicht mit internem RBAC vermischt.

## 19. Geordnete Implementierungsschritte

1. ADR-036, vollständige Action×Assurance-, Role×Capability×Duties- und
   RiskSignal×Decision×Effect-Matrix freigeben.
2. Authenticator-, Grant-, StepUp-, Break-glass- und Trust-Safety-Schema additiv
   migrieren.
3. 25A WebAuthn/TOTP/Recovery und persistierte Capability Resolution
   implementieren.
4. alle Admin Pages, Reads und Mutations inventarisieren, dual beobachten und
   deny-by-default cutovern.
5. SoD, Vier-Augen, Sessionrevocation und zeitgebundenes Break-glass
   implementieren.
6. 25B zentrale StepUpPolicy/-Challenge/-Grant und non-admin Hochrisikoactions
   anbinden.
7. Login-E-Mail, Recovery, Billing/Team, Export/Delete, Consent/Reveal und
   direkte Action-Negativpfade integrieren.
8. 25C RiskSignal, RiskDecision, TrustSafetyCase/Event/Appeal zunächst
   observe-only implementieren.
9. Hold/Review/Revoke/Restore auf Sessions, Firma, Jobs, Messaging, Radar,
   Export und Payment mit fail-closed Reads anbinden.
10. UIs, Alerts, Queue/SLA, Runbooks und mobile/A11y-Zustände liefern.
11. Migration, Security, Recovery, False-Positive, Insider, Failure und
    Cross-role/-tenant Tests ausführen.
12. getrennte 25A-, 25B- und 25C-Canaries; kein gemeinsamer Big-Bang-Cutover.

## 20. Feature Flags, Kill Switch und Aktivierung

- persistierte Admin-Grants sind deny-by-default; es gibt keinen globalen
  All-Admin-Schalter;
- `ADMIN_MFA_REQUIRED=false`: Enrollment/Assurance bleibt in Local/CI vor
  externem Cutover nicht global erzwungen; in Preview/Staging/Production ist
  damit der gesamte Adminbereich gesperrt und kein Passwort-only-Fallback
  erreichbar;
- `PRIVILEGED_STEP_UP_MODE=disabled`: optional `observe`, danach actionweise
  `enforce`;
- `TRUST_RISK_MODE=observe`: optional `hold` erst nach Policy-/False-Positive-
  Freigabe;
- `BREAK_GLASS_ENABLED=false`: zeitgebundener Incident Grant;
- globale Kill Switches pausieren neue Grants, automatisierte Holds/Revoke oder
  einzelne Risk-Regeln, reaktivieren aber nie All-Admin/Step-up-Bypass.

Aktivierung je Track:
`DISABLED → OBSERVE → ALLOWLIST → ENFORCED/LIVE`. Jeder Übergang besitzt
False-Positive-, Lockout-, Queue-/Alert- und Rollback-Evidence.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle genannten automatisierten Testdateien sind implementiert. Die Matrix
weist den gezielten lokalen Stand aus; erst der vollständige commitgebundene
G3-Lauf erlaubt den Phasenabschluss.

| Criterion/Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P25A-AC-01` / `REQ-ADM-007` | P0: globale Adminvollmacht | Unit + PostgreSQL | Role×Capability×Action | nur explizite aktive Grants erlauben | role=ADMIN allein, fremde Duty, expired/revoked Grant, Direktaufruf | alle Adminrollen | Admin Pages/Commands | jede Rolle, 50 Capabilities, active/expired Grants | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/admin/admin-role-capability-matrix.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/admin/admin-grants-postgres.test.ts` | vollständige Matrix; unzulässige Kombinationen `0` Read/Write; role=ADMIN allein gewährt `0` | Matrix-/DB-Report | Security + Fachowner + QA | `LOCAL G3 PASS` |
| `P25A-AC-02` / `REQ-ADM-007` | P0: MFA-/Recovery-Bypass | Unit + E2E | WebAuthn/TOTP Enrollment/Login/Recovery | gültiger Faktor und single-use Recovery | falsche RP-ID/Origin, replay, expired challenge, TOTP replay, used code, last factor remove | Admin | Security UI/Auth | Passkey/TOTP/Recovery/Device-Loss Fixtures | Unit + Chromium | `npx vitest run --config vitest.config.ts tests/unit/auth/admin-mfa-recovery.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-admin-assurance.spec.ts --project=chromium-journeys` | jeder Token/Code höchstens 1 Erfolg; Negativfälle `0` Session-Assurance; Recovery auditiert | Vitest/Playwright/Audit | Security + QA | `LOCAL G3 PASS` |
| `P25A-AC-03` / `REQ-ADM-007` | P0: stale Grant/Session | PostgreSQL | Grant-/Authenticator-/User-Revocation | nächste Prüfung sperrt sofort | Cache, alte Session, direkter Command, parallel laufende Action | Admin/Security | Guards/Commands | grant/user/authenticator active→revoked, zwei Sessions | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/admin/admin-revocation-postgres.test.ts` | nach Commit der Revocation `0` weitere erlaubte Reads/Writes mit alter Session/Assurance | Transaction-/Audit-Report | Security | `LOCAL G3 PASS` |
| `P25A-AC-04` / `REQ-ADM-007` | P0: Kollusion/Selbstfreigabe/Lockout | PostgreSQL + E2E | SoD, Vier-Augen, Break-glass | zwei zulässige verschiedene Actors; zeitgebundener Incidentzugriff | gleiche Actor-ID, unvereinbare Duties, missing reason, expired TTL, stiller Legacy-Fallback | Security/Approver | Grant/Privacy/Finance/Trust | Actor A/B, duty conflicts, expired grants | real PostgreSQL + Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/admin/admin-sod-breakglass-postgres.test.ts`; manuell: Device-Loss-/Break-glass-Drill ohne DB-Edit | gleiche Actor-ID `0` Abschluss; Break-glass automatisch widerrufen und 1 Alert; kein Betreiber-Lockout im Drill | SoD-/Incident-/Alert-Record | Security + Management | `LOCAL G3 PASS; EXTERNAL DRILL BLOCKED` |
| `P25B-AC-01` / `REQ-ID-004` | P0: non-admin Hochrisikoaction via alte Session | Unit + PostgreSQL | StepUpPolicy/-Grant Binding | passender frischer Grant erlaubt genau eine definierte Action | stale/replay/cross-purpose/cross-tenant/cross-resource/role revoked | Candidate/Owner | zentrale Guards/Actions | alle Actionklassen, Company A/B, Candidate A/B | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/auth/step-up-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/security/non-admin-step-up-postgres.test.ts` | Negativfall `0` Wirkung; Grant kann nicht für andere Action/Tenant genutzt werden; Audit vollständig | Policy-/DB-/Audit-Report | Security + Domainowner | `LOCAL G3 PASS` |
| `P25B-AC-02` / `REQ-ID-004` | P0: Billing/Team/Reveal/Privacy ATO | E2E | reale Hochrisikojourneys | Owner/Candidate steppt up und Aktion wirkt einmal | direkte URL/Action, Cancel, expired challenge, anderer User/Company | Candidate/Employer Owner | Billing, Team, Privacy, Radar | seeded Candidate/Company A/B, stale/current grants | Chromium Desktop + 360 | `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-owner-candidate-step-up.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-owner-candidate-step-up.spec.ts --project=chromium-mobile-360` | je definierter Flow 1 Success; alle bypass/direct/cross-tenant Fälle 0 fachliche Wirkung; Axe serious/critical 0 | Playwright/Axe/Screenshots | Security + Candidate/Employer QA | `LOCAL G3 PASS` |
| `P25B-AC-03` / `REQ-ID-005` | P0: Recovery/E-Mail-Change übernimmt Konto | PostgreSQL + E2E | Login-E-Mail, Account Recovery, Sessionwiderruf | alte+neue Adresse policygerecht, neue reverified | unverified new mail, replay, attacker support, old session/grants | Candidate/Employer | Account Security/Outbox | verified/unverified/changed addresses, compromised session | real PostgreSQL + Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/security/account-recovery-step-up-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-account-recovery.spec.ts --project=chromium-journeys` | alte Session/Grants nach Abschluss `0` Wirkung; Tokens single-use; beide nötigen Notifications durable | DB-/Outbox-/E2E-Report | Identity + Security | `LOCAL G3 PASS` |
| `P25C-AC-01` / `REQ-TRUST-001` | P0/P1: Credential Stuffing/ATO unerkannt | Unit + PostgreSQL | Risk Decision Matrix | erlaubte Baseline; erhöhte Signale führen Step-up/Hold/Review | signal replay/poison, geschütztes Attribut, fremder Subject/Tenant | User/System/T&S | Risk Engine | velocity/session/device/complaint fixtures + false positives | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/security/trust-risk-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/trust/risk-decisions-postgres.test.ts` | jede Fixture genau erwarteter Decision-Code; geschützte/proxy-sensitive Inputs `0` Policyeinfluss; 1 Case je Dedupe-Key | Decision-Matrix/DB-Report | Trust & Safety + Privacy + Security | `LOCAL G3 PASS` |
| `P25C-AC-02` / `REQ-TRUST-001` | P0: kompromittierte VERIFIED Company bleibt sichtbar | PostgreSQL + E2E | Rapid Hold/Revoke | bestätigter Incident sperrt Sessions/Badge/Jobs/Radar/Payment | unbestätigtes Signal allein löscht irreversibel; stale Read/worker delay | T&S/Company/User | Trust Case + Public/Employer/Radar | verified Company, public jobs, Radar, sessions, incident | real PostgreSQL + Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/trust/compromised-company-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-trust-safety.spec.ts --project=chromium-journeys` | nach committed REVOKE nächster Read: Badge/Job/Radar `0` eligible, Sessions/risky actions denied; History/Audit erhalten | Cross-domain-State-/E2E-Report | Trust & Safety + Company/Jobs/Radar | `LOCAL G3 PASS` |
| `P25C-AC-03` / `REQ-TRUST-001` | P1: Fake-/Duplicate-Job, Scam, Massennachricht | Unit + PostgreSQL | Signal→Case→Hold | begründete Velocity/Complaint/Duplicate-Signale öffnen bounded Case | einzelne legitime Nachricht/ähnlicher Job; Cross-Tenant-Signal; enumeration | Employer/T&S | Jobs/Messaging/Case Queue | fake/legit/near-duplicate jobs, message bursts, complaints | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/trust-safety/scam-signal-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/trust/scam-cases-postgres.test.ts` | Dedupe-Key erzeugt 1 Case; legitime Kontrollgruppe ohne Auto-Revoke; Held Content verschwindet fail-closed | Policy-/Case-/Eligibility-Report | Trust & Safety + Moderation | `LOCAL G3 PASS` |
| `P25C-AC-04` / `REQ-TRUST-001` | P0/P1: Reveal/Export/Payment Fraud | PostgreSQL | Cross-domain Risk Hold | anomalous flow gehalten und domain-spezifisch reviewed | normale Nutzung, replayed Signal, Support versucht Override | Candidate/Owner/Finance/T&S | Radar/Export/Billing | bounded normal/abuse cohorts, Company A/B | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/trust/high-risk-domain-actions-postgres.test.ts` | High Risk: `0` Reveal/Export/Fulfillment bis Decision; normaler Flow unverändert; Override nur Capability+Step-up+Audit | Cross-domain-/Audit-Report | Trust & Safety + Privacy + Finance | `LOCAL G3 PASS` |
| `P25C-AC-05` / `REQ-TRUST-001` | P1: False Positive ohne Rechtsbehelf | PostgreSQL + E2E | Appeal/Restore/Expiry | berechtigte Person sieht sicheren Grund, reicht Appeal ein, unabhängiger Review | Caseowner entscheidet eigenen Appeal; Secret-Leak; Restore ohne Reverification | User/T&S Approver | Trust Case/Appeal UI | held/expired/restored cases, Actor A/B | real PostgreSQL + Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/trust/trust-appeal-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase25-trust-appeal.spec.ts --project=chromium-journeys` | 1 Appeal je offene Decisionversion; gleicher Actor `0` Final Approval; Restore erst nach gültigen Preconditions; keine geheimen Signale im DTO | Appeal-/DTO-/E2E-Report | Trust & Safety + Legal/Privacy | `LOCAL G3 PASS` |
| `P25-AC-13` / `REQ-QA-003` | P0: unsicherer Legacy-/Teilbackfill | Migration | empty/upgrade/partial/idempotent | minimale explizite Grants und sichere observe-only Daten | Default-All-Grant, orphan Grants, duplicate factors, partial Case | System/DBA | leere DB + alle Legacyrollen + partial states | isoliertes PostgreSQL | `npm run db:migrate`; `npm run db:migrate:status`; `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase25-security-migration-postgres.test.ts` | Default-All-Grant `0`; Orphans/Duplicates `0`; Wiederholung 0 Zusatzwirkung; Count/Tenant-Abweichung 0 | Migration-/Backfill-Manifest | Security + Data/DBA | `LOCAL G3 PASS; CLEAN-CLONE VERIFIED` |
| `P25-AC-14` / `REQ-QA-003` | P1: Sicherheits-UX unzugänglich | E2E + A11y | Enrollment/Step-up/Case/Appeal mobile | alle Zustände per Tastatur/Screenreader | Locked/Error/Expired/Conflict ohne Fokus/Erklärung | Admin/Candidate/Owner/T&S | Security-/Trust-UIs | alle UX-Zustände, Desktop/360 | Chromium Desktop + 360 | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase25-security-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase25-security-quality.spec.ts --project=chromium-mobile-360` | Axe serious/critical 0; kritische Action/Fokus/Status ohne horizontales Clipping; keine Secret-/Risk-Leaks | Playwright/Axe/Screenshots | UX + Accessibility + Security | `LOCAL G3 PASS` |
| `P25-AC-15` / `REQ-OPS-005` | P0: Alert/Expiry/Revocation fällt aus | Failure/Operations | Worker crash, queue delay, pager | fail-closed Reads schützen trotz Worker-Restart | poison event, delayed alert, duplicate expiry/revoke | System/Ops/T&S | Worker/Queue/Alerts | due grants/cases/revokes + Fault Injection | Staging | `npx vitest run --config vitest.integration.config.ts tests/integration/trust/trust-worker-failure-postgres.test.ts`; manuell: Worker stop/restart, Poison→DLQ, Alert→Ack→Escalation | fachliche Doppelwirkung 0; fail-closed Read unmittelbar; DLQ/age Alert innerhalb freigegebener SLO | Failure-/Pager-/Runbook-Record | Ops + Trust & Safety + Security | `LOCAL G3 PASS; STAGING PAGER DRILL BLOCKED` |

### Phase-25 Audit-log extension matrix

Die 26 neuen kanonischen Actions erweitern die unveränderlichen Phase-16-,
Phase-22- und Phase-24-Matrizen. TypeScript, Prisma-Enum, Metadata-Allowlist
und die vier Matrizen werden gemeinsam durch den Audit-Contract-Test
abgeglichen.

| Audit Actions | Owning Workflow |
| --- | --- |
| `ADMIN_ROLE_ASSIGNMENT_REQUESTED` / `ADMIN_ROLE_ASSIGNMENT_APPROVED` / `ADMIN_ROLE_ASSIGNMENT_REVOKED` | persistierte Rollenzuweisung mit Vier-Augen-Freigabe und Widerruf |
| `ADMIN_CAPABILITY_GRANT_REQUESTED` / `ADMIN_CAPABILITY_GRANT_APPROVED` / `ADMIN_CAPABILITY_GRANT_REVOKED` | zeitgebundener Direct Grant mit Vier-Augen-Freigabe und Widerruf |
| `AUTHENTICATOR_ENROLLMENT_STARTED` / `AUTHENTICATOR_ACTIVATED` / `AUTHENTICATOR_USED` / `AUTHENTICATOR_REVOKED` | Passkey-/TOTP-Enrollment, Nutzung und Faktorwiderruf |
| `AUTHENTICATOR_RESET_REQUESTED` / `AUTHENTICATOR_RESET_APPROVED` | SoD-gebundener Device-Loss-/Authenticator-Reset |
| `RECOVERY_CODES_ROTATED` / `RECOVERY_CODE_USED` | gehashte Single-use-Recovery-Codes |
| `SESSION_ASSURANCE_GRANTED` / `SESSION_ASSURANCE_REVOKED` | aktuelle AAL2-Session-Assurance |
| `STEP_UP_CHALLENGE_CREATED` / `STEP_UP_GRANT_ISSUED` / `STEP_UP_GRANT_CONSUMED` | actor-/session-/purpose-/action-/tenant-/resource-gebundener Step-up |
| `BREAK_GLASS_REQUESTED` / `BREAK_GLASS_ACTIVATED` / `BREAK_GLASS_REVOKED` | zeitgebundener Incidentzugriff |
| `RISK_SIGNAL_RECORDED` / `RISK_DECISION_RECORDED` | minimiertes versioniertes Signal und Policyentscheid |
| `TRUST_SAFETY_CASE_CHANGED` / `TRUST_SAFETY_APPEAL_CHANGED` | Case, Hold/Revoke, Appeal und unabhängiges Restore |

## 22. Performance und Scale

- Capability-/Step-up-Prüfung fügt im Staging p95 höchstens `25 ms` DB-/Cache-
  Overhead pro geschützter Action hinzu; Revocation darf nicht durch einen
  langlebigen Allow-Cache verzögert werden.
- Challenge-/Grant-Lookups sind indexiert und bounded; keine lineare Suche über
  historische Events.
- Trust-Safety-Queue besitzt Keyset-Pagination, Severity/Freshness-Tiebreaker
  und keine harte unerreichbare Cap.
- Riskfenster werden mit bounded Aggregaten/Indizes ausgewertet; keine
  uneingeschränkten Eventscans im Requestpfad.
- Für LC3/LC4 werden Arrival Rate, p50/p95 Handling Time, Queue Age,
  False-Positive-/Appealrate, Reviewer Capacity und Incident SLA nach
  `REQ-OPS-004` freigegeben.
- Rapid Revoke ist im Code beim nächsten Read wirksam; operative
  Incident-Erkennung/Ack/Decision erhält vor Aktivierung eine konkrete, von
  Ops/Trust freigegebene Minuten-SLO.

## 23. Geschützte Phase-01–18-Invarianten

- Phase 03/16: Auth-/Audit-/Rate-Limit-/Redaction-Policies bleiben fail-closed;
- Phase 06: Sessions, globale historische Rolle, Company Claim und sichere
  Redirect-/Tenantgrenzen werden additiv migriert;
- Phase 09/14: Candidate Ownership, Consent, Radar-Anonymität und Reveal;
- Phase 10: Membership, Assignment, Seat, Invitation, Last-Owner-Schutz;
- Phase 11: vorhandene Capability-Seams und Admin-Operations;
- Phase 12: Billing-/Ledger-Autorität bleibt unverändert;
- Phase 15: Public Eligibility und Cluster Dual Approval;
- Phase 16: CSRF, IDOR, no-store, Audit und Abuse Intake;
- Phase 17/18: Cross-role/Tenant E2E, Zero Retry, Recovery und ehrliche
  Aktivierungsgrenze.

Kein neuer Grant, Persona Context oder Riskentscheid darf eine bestehende
Ownership-/Tenantprüfung ersetzen.

## 24. Rollback und Roll-forward

- 25A Rollback pausiert Adminbetrieb oder nutzt kontrolliertes Break-glass;
  niemals stilles All-Admin;
- 25B-Policy kann actionweise auf `DISABLED/OBSERVE` zurück, aber eine bereits
  als hochriskant freigegebene LIVE-Aktion darf nicht ungeschützt reaktiviert
  werden;
- 25C automatisierte Holds/Revoke können per Signalgruppe pausiert werden;
  bereits entschiedene Cases/Revocations werden nicht gelöscht;
- Authenticator-/Grant-/Case-Schema bleibt bis Contract additiv;
- Session-/Grant-Revoke und extern sichtbarer Trustverlust werden vorwärts
  reconciliiert; Datenbankrollback darf alte Rechte nicht wiederbeleben;
- Restore nach False Positive braucht fachliche Reverification und Audit;
- Migration-/Cutover-Drill umfasst Betreiber-Lockout, N-1-App, Cache, Worker und
  Kill Switch.

## 25. Benötigte Evidence und Artefakte

- Role×Capability×Action×Duties-Matrix und benannte Owner;
- Authenticator-/Recovery-/Device-Loss-Contract und Drill;
- StepUp Action Matrix für alle Candidate-/Employer-/Finance-/Privacyactions;
- RiskSignal×Decision×Effect×Appeal-Matrix und Datenschutzfreigabe;
- Migration-/Backfill-/Default-Grant-Abgleich;
- Security-, Direct-Action-, Cross-role-/tenant-, Replay-, False-Positive- und
  Insider-Testreports;
- Browser-/360-/A11y-Artefakte;
- Queue-/Handling-Time-/False-Positive-/Appeal-/Incident-Kapazitätsmodell;
- Break-glass-, Rapid-Revoke-, Worker-/Pager-/Kill-Switch-Drills;
- Commit-/Artefakt-Digest und getrennte Aktivierungsentscheidung je 25A/B/C.

## 26. Definition of Done

- 25A: kein Admin erhält wegen globaler Rolle pauschal Rechte; MFA, Recovery,
  Grants, SoD und Break-glass sind vollständig implementiert und getestet.
- 25B: jede inventarisierte Hochrisikoaction besitzt zentralen, serverseitigen
  und tenantgebundenen Step-up-Vertrag samt direktem Negativpfad.
- 25C: Signale, Cases, Hold/Review/Revoke, Appeal, False Positive,
  domain-spezifische schnelle Wirkung und Operations sind vollständig.
- Jede AC-Zeile ist `PASS` oder begründet `N/A`; keine Pflichtprüfung ist
  skipped/retried.
- Migration, Lint, Typecheck, Build, Owning Unit-/PostgreSQL-/E2E-/Security-
  Suites und G3 laufen auf demselben Commit.
- Technik-, Quality- und Aktivierungsstatus werden je Track getrennt erfasst.

Externe Owner, Staging-RP-ID oder Operationsgates können einen technisch
bestandenen Track weiterhin auf `BLOCKED BY EXTERNAL GATE` halten.

## 27. Quality-Gate für abhängige Phasen

- Phase 24 Public Checkout/Finance-Reparatur benötigt 25A und 25B; Payment-
  Fraud-/Chargeback-/Recovery-Aktivierung zusätzlich 25C.
- Phase 26 Badge/Public Jobs/Radar benötigt 25A Reviewrechte, 25B
  Owner-Hochrisikoaktionen und 25C compromised-company/rapid-revoke.
- Phase 27 ist kein Nachfolgergate; es bleibt unabhängig `DEFERRED`.
- Phase 28/30D aktivierte Messaging-/Job-/Exportpfade benötigen ihre
  25B/25C-Action-/Signalintegration.
- Phase 32 darf LC3–LC6 nur freigeben, wenn alle im Launchscope berührten
  Phase-25-Teiltracks G3 und reale Owner-/Operationsgates besitzen.

## 28. Was diese Phase nicht beweist

Phase 25 beweist nicht:

- dass eine Firma rechtlich oder fachlich verifiziert ist — Phase 26;
- dass ein Signal Betrug zweifelsfrei beweist oder automatische irreversible
  Sanktionen rechtfertigt;
- dass Login-E-Mail-Verifikation allein MFA/Step-up ersetzt;
- dass Multi-Persona erforderlich oder sicher implementiert ist;
- dass Provider, Pager, Reviewer Capacity oder On-call produktiv betrieben
  werden;
- dass Paid-, Radar-, Job- oder Recruitingprodukte Marktbedarf besitzen;
- eine allgemeine Legal-/Privacy-/DSFA- oder LIVE-Freigabe.

Sie liefert die Sicherheits- und Operationsgrundlage; reale Aktivierung bleibt
pro Domain, Launchklasse und externem Gate separat.
