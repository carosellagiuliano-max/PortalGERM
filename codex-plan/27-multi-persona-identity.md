# Phase 27 — Multi-Persona-Identity und Portalwechsel

## 1. Status

| Dimension | Status |
| --- | --- |
| Planstatus | `TECHNISCH ABGESCHLOSSEN; DEMAND-GATE OFFEN` |
| Technikstatus | `LOCAL/CI CONTRACT IMPLEMENTIERT UND VERIFIZIERT` |
| Quality-Gate | `LOCAL G3 PASS; EXTERNES G4 OFFEN` |
| Aktivierung | `DISABLED` |

Technische Abnahme:
[Phase-27-Evidence](./evidence/2026-07-28-phase-27.md).

Phase 27 liegt weiterhin **nicht** auf dem kritischen Markt-/Launchpfad. Der
Repository-Owner hat am 28. Juli 2026 den vollständigen technischen Scope
ausdrücklich aktiviert. Das erlaubt einen additiven, standardmässig
deaktivierten Local-/CI-Vertrag, ersetzt aber weder moderierte Demand-Evidence
noch Product-, Security-, Privacy- oder Operationsfreigaben. Allgemeine
Aktivierung, Marketingclaim und Launchscope bleiben deshalb `DISABLED`.

## 2. Ziel und messbarer Business-/Nutzerwert

Der technische Vertrag ermöglicht einer Person Candidate- und
Company-Kontexte ohne doppelte E-Mail-Konten, fragmentierte
Privacy-Historie oder automatische Rechteerweiterung. Interne Adminrollen und
Company-Tenantautorität bleiben strikt getrennt. Ob und für welche Kohorte
dieser Vertrag aktiviert werden darf, entscheidet weiterhin die reale
Forschung.

Der erste messbare Zielwert ist deshalb nicht Code, sondern ein
preregistrierter Demand-Entscheid:

- mindestens `12` moderierte Zielnutzer aus Candidate-/Employersegmenten;
- davon mindestens `6` mit belegtem Candidate-plus-Company-Bedarf in den
  letzten zwölf Monaten, verteilt auf mindestens `3` Firmen;
- Task-, Häufigkeits-, Abbruch-, Support- und Datenschutzschaden werden
  protokolliert;
- bestehende Alternativen (separates Konto, Invitation/Account-Linking,
  kontextklarer Login) werden mitgetestet;
- `GO` nur, wenn mindestens `4/6` der qualifizierten Dual-Persona-Nutzer am
  heutigen Vertrag einen materiellen Blocker erleben, eine günstigere
  Mitigation die Kernaufgabe nicht sicher löst und Product, Security, Privacy
  sowie Engineering den XL-Blast-Radius schriftlich akzeptieren.

Die Schwelle wird vor Research eingefroren. Wird sie verfehlt, lautet der
Markt-/Aktivierungsentscheid `NO-GO / DEFERRED`; der deaktivierte technische
Vertrag bleibt dann unsichtbar und wird nicht als Produktversprechen genutzt.

## 3. Tatsächlicher Repositoryzustand

- `User.role` bleibt als N-1-Kompatibilitätsfeld erhalten; fachliche
  Candidate-/Employer-Berechtigung wird additiv durch `PersonaAssignment`
  und den gebundenen Sessionkontext abgebildet.
- Eine bestehende Identity kann nach aktueller Invitation-, Seat-, Role-,
  Membership- und Step-up-Prüfung eine Employer-Persona erhalten.
- Company Membership und Job Assignment unterstützen bereits mehrere Firmen
  tenant-sicher und sind die Autorität des Employer-Portals.
- Das ist kein aktueller Cross-Tenant-Defekt und kein Launchblocker für einen
  bewusst segmentierten ersten Cluster.
- Der Umbau berührt Auth, Session, Registration, Invitation, Safe Next,
  Navigation, Candidate/Employer/Admin Guards, Privacy, Audit, Analytics,
  Notifications, Suspension, Seeds und nahezu alle Cross-role-Tests.
- Der aktive Persona-/Portal-/Company-Kontext ist auf der Session persistiert
  und versioniert; Contextwechsel widerruft gebundene Step-up-Grants.
- `/account/portal` sowie Candidate-/Employer-Navigation zeigen nur
  serverseitig autorisierte Kontexte.
- Audit, Analytics, Notification, Suspension und identity-weite
  Privacy-Projektion sind integriert.
- Demand-Evidence, externe Owner-Sign-offs, Staging-Canary und
  Marktaktivierung fehlen weiterhin.

## 4. Findings und Requirements

| ID | Vertrag |
| --- | --- |
| `STH-012` | exklusive globale Rolle verhindert bestimmte sichere Doppelrollen |
| `REQ-PER-001` | Technik nur nach expliziter Owner-Scope-Aktivierung; Marktaktivierung nur nach Demand-Go |
| `REQ-UX-003` | moderierte Nutzerforschung und messbare Demand-Evidence |
| `REQ-ID-004` | Persona-/Portalwechsel ersetzt keine Step-up- oder Hochrisikoprüfung |
| `REQ-ADM-007` | interne Admin-Grants bleiben getrennt |
| `REQ-PRIV-004` | Export/Erasure muss bei einem Go identity-weit funktionieren |
| `REQ-QA-003` | vollständiger 28-Punkte-/AC→Test-Vertrag für einen aktivierten Track |

Der Demand-Entscheid erhält eine datierte stabile Decision-ID mit Scope,
Stichprobe, Rohdatenminimierung, Schwelle, Resultat, Owner und Ablaufdatum.

## 5. In Scope

### Demand-/Aktivierungsscope — weiterhin offen

- preregistrierte moderierte Research mit qualifizierten Dual-Persona-Nutzern;
- Analyse realer Invitation-, Login-, Portal-, Support-, Consent- und
  Datenschutzprobleme;
- Vergleich günstigerer Alternativen;
- Security-/Privacy-/Migration-/Support-Blast-Radius und Kostenabschätzung;
- dokumentierter `GO`, `NO-GO` oder zeitlich begrenztes `DEFERRED`.

### Technischer Owner-Scope — implementiert und default-off

- Identity getrennt von fachlicher Persona und interner Plattformrolle;
- optionale Candidate Persona/Profile sowie null bis viele Company
  Memberships pro Identity;
- expliziter aktiver Persona-/Portal-/Company-Kontext und sichere Default Route;
- Registration, Invitation, Login, Safe Next und Portal Switch;
- additive Migration der Legacyrollen ohne Rechteausweitung;
- identity-weiter Privacy Export/Delete/Correction;
- Session-/Audit-/Analytics-/Notification-Kontext und Suspension-Semantik;
- manuelle, step-up-/auditpflichtige Behandlung echter Duplicate-/Mergefälle.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- öffentliche Aktivierung, Marketingclaim oder breite Kohorte vor Demand-Go;
- Ersetzen von Company Membership/Job Assignment durch globale Persona;
- Vermischen interner Adminrollen/Capabilities mit Candidate-/Employerpersona;
- automatische Accountzusammenführung anhand Name, Domain oder ähnlicher
  E-Mail-Adresse;
- Shared Accounts, impersonation oder frei wählbarer Tenant aus Clientinput;
- Agenturmandate/`REQ-REC-002`, SSO/SCIM, ATS, Success Fee;
- generisches Household-/Family-/Organization-Identity-Modell;
- Pflichtabhängigkeit für Phase 24, 26, 28, 30, 31 oder den ersten Launch.

Bei `NO-GO` bleiben alle Multi-Persona-Claims aus Marketing und aktiviertem
Launchscope absent; die technischen Flags bleiben `DISABLED`.

## 7. Benutzerrollen und organisatorische Owner

- Research: Candidate, Employer Owner/Admin/Recruiter und Personen mit
  tatsächlichem Dual-Persona-Bedarf;
- im ausdrücklich aktivierten technischen Owner-Scope: Identity mit optionaler Candidate Persona und null bis
  vielen Company Memberships;
- Company Owner/Admin/Recruiter/Viewer bleiben pro Company;
- interne Adminrollen/Grants bleiben eigenständige Phase-25-Autorität;
- Product Owner besitzt Demand-/Scope-Go;
- Identity Engineering besitzt Schema/Auth/Session;
- Security besitzt Context-/Safe-Next-/ATO-/Step-up-Vertrag;
- Privacy besitzt identity-weite Rechte und Re-consent;
- Support besitzt Recovery-/Duplicate-/Mergeprozess;
- QA/Release besitzt Cross-persona/-tenant Regression.

Kein einzelner Fachowner darf den `GO` ohne Product-, Security-, Privacy- und
Engineering-Sign-off erteilen.

## 8. Portale, Routen, Services, Provider und Worker

Ohne ausdrückliche technische Owner-Scope-Aktivierung wird **keine geplante
Route implementiert oder in das Ist-Inventar aufgenommen.**

Im ausdrücklich aktivierten technischen Owner-Scope entstand ein versioniertes
Route Delta für:

- Portal-/Persona-Auswahl nach Login und in Candidate-/Employer-Navigation;
- bestehende Candidate-/Employer-/Admin-Layouts und Default Destinations;
- Registration/Invitation/Accept-/Account-Recovery-Flows;
- Settings/Privacy für identity-weite Ansicht;
- kein eigener frei autorisierender „switch tenant“-API-Endpunkt.

Betroffene Services nur bei `GO`:

- `lib/auth/**`, Current Identity/Context/Safe Next/Session;
- `lib/employer/team.ts`, Invitation und Company Context;
- Candidate-/Employer-/Admin-Guards und Navigation;
- Privacy, Audit, Analytics, Notifications, Suspension;
- Seeds, Testfixtures und Cross-role-Journeys.

Es entsteht kein neuer externer Providerbedarf allein durch Phase 27.

## 9. Datenmodelle, Constraints, Indizes und Datenklassifikation

Ohne ausdrückliche technische Owner-Scope-Aktivierung: keine Schemaänderung.

Im ausdrücklich aktivierten technischen Owner-Scope entschied ADR-039 den
additiven Vertrag. Seine Zielinvarianten:

- eine `Identity`/bestehende `User`-Identität mit optionalen versionierten
  `PersonaAssignment`-Datensätzen;
- Candidate Profile höchstens einmal je Identity;
- Company Membership bleibt pro Identity+Company die Tenantautorität;
- Internal Admin Role/Grant bleibt separat;
- aktiver Portal-/Company-Kontext ist Session-/Requestkontext, keine
  Berechtigung;
- keine automatisch grantable Persona aus E-Mail-Domain, Invitation oder
  Navigation;
- Audit speichert Actor Identity plus expliziten fachlichen Context;
- Analytics minimiert/pseudonymisiert Context und vermischt keine Candidate-
  PII mit Companysicht.

Constraints/Indizes müssen Candidate-Persona-Eindeutigkeit,
Membership-Eindeutigkeit, aktive Persona-Version, Invitation Lookup und
Migration/Dedupe sicher unterstützen.

## 10. Migration, Backfill und Kompatibilität

Ohne ausdrückliche technische Owner-Scope-Aktivierung: keine Migration.

Im ausdrücklich aktivierten technischen Owner-Scope:

1. Identity-/Persona-ADR, vollständige Ist-Guard-/Route-/Datenmatrix und
   expand–migrate–contract Plan;
2. additive Persona-/Context-Relationen; Legacy `User.role` bleibt zunächst
   lesbar;
3. Backfill aller Candidate/Employer/Recruiter/Admin-/suspendierten Fälle ohne
   neue Persona oder Grants;
4. Dual Read/Comparison Telemetry, keine automatische Persona;
5. Invitations für bestehende Candidate Identity erst hinter serverseitigem
   Cohort Flag;
6. alte und neue Session-/Safe-Next-/Guardpfade parallel negativ testen;
7. leere DB, vollständige Bestandsfixture, partial/interrupt/repeat, N-1 App,
   Count/Orphan/Tenant/Consent/Audit-Abgleich;
8. Legacy Role erst nach Reverse-Check und G3 contracten;
9. Restore-/Rollbackprobe vor destruktivem Contract;
10. unauflösbare Duplicate-/Consentkonflikte in manuelle Need-to-know Queue.

## 11. Server-, Worker-, Queue- und Providervertrag

Ohne ausdrückliche technische Owner-Scope-Aktivierung: kein neuer
Server-/Workervertrag.

Im ausdrücklich aktivierten technischen Owner-Scope:

- Authentisierung löst Identity; jede fachliche Query prüft Persona,
  Membership, Assignment, Ownership, Status und Tenant separat;
- Context Switch wählt nur eine Oberfläche und rotiert/bindet Sessionkontext;
  er erteilt keine Persona, Membership oder Capability;
- Safe Next akzeptiert nur erlaubte interne Ziele des aktuell autorisierten
  Context;
- Invitation kann eine bestehende Identity adressieren, grantet aber erst nach
  serverseitiger Annahme und aktueller Company-/Seat-/Rolepolicy;
- Candidate-Daten gelangen nur über Application-/Radar-Reveal-Vertrag in
  Companysicht;
- Suspension: User/Identity global, Candidate Persona fachlich oder Company
  Membership tenantlokal nach expliziter Matrix;
- Duplicate-/Merge-/Recovery-Fälle sind idempotent, step-up-, assignment- und
  auditpflichtig; kein Provider entscheidet Autorisierung;
- Backgroundarbeit ist nur für Notifications/Retention/Comparison nötig und
  folgt Phase 23.

## 12. UX-Zustände

Ohne ausdrückliche technische Owner-Scope-Aktivierung: keine Multi-Persona-UI.

Im ausdrücklich aktivierten technischen Owner-Scope besitzen Portalwahl,
Invitation, Context Switch und Recovery:

- **Loading:** aktuelle Personas/Memberships serverseitig laden;
- **Empty:** keine zweite Persona/Membership, ohne falschen CTA;
- **Locked:** Persona suspended, Membership inaktiv, Step-up/Re-consent nötig;
- **Pending:** Invitation, Personaaktivierung, Support-Duplicate-Fall;
- **Error:** sichere generische Antwort ohne Account-/Company-Enumeration;
- **Retry:** retriable Invitation/Context-Refresh ohne Doppelgrant;
- **Conflict:** stale Membership, paralleler Switch, Duplicate Account,
  widersprüchlicher Consent;
- **Expired:** Invitation, Step-up, Support-/Linking-Token;
- **Cancelled:** Nutzer bricht Aktivierung/Switch ab, aktueller Context bleibt;
- **Success:** aktiver Persona-/Company-Kontext klar sichtbar, Rückwechsel
  möglich.

Jede Seite zeigt „in welchem Kontext handle ich?“ ohne Candidate-/Companydaten
des anderen Contexts vorab zu leaken.

## 13. Mobile und Accessibility

Im ausdrücklich aktivierten technischen Owner-Scope:

- Portal-/Company-Switcher funktioniert bei 360 px, Touch, Tastatur und
  Screenreader;
- aktiver Context ist semantisch benannt, nicht nur Icon/Farbe;
- Switch öffnet kein unzugängliches verschachteltes Menü und setzt Fokus
  nachvollziehbar;
- Invitation/Locked/Conflict/Recovery-Zustände besitzen klare Headings und
  nächste Schritte;
- mobile Navigation zeigt nie Links, die der aktive Context serverseitig nicht
  nutzen darf;
- mehrere Company Memberships bleiben ohne horizontale wide-only-Tabelle
  auswählbar;
- Phase 29B und die freigegebene Browser-/AT-Matrix sind Abschlussgate.

## 14. Authentisierung, Step-up, Autorisierung und Tenant

- Identity/Auth allein autorisiert keine Persona-/Companyaktion;
- Candidate Persona, Company Membership, Job Assignment, Companyrolle und
  Admin Grant werden getrennt serverseitig geprüft;
- Contextparameter aus URL/Form/Client sind untrusted;
- Company A/B bleibt bei jeder Query/Mutation isoliert;
- Persona Switch rotiert/bindet Sessionkontext und invalidiert stale
  action-bound Grants, wenn Purpose/Tenant/Resource wechselt;
- Personaanlage, Accountlinking/-merge, Login-E-Mail, Owner/Billing, Export/
  Delete und kritischer Consent folgen Phase-25B-StepUpPolicy;
- Admin Grants entstehen nie aus Persona oder Company Membership;
- sichere 404/deny, no-store, CSRF und Safe Next bleiben erhalten;
- Suspensions- und Recoverymatrix wird vor Code freigegeben.

## 15. Datenschutz, Retention, Export, Löschung und Audit

- eine Identity besitzt eine nachvollziehbare Consent-/Privacy-Historie mit
  fachlichem Persona-/Companykontext;
- Export/Correction/Delete inventarisiert alle Personas, Profiles,
  Memberships, Applications, Radar, Messages, Notifications und zulässige
  Admin-/Security-Evidence;
- Companydaten/gesetzlich gebundene Records werden nicht wegen Candidate-
  Löschung unzulässig gelöscht; Candidate PII wird nicht wegen Companyrolle
  breiter sichtbar;
- Accountlinking/-merge braucht freigegebene Rechtsgrundlage, frische
  Authentisierung, Konfliktpreview und Audit;
- Analytics trennt actor identity, persona context und company tenant
  pseudonymisiert; keine Cross-context PII;
- Support-/Duplicate-Queue ist need-to-know, retained und export-/deletefähig
  nach Phase-22-Matrix;
- Re-consent wird bei geänderter Zweck-/Persona-Semantik versioniert.

## 16. Abuse-, Fraud-, ATO-, Replay- und Insider-Szenarien

- ATO wechselt in Employercontext und greift Billing/Team/Radar an;
- Candidate versucht durch Persona Switch Company Membership/Admin Grant zu
  erzeugen;
- Employercontext liest Candidateprofil ohne Application/Reveal;
- manipulierte `personaId`, `companyId`, `next` oder Invitation;
- Invitation Replay, Role-/Seat-Änderung zwischen Issue/Accept, fremde E-Mail;
- Session-/StepUpGrant-Replay über Contexts/Tenants;
- Merge gleichnamiger/ähnlicher Accounts, Support Social Engineering und
  unzulässiger Consenttransfer;
- Company-A-Sicht nach Switch zu Company B, stale Cache oder parallele Tabs;
- Suspension einer Persona eskaliert fälschlich global oder umgekehrt;
- Insider/Admin verknüpft Identitäten ohne Need-to-know/SoD/Audit.

Jeder zulässige Flow hat Cross-persona-, Cross-company-, direkte Action-,
Replay-, stale-Session- und Support-Abuse-Gegenfälle.

## 17. Externe und organisatorische Voraussetzungen

### Demand-Gate

| Gate | Owner | Evidence |
| --- | --- | --- |
| preregistrierte Research | Product/UX Research/Privacy | Zielgruppe, Stichprobe, Tasks, Schwellen, Einwilligung, Datensparsamkeit |
| Bedarf/Alternative | Product/Support | Task-/Abbruch-/Supportdaten und getestete günstigere Mitigation |
| Security-/Privacy-Blast-Radius | Security/Privacy | Threat Model, Context-/Recovery-/Consent-/Exportmatrix |
| Engineering/Operations Cost | Engineering/Ops | Migration-, Test-, Support-/Merge-/On-call-Aufwand |
| Scope-Decision | Product+Security+Privacy+Engineering | datiertes `GO`, `NO-GO` oder `DEFERRED` mit Ablauf |

Die technische ADR und additive Migration wurden durch die explizite
Owner-Scope-Aktivierung erstellt. Demand-, externe Provider- und allgemeine
LIVE-Gates werden dadurch nicht geschlossen.

## 18. Interphase-Abhängigkeiten

Research kann nach Phase 19 parallel beginnen und benötigt `REQ-UX-003`.

Der technische Owner-Scope baute auf folgenden abgeschlossenen Verträgen auf:

- Phase 20: verifizierte Identity, Reverification, Recovery, Outbox;
- Phase 22: identity-weite Privacy-/Consent-/Erasure-Matrix;
- Phase 25A/B/C: getrennte Admin-Grants, Step-up und ATO/Trust;
- Phase 23: Worker/Alerts für einen aktivierten Scope;
- Phase 29B: finale UX/Mobile/A11y;
- Phase 32: Release-Evidence, falls Phase 27 tatsächlich im Launchscope ist.

Phase 27 blockiert Phase 24, 26, 28, 30, 31 und den ersten segmentierten Launch
nicht. Sie darf nach einem `NO-GO` nicht als versteckte Voraussetzung
zurückkehren.

## 19. Geordnete Implementierungsschritte

### Discovery — vor jeder Marktaktivierung

1. Researchplan, Qualifikationskriterien, Alternativen, Schwellen und Consent
   preregistrieren.
2. mindestens zwölf moderierte Sessions und Support-/Journeyanalyse ausführen.
3. Security-/Privacy-/Migration-/Operations-Blast-Radius und günstigere
   Mitigations bewerten.
4. datierten `GO|NO-GO|DEFERRED`-Entscheid veröffentlichen.
5. Bei `NO-GO/DEFERRED`: keine Kohorte, keine sichtbare Produktbehauptung und
   alle technischen Flags `DISABLED`.

### Technik — durch Owner ausdrücklich aktiviert

6. Identity-/Persona-/Context-/Suspension-/Privacy-ADR und vollständige
   Route×Role×Tenant×Action-Matrix freigeben.
7. additive Schema-/Backfill-/Compatibility-Migration implementieren.
8. Current Identity, Persona Context, Company Context und Safe Next.
9. Registration/Invitation/Accept/Recovery auf Identity-Lifecycle umstellen.
10. Guards/Repositories auf Persona plus Membership/Assignment/Ownership
    migrieren.
11. Navigation/Portal-/Company-Switcher und alle UX-Zustände.
12. Privacy, Audit, Analytics, Notifications, Suspension und Duplicate Queue.
13. Migration-/Rollback-, Cross-persona/-tenant-, Security-, E2E- und
    Mobile/A11y-Gates.
14. kleine Allowlist-Canary erst nach Demand-Go; keine allgemeine Aktivierung
    vor G3/G4 und den externen Owner-Sign-offs.

## 20. Feature Flags, Kill Switch und Aktivierung

Der deaktivierte technische Vertrag besitzt:

- `IDENTITY_PERSONA_V2`: Dual Read/observe;
- `EXISTING_IDENTITY_INVITATION`: enge Allowlist;
- `PERSONA_PORTAL_SWITCH`: UI/Context getrennt aktivierbar;
- `PERSONA_PRIVACY_V2`: identity-weite Export-/Deleteprojektion;
- `PERSONA_LEGACY_CONTRACT`: erst nach vollständigem Backfill/G3.

Alle Defaults bleiben `DISABLED` beziehungsweise `false`. Aktivierung:
`DISABLED → DUAL_READ → INTERNAL → ALLOWLIST → LAUNCH_SCOPE`. Kill Switch
stoppt neue Persona/Invitation/Switches, entfernt aber keine gültigen
Memberships. Er darf nie Tenantprüfungen umgehen oder Legacy-All-Role
reaktivieren.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Die ersten beiden Kriterien trennen Demand-Evidence von der ausdrücklich
autorisierten technischen Umsetzung. Technische Tests belegen keine Nachfrage
und keine Aktivierungsfreigabe.

| Criterion/Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P27-AC-01` / `REQ-PER-001` / `REQ-UX-003` | P1/P3: XL-Umbau ohne Bedarf | Moderated Research | Persona-Demand-Gate | qualifizierter aktueller Dual-Persona-Blocker | hypothetischer Wunsch, unqualifizierte Person, günstigere sichere Alternative reicht | Candidate/Employer | heutige Login/Invite/Portal Journeys | ≥12 Teilnehmer, ≥6 realer Dualbedarf, ≥3 Firmen | moderierte Research, echte Zielgruppe | preregistrierter Ablauf: Candidate→Company Invitation, Company→Candidate Journey, Login/Recovery/Privacy; Alternative mit separatem Konto testen; anonymisiert protokollieren | GO nur bei ≥4/6 materiell blockiert + keine sichere günstigere Lösung + vier Owner-Sign-offs; sonst NO-GO/DEFERRED | Researchplan, anonymisierte Task-/Time-/Error-/Comprehension-Matrix, Decision | Product Research + Privacy | `OPEN — EXTERNE DEMAND-EVIDENCE FEHLT` |
| `P27-AC-02` / `REQ-PER-001` | P0 Governance: NO-GO erzeugt trotzdem Code | Plan/Repository Audit | No-Code Boundary | NO-GO lässt Phase deferred/disabled | Persona-Schema/Route/Flag/CTA/Claim trotz fehlendem GO | Engineering/Product | Repository/Plan/Routes | Decision NO-GO/DEFERRED, Baseline-Inventar | Clean Worktree/CI | `npm run plan:audit`; `npm run route:audit`; `rg -n "PersonaAssignment" app components lib prisma`; `rg -n "PERSONA_PORTAL_SWITCH" app components lib prisma`; `rg -n "IDENTITY_PERSONA_V2" app components lib prisma` | ohne GO neue Phase-27-Runtime-/Schema-/Route-/Flag-Treffer `0`; Planstatus bleibt DEFERRED/DISABLED | Auditlogs, Decision-ID, Git-Diff | Governance + QA | `N/A — TECHNIKSCOPE DURCH OWNER AKTIVIERT; MARKT-AKTIVIERUNG BLEIBT DISABLED` |
| `P27-AC-03` / `REQ-PER-001` | P0 bei GO: Persona wird Autorität | Unit | Identity×Persona×Membership×Assignment Matrix | explizite Persona plus aktuelle Membership/Assignment erlaubt | Persona allein, fremde Company, suspended membership, Admin aus Persona | Candidate/Employer/Admin | Policy/Guards | alle Persona-/Role-/Statuskombinationen, Company A/B | Unit, nur nach GO | `npx vitest run --config vitest.config.ts tests/unit/auth/persona-authorization-matrix.test.ts` | vollständige Matrix; Persona-only Tenantzugriff `0`; Admin Grants aus Persona `0` | Matrixreport | Security + Identity QA | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-04` / `REQ-PER-001` | P0: Backfill grantet Rechte/verliert Identität | Migration | empty/upgrade/partial/repeat/N-1 | Legacyrollen exakt additiv abgebildet | zusätzliche Persona/Grant, duplicates, orphan, partial, suspended Fälle | System/DBA | Prisma/PostgreSQL | alle Legacyrollen/statuses, multi-company, partial states | isoliertes PostgreSQL, nur nach GO | `npm run db:migrate`; `npm run db:migrate:status`; `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase27-persona-migration-postgres.test.ts` | neue unberechtigte Personas/Grants `0`; Count/Tenant/Consent-Abweichung `0`; Wiederholung 0 Zusatzwirkung | Migration-/Backfill-/Compatibility-Manifest | Identity + Data/DBA | `PASS — LOCAL/CI; STAGING N-1 OFFEN` |
| `P27-AC-05` / `REQ-PER-001` | P0: Invitation erzeugt Cross-Tenant-Recht | PostgreSQL | bestehende Identity nimmt Company Invitation an | current token/role/seat/company + Step-up erzeugt 1 Membership | replay/expired/revoked invite, changed role/seat, fremde Mail/Company, parallel accept | Candidate/Owner | Invitation/Auth/Company | Identity A, Company A/B, all invite states | real PostgreSQL, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/persona-invitations-postgres.test.ts` | erlaubter Accept 1 Membership; alle Negativ-/Parallelfälle 0 unzulässige Memberships; Audit 1 | DB-/Audit-Report | Identity + Employer QA | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-06` / `REQ-ID-004` | P0: Context Switch/ATO erzeugt Zugriff | Unit + PostgreSQL | Portal-/Company Context, Safe Next, Step-up | autorisierter Switch rotiert/bindet Context | manipulierte IDs/next, Company A→B stale cache/tab, replayed Grant | Candidate/Employer | Session/Guards/Navigation | Candidate+2 companies, active/suspended memberships | Unit + real PostgreSQL, nur nach GO | `npx vitest run --config vitest.config.ts tests/unit/auth/persona-context-safe-next.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/security/persona-context-postgres.test.ts` | Cross-context/-tenant Daten `0`; Switch erzeugt `0` Grants; stale action grant nach Contextwechsel denied | Session-/Security-Report | Security + Identity | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-07` / `REQ-PRIV-004` | P0: Export/Delete übersieht Persona/leakt Company | PostgreSQL | identity-weite Rechte | Export/Correction/Delete inventarisiert alle eigenen Personas | nur aktive Persona, Company-/Drittdaten, immutable Records falsch gelöscht, partial failure | Candidate/Employer/Privacy | Privacy Service | identity with candidate+2 memberships+applications+radar | real PostgreSQL, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/privacy/persona-privacy-postgres.test.ts` | eigenes Inventar vollständig; Drittdatenleak 0; erlaubte Lösch-/Holdmatrix exakt; Resume idempotent | Data-Inventory-/Export-/Erasure-Report | Privacy + Identity | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-08` / `REQ-PER-001` | P0: Suspension zu eng/zu breit | PostgreSQL | Identity/Persona/Membership Suspension | jede Suspension wirkt nur laut Matrix | Candidate suspend sperrt fälschlich Company oder Membership suspend globale Identity; stale session | Security/Admin/User | Auth/All Portals | all suspension scopes, sessions, companies | real PostgreSQL, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/security/persona-suspension-postgres.test.ts` | Wirkung exakt je Scope; gesperrter Scope nächste Prüfung denied; andere zulässige Scopes unverändert | Scope-/Session-/Audit-Report | Security + Privacy | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-09` / `REQ-ADM-007` | P0: Persona verleiht Admin | Security Regression | interne Grants getrennt | bestehender expliziter AdminGrant wirkt | Candidate/Employerpersona, Company Owner oder Switch erzeugt Capability | User/Admin | Admin Guards | all personas + no/explicit admin grants | real PostgreSQL, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/admin/persona-admin-separation-postgres.test.ts` | Persona-/Membershipkombinationen ohne expliziten Grant erhalten `0` Adminreads/-writes | Capability-/Tenant-Report | Security + Admin QA | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-10` / `REQ-PER-001` | P1: Audit/Analytics/Notification falscher Context | PostgreSQL | Context Evidence | Event trägt richtige Identity/Persona/Company/Purpose | Candidate PII im Employeranalytics, duplicate mail, falscher Tenant, raw context leak | User/System | Audit/Analytics/Outbox | same action in each context, Company A/B | real PostgreSQL, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/auth/persona-context-evidence-postgres.test.ts` | Auditkontext 100 % korrekt; Analytics PII-Leaks 0; Notification je Dedupe-Key 1 an zulässigen Empfänger | Audit-/Analytics-/Outbox-Manifest | Identity + Privacy + Data | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-11` / `REQ-PER-001` | P0: Cross-persona/-tenant Browserleak | E2E | Candidate↔Employer, Company A/B, Direct URL, Invite, Recovery | jeder autorisierte Wechsel und Rückweg funktioniert | direct URL, stale tab, expired invite, unsupported merge, suspended context | Candidate/Owner/Admin | Candidate/Employer/Admin UI | all legacy roles + dual identity + Company A/B | Chromium, nur nach GO | `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase27-persona-switch.spec.ts --project=chromium-journeys` | autorisierte Journeys je 1 Pass; Cross-persona/-tenant/Direct-URL-Leak `0`; Retry 0 | Playwright/trace-safe Report | Identity + Security QA | `PASS — LOCAL/CI TECHNIKSCOPE` |
| `P27-AC-12` / `REQ-QA-003` | P1: mobile/a11y Switch unbrauchbar | E2E + A11y | Switcher/Invite/Locked/Conflict bei 360 | Tastatur/Touch/Screenreader vollständig | Fokusverlust, hidden Context, clipping, color-only, nicht erreichbare Company | alle User | Navigation/Auth UI | 1/2/many companies, every UX state | Chromium Desktop + 360, nur nach GO | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase27-persona-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase27-persona-quality.spec.ts --project=chromium-mobile-360` | Axe serious/critical 0; Clipping kritischer Action 0; aktiver Context programmatisch eindeutig | Playwright/Axe/Screenshots | UX + Accessibility + QA | `PASS — AUTOMATISIERT; MANUELLE AT-SESSION OFFEN` |
| `P27-AC-13` / `REQ-QA-003` | P0: Rollback regrantet/verliert Context | Migration/Recovery | dual-read cutover/rollback | alte/new reader konvergieren, Flag stoppt neue Switches | Contract zu früh, N-1 misliest Persona, old session, partial backfill | System/Ops | App/DB/Session | N/N-1 artifact, partial migration, active sessions | Staging, nur nach GO | `npx vitest run --config vitest.integration.config.ts tests/integration/auth/persona-cutover-postgres.test.ts`; manuell: dual-read canary, Flag off, N-1/roll-forward drill | Grant-/Tenantabweichung 0; bestehende Memberships erhalten; alte unklare Sessions widerrufen; kein destruktiver Contract vor G3 | Cutover-/Rollback-/Session-Manifest | Identity + Ops + DBA | `PASS — LOCAL AUTOMATISIERT; STAGING-/MANUELLER CANARY BLOCKED` |

### Phase-27 Audit-log extension matrix

| Audit Action | Auslöser | Mindestmetadaten | Ziel |
| --- | --- | --- | --- |
| `PERSONA_ASSIGNMENT_CHANGED` | Persona wird erstellt, aktiviert, suspendiert oder widerrufen | Persona-Kind, alter/neuer Status, Quelle, Version und Reason | `USER` |
| `PERSONA_CONTEXT_SWITCHED` | autorisierte Session wechselt Portal- oder Company-Kontext | alter/neuer Portal-Kontext, Persona, Company, Session-Kontextversion und invalidierte Step-up-Grants | `SESSION` |

## 22. Performance und Scale

Ohne ausdrückliche technische Owner-Scope-Aktivierung: keine
Phase-27-Performancearbeit.

Im ausdrücklich aktivierten technischen Owner-Scope:

- Current Identity/Persona/Company Context wird in bounded, indexierten Queries
  geladen; keine N+1-Abfrage je Membership;
- Switch und Default-Destination p95 im Staging höchstens `300 ms` ohne
  nachgelagerte Seitenabfrage;
- Membershipauswahl nutzt Keyset/Bound und bleibt bei `100` synthetischen
  Memberships erreichbar, obwohl reale Limits deutlich kleiner sein sollen;
- Session-/Grant-Revocation wird nicht durch langlebigen Allow-Cache verzögert;
- Privacy Export/Delete und Audit arbeiten bounded über alle Personas;
- Query Count, p50/p95, DB Plan und Memory werden vor/nach Cutover erfasst;
- Support-/Merge-Handling Time und Case Arrival gehören in
  `REQ-OPS-004`; übersteigt der Scope das freigegebene Modell, bleibt Rollout
  gestoppt.

## 23. Geschützte Phase-01–18-Invarianten

- Phase 02: additive Migrationen, Constraints und historische Daten;
- Phase 03/06: kanonische Auth-/Rollen-/Tenantpolicy, Session und sichere 404;
- Phase 09: Candidate Ownership, Applications, Privacy und Alerts;
- Phase 10: Company Membership, Assignment, Invitation, Seats, Last Owner und
  Multi-Company-Isolation;
- Phase 11/25A: Admin Capability bleibt getrennt;
- Phase 14: Radar-Anonymität, Consent und Reveal;
- Phase 16: CSRF, IDOR, no-store, Audit, Rate Limit und Sessionrevocation;
- Phase 17/18: Cross-role E2E, 100-Seiten-Inventar, Zero Retry, Recovery und
  unveränderliche Evidence.

Ein Context Switch darf niemals als Berechtigung, Consent oder Reveal gelten.

## 24. Rollback und Roll-forward

Ohne technische Owner-Scope-Aktivierung ist kein technischer Rollback nötig;
ein Demand-`NO-GO` hält Markt- und Kohortenaktivierung deferred.

Im ausdrücklich aktivierten technischen Owner-Scope:

- Flags pausieren neue Personaanlage/Invitation/Switch, ohne gültige
  Memberships zu löschen;
- Legacy `User.role` bleibt bis nach G3 lesbar; kein Contract vor Reverse-Check;
- alte/unklare Sessions werden widerrufen statt unsicher migriert;
- additive Persona-/Context-Daten werden bei Rollback nicht destruktiv gelöscht;
- nach Consent-/Privacy-/Auditwirkung ist Roll-forward der Standard;
- N-1-Binary darf nur starten, wenn es neue Personas/Memberships fail-closed
  versteht; sonst Deployment-Guard;
- Duplicate-/Mergekonflikte bleiben als Fälle sichtbar und werden nicht per
  DB-Handedit „behoben“.

## 25. Benötigte Evidence und Artefakte

Vor einer Markt-/Kohortenaktivierung:

- preregistrierter Researchplan, Qualifikations-/Schwellenmatrix;
- anonymisierte moderierte Resultate und getestete Alternativen;
- Security-/Privacy-/Migration-/Support-Blast-Radius;
- datierter Vier-Owner-`GO|NO-GO|DEFERRED`-Entscheid.

Für den ausdrücklich aktivierten technischen Owner-Scope zusätzlich:

- Identity-/Persona-ADR und Route×Role×Tenant×Action-Matrix;
- Migration-/Backfill-/N-1-/Rollback-/Count-/Consent-Manifest;
- vollständige AC-Matrix und tatsächliche Testreports auf einem Commit;
- Cross-persona/-tenant-/direct-action-/ATO-Negativmatrix;
- Privacy-/Audit-/Analytics-/Notification-/Suspension-Evidence;
- Desktop-/360-/A11y-Artefakte;
- Allowlist-/Support-/Kill-Switch-/Recovery-Drill und Artefakt-Digest.

## 26. Definition of Done

### Bei Demand-NO-GO/DEFERRED

- Research und Entscheidung sind vollständig und datiert;
- keine Kohorte, Marketingbehauptung oder allgemeine Aktivierung;
- Technik bleibt hinter `DISABLED`, Aktivierung `DISABLED`;
- keine andere Phase nennt Multi-Persona als versteckte Launchvoraussetzung.

### Für den ausdrücklich aktivierten technischen Vertrag

- alle In-Scope-Verträge, Migrationen, UIs, Guards, Privacy-/Auditwirkungen und
  Tests sind implementiert;
- jede AC-Zeile `PASS` oder begründet `N/A`;
- Owning Tests, Lint, Typecheck, Build, vollständige Unit-/PostgreSQL-/E2E-/
  Security-/Migration-Suites und G3 laufen auf demselben Commit;
- Membership/Assignment bleibt Tenantautorität, Admin Grants bleiben getrennt,
  Cross-persona/-tenant-Leaks sind `0`;
- Technik-/Quality-/Activationstatus werden getrennt dokumentiert.

Ein `GO` allein ist keine technische Completion oder LIVE-Freigabe.

## 27. Quality-Gate für abhängige Phasen

- Es gibt standardmäßig **keine** abhängige Phase und kein kritisches
  Launchgate.
- `NO-GO/DEFERRED` blockiert Phase 24, 26, 28, 29, 30, 31 oder 32 nicht, sofern
  deren Scope keine Multi-Persona-Funktion behauptet.
- Nur wenn ein späterer Launchscope Multi-Persona ausdrücklich einschließt,
  warten dessen sichtbare Integration, Phase-29B-Polish und Phase-32-Audit auf
  Phase-27-G3 beziehungsweise G4.
- Andere Phasen dürfen das Demand-Gate nicht durch ein technisches
  „kleines Refactoring“ umgehen.

## 28. Was diese Phase nicht beweist

Research beziehungsweise die Phase-27-Technikumsetzung beweist nicht:

- dass Multi-Persona für den ersten Cluster oder die Mehrheit der Nutzer nötig
  ist;
- dass ein `GO` Product-Market-Fit oder breite Nachfrage belegt;
- dass Persona Context Tenant-, Membership-, Assignment-, Capability-,
  Step-up- oder Consentautorität ersetzt;
- dass automatische Accountmerges sicher oder zulässig sind;
- dass externe Recruiter Mandates, SSO/SCIM, ATS oder Shared Accounts benötigt
  werden;
- dass Identity-, Privacy-, Security-, Support- oder Operationsgates anderer
  Phasen geschlossen sind;
- allgemeine Produktions- oder Skalierungsreife.

Der Standardentscheid bleibt: enges, segmentiertes Produkt mit vollständig
deaktiviertem Phase-27-Vertrag, bis echte moderierte Demand-Evidence und die
weiteren Aktivierungsgates einen konkreten Scope freigeben.
