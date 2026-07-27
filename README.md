# SwissTalentHub / PortalGERM

SwissTalentHub ist ein Schweizer Job-Marktplatz für Stellensuchende, Arbeitgeber,
Recruiter und Plattform-Operations. Der kontrollierte MVP verbindet öffentliche
Job- und Firmensuche, transparente Lohnbänder und einen versionierten
Fair-Job-Score mit Candidate-, Employer- und Admin-Workflows. Talent Radar schützt
die Identität von Kandidat:innen bis zu einer ausdrücklich bestätigten,
feldgenauen Freigabe. Bezahlte Job-Boosts werden sichtbar gekennzeichnet und
verändern niemals den Fair-Job-Score.

Der aktuelle Stand ist **Demo-ready für lokale Vorführungen und kontrollierte
interne Produkt-Evaluationen mit Mock-Providern**. Er ist **weder pilot-ready
noch Production-ready**:
externe Provider, AVG-/Rechts-/Datenschutz-/Steuerfreigaben, echte bezahlte
Marktvalidierung, ein monatliches Cashflow-/Runway-Modell, ein fachlich
freigegebener LIVE-Lohndatensatz, produktiver Worker-Betrieb,
Incident-Prozesse und bestätigte Recovery-SLAs sind separate Go-live-Gates.
Den reproduzierten Release- und Teststatus des Zielcommits dokumentiert
[`BUILD_REPORT.md`](./BUILD_REPORT.md).

Phase 22 besitzt auf Candidate `0636a875` zusätzlich einen automatisiert
G3-grünen, standardmäßig deaktivierten Local-/CI-Sandboxvertrag für
inventargebundenen Datenschutzvollzug, versionierte Legal-Gates und optionale
Consent-Analytics. Counsel-/AVG-/AVV-/DPA-/DSFA-/Retention-Freigaben,
Nicht-Kontoinhaber-Identity und moderierte Nutzerforschung fehlen; der
Phasenstatus und jede LIVE-Aktivierung bleiben daher blockiert. Details:
[`codex-plan/evidence/2026-07-26-phase-22.md`](./codex-plan/evidence/2026-07-26-phase-22.md).

Phase 24 ergänzt einen technisch geprüften, standardmässig gesperrten
Stripe-Sandboxvertrag für Hosted Checkout, signierte Webhook-Inbox,
Reconciliation, Refund/Chargeback/Dunning und bezahlte Service-Recovery.
Mock-Billing bleibt davon getrennt. Ohne WTP-, Provider-, Step-up-, Tax-,
Legal-, Finance- und Operations-Gates entstehen weder ein Kauf-CTA noch eine
LIVE-Zahlung. Das Betriebsverfahren steht im
[`Payment-Operations-Runbook`](./codex-plan/runbooks/payment-operations.md).

Phase 25 ergänzt persistierte deny-by-default Adminrollen, WebAuthn/TOTP/
Recovery, frische aktionsgebundene Step-up-Nachweise sowie einen
Trust-&-Safety-Vertrag mit Risk Decisions, bounded Hold/Revoke, Appeal und
unabhängigem Restore. Die technischen Pfade bleiben mit
`ADMIN_MFA_REQUIRED=false`, `PRIVILEGED_STEP_UP_MODE=disabled`,
`TRUST_RISK_MODE=observe` und `BREAK_GLASS_ENABLED=false` geschlossen
beziehungsweise beobachtend, bis benannte Owner, Policies, Staging-RP-ID,
Pager und Drills freigegeben sind. Das Betriebsverfahren steht im
[`Security-&-Trust-Operations-Runbook`](./codex-plan/runbooks/security-trust-operations.md).

Dieses Verzeichnis ist ein eigenes verschachteltes Git-Repository. Die
[`CLAUDE.md`](./CLAUDE.md) grenzt es ausdrücklich vom separaten Elternprojekt
`Portal.git` ab; dessen Providerregeln gelten hier nicht.

## Demo-Konten

Die folgenden Konten existieren nur nach dem lokalen/CI-Demo-Seed. Das gemeinsame
Passwort lautet `Demo12345!`. Diese Zugangsdaten dürfen niemals in Staging oder
Production angelegt oder wiederverwendet werden.

| Perspektive | E-Mail | Rolle / Fixture | Einstieg |
|---|---|---|---|
| Kandidat:in | `candidate@demo.ch` | `CANDIDATE` | `/candidate/dashboard` |
| Arbeitgeber | `employer@demo.ch` | `EMPLOYER`, Owner von NovaRigi Digital AG, Pro | `/employer/dashboard` |
| Recruiter | `recruiter@demo.ch` | `RECRUITER`, zugewiesene NovaRigi-Jobs | `/employer/dashboard` |
| Plattform-/Operationsadmin | `admin@demo.ch` | `ADMIN` mit expliziten Platform-, Moderation-, Support-, Content-, Finance-, Privacy-Process- und Trust-Review-Rollen | `/admin` |
| Security-Admin | `security-admin@demo.swisstalenthub.test` | `ADMIN`, Security und unabhängige Trust-Freigabe | `/admin/security` |
| Privacy-Verifier | `privacy-verifier@demo.swisstalenthub.test` | `ADMIN`, getrennte Privacy-Verifikation | `/admin/privacy-requests` |

Für Plan- und Entitlement-Vergleiche erzeugt derselbe Seed zusätzlich diese
Arbeitgeber-Owner:

| Plan | Firma | Login |
|---|---|---|
| Free Basic | Alpenfaden Atelier GmbH | `owner+alpenfaden-atelier@demo.swisstalenthub.test` |
| Starter | Rheintal Werkbogen AG | `owner+rheintal-werkbogen@demo.swisstalenthub.test` |
| Pro | NovaRigi Digital AG | `employer@demo.ch` |
| Business | Carevia Quartiergesundheit AG | `owner+carevia-quartiergesundheit@demo.swisstalenthub.test` |
| Enterprise Contract | Quarzspindel Industriewerke AG | `owner+quarzspindel-industriewerke@demo.swisstalenthub.test` |

## Verbindliche Runtime und Tech-Stack

| Bereich | Implementierung |
|---|---|
| Runtime | Node.js `24.18.0`, npm `11.16.0` |
| Web | Next.js `16.2.11` App Router, React `19.2.7`, TypeScript `5.9.3` |
| UI | Tailwind CSS `4.3.3`, shadcn CLI `4.13.1`, Base UI, Lucide |
| Daten | PostgreSQL 16, Prisma ORM/Client `7.8.0` |
| Validierung | Zod `4.4.3`, zusätzliche Domain- und SQL-Constraints |
| Auth | Eigene E-Mail/Passwort-Authentifizierung mit `bcryptjs`, persistierten DB-Sessions, httpOnly-Cookie sowie WebAuthn/TOTP/Recovery und aktionsgebundenem Step-up; kein Auth.js |
| Tests | Vitest `4.1.10`, Testing Library, Playwright `1.61.1`, axe-core |
| Provider | Serverseitige Ports mit lokalen Mock-Adaptern sowie explizit gegatetem Stripe-Testadapter; kein LIVE-Paymentmodus |

Die Versionen sind in `.node-version`, `.nvmrc`,
`package.json#packageManager` und `package.json#engines` festgelegt.
`engine-strict=true` lehnt eine abweichende Runtime ab.

```text
node --version
npm --version
```

Erwartet werden `v24.18.0` und `11.16.0`.

## Architektur

Die Anwendung folgt einem serverseitig autorisierten, mock-first
Ports-and-Adapters-Ansatz. UI oder Route Handler nehmen keine Preise,
Tenant-Zugehörigkeiten oder Identitätsfreigaben als autoritativ an. Der
vollständige Pfad lautet:

```text
UI/Route
  -> Zod-Eingabe
  -> Session, Rolle, Capability und Ownership
  -> Domain-Policy/Use Case
  -> autorisiertes Repository / Provider-Port
  -> PostgreSQL-Transaktion
  -> Audit/Notification
  -> redigierte Antwort und UI-Feedback
```

| Verzeichnis | Verantwortung |
|---|---|
| [`app`](./app) | Next.js-Routen, Layouts, Server Actions und Route Handler |
| [`components`](./components) | UI-Primitives und rollenbezogene Oberflächen |
| [`lib`](./lib) | Domain-Policies, Auth, Billing, Search, Privacy, Provider-Ports und autorisierte Datenzugriffe |
| [`prisma`](./prisma) | Schema, 57 committed Migrationen, deterministischer Seed |
| [`tests`](./tests) | Unit-, PostgreSQL-Integration- und Playwright-E2E-Suiten |
| [`scripts`](./scripts) | plattformneutrale Env-, DB-, Release-, Security- und Recovery-Werkzeuge |
| [`codex-plan`](./codex-plan) | verbindlicher Plan, ADRs, Requirements und Evidence |

Weiterführende Verträge:

- [`lib/scoring/__rules.md`](./lib/scoring/__rules.md) — Fair-Job- und
  Match-Score-Regeln;
- [`codex-plan/decisions.md`](./codex-plan/decisions.md) — Architecture Decision
  Records;
- [`codex-plan/glossary.md`](./codex-plan/glossary.md) — gemeinsame
  Fachbegriffe;
- [`prisma/README.md`](./prisma/README.md) — Datenmodell- und
  Migrationshinweise.

## Voraussetzungen

- Git;
- exakt die oben genannten Node-/npm-Versionen;
- Docker Desktop beziehungsweise Docker Engine mit Compose für die
  dokumentierte lokale PostgreSQL-Option;
- freie Ports `3000`, `5434` und für Integrationstests `5435`;
- für den isolierten Recovery-Drill zusätzlich `age`/`age-keygen` sowie
  PostgreSQL-16-`pg_dump`/`pg_restore` oder die dokumentierte
  Docker-Compose-Toolausführung.

## Lokales Setup

Falls kein PostgreSQL 16 läuft, zuerst die lokale, nur an Loopback gebundene
Compose-Datenbank starten:

```text
docker compose up -d postgres
```

Danach sind die Setup-Befehle in PowerShell, cmd, bash und CI identisch:

```text
npm ci
npm run env:init
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Die Anwendung ist danach unter
[http://127.0.0.1:3000](http://127.0.0.1:3000) erreichbar.

`npm run env:init`:

- verweigert Staging, Production und einen Production-Node-Prozess;
- erzeugt ausschließlich eine ignorierte `.env.local`, nur wenn sie noch nicht
  existiert, mit Dateimodus `0600`, soweit das Dateisystem ihn unterstützt;
- bestätigt interaktiv getrennte lokale PostgreSQL-Ziele auf Loopback und
  validiert die eingegebene credential-freie `APP_URL`;
- übernimmt keine DB-/App-URL aus dem Prozess und gibt keine
  credential-tragende DB-URL aus;
- erzeugt Session-Secret, alle fünf Keyrings und das Mailbox-Secret aus jeweils
  32 CSPRNG-Bytes;
- setzt `RATE_LIMIT_BACKEND=postgres` und lässt alle zukünftigen
  Provider-Platzhalter leer;
- validiert das Ergebnis vor dem exklusiven Neuanlegen und gibt nur
  Variablennamen, niemals Werte aus.

`npm run env:init -- --non-interactive` verwendet ausschließlich die sicheren
lokalen Defaults. `npm run env:init -- --ci` verlangt `APP_ENV=ci`, validiert nur
die vollständig vorab gesetzte Prozessumgebung und schreibt keine Datei.
`npm run env:validate` validiert die aktive Prozesskonfiguration oder, wenn
keine explizite Prozesskonfiguration vorhanden ist, die lokale Env-Datei.

## Umgebungsvariablen

Die vollständige, absichtlich nicht direkt lauffähige Vorlage ist
[`.env.example`](./.env.example). Fehler nennen nur Variablennamen und Regeln,
nie Secret-Werte. `.env`, `.env.local`, andere lokale Env-Dateien, private
Age-Identitäten und Provider-Credentials gehören nicht ins Repository oder in
Logs.

### Anwendung und Datenbank

| Variable | Pflicht / Scope | Beschreibung |
|---|---|---|
| `APP_ENV` | immer | `local`, `ci`, `preview`, `staging` oder `production`; steuert Sicherheits- und Seed-Gates |
| `NODE_ENV` | immer | Node-Laufzeit `development`, `test` oder `production` |
| `DATABASE_URL` | immer | Explizite PostgreSQL-URL; in CI muss der DB-Name `ci`/`test` enthalten |
| `TEST_DATABASE_URL` | Local/CI | Getrennte, testbenannte PostgreSQL-DB; in CI Pflicht, in Staging/Production verboten |
| `APP_URL` | immer | Absolute credential-, Query-, Fragment- und Pfad-freie HTTP(S)-Origin; Staging/Production nur HTTPS |
| `NEXT_PUBLIC_APP_NAME` | immer | Öffentlicher Produktname, standardmäßig `SwissTalentHub` |
| `APP_BUILD_ID` | Staging/Production | Nicht sensitiver, commit-eindeutiger Build-Identifier; lokal `local-development` |
| `LOG_LEVEL` | immer | `debug`, `info`, `warn` oder `error` |
| `TRUSTED_PROXY_HOPS` | immer | Lokal `0`; in Staging/Production exakt `1` bis `8` gemäß kontrollierter Ingress-Topologie |

Eine vollständig explizite Prozesskonfiguration muss mindestens `APP_ENV`,
`DATABASE_URL` und `APP_URL` gemeinsam bereitstellen; sie wird nicht still mit
lokalen Env-Dateien ergänzt.

### Secrets, Rotation und lokale Mailbox

| Variable | Pflicht / Scope | Beschreibung |
|---|---|---|
| `SESSION_SECRET` | immer | Kanonisches Base64 für exakt 32 zufällige Bytes |
| `AUDIT_IP_HASH_KEYS` | immer | Versioniertes HMAC-Keyring für Audit-IP-Pseudonyme |
| `RADAR_OPAQUE_LOOKUP_KEYS` | immer | Versioniertes HMAC-Keyring für opake Radar-Lookups |
| `RADAR_OPAQUE_ENCRYPTION_KEYS` | immer | Versioniertes Verschlüsselungs-Keyring für Radar-Mappings |
| `REVEAL_CONFIRMATION_KEYS` | immer | Versioniertes HMAC-Keyring für einmalige Reveal-Bestätigungen |
| `PII_REVEAL_KEYS` | immer | Versioniertes Verschlüsselungs-Keyring für freigegebene Identitätswerte |
| `ENABLE_LOCAL_MOCK_MAILBOX` | Local/Test | Standard `false`; in Production-Builds, Staging und Production zwingend `false` |
| `DEV_MAILBOX_SECRET` | bei aktivierter lokaler Mailbox | Base64/Base64url für mindestens 32 zufällige Bytes |
| `ABUSE_REPORT_ADMIN_EMAILS` | Staging/Production | Kommagetrennte, geprüfte Empfängerliste; `admin@demo.ch` ist nur der lokale Default |

Alle `*_KEYS` verwenden kommaseparierte Einträge
`version:base64-32-byte-key`. Der **erste** Eintrag ist der aktive Writer.
Ältere, eindeutige Einträge werden nur zum Lesen behalten, bis kein
persistierter Datensatz mehr auf sie verweist. Schlüsselmaterial darf weder
zwischen Keyrings noch mit `SESSION_SECRET` wiederverwendet werden.

### Rate-Limiting, Recovery und Provider

| Variable | Pflicht / Scope | Beschreibung |
|---|---|---|
| `RATE_LIMIT_BACKEND` | immer | `postgres`; `memory` ist ausschließlich ein Local/Test-Adapter |
| `BACKUP_AGE_RECIPIENT` | Recovery-Drill | Ein öffentlicher X25519-`age1...`-Empfänger |
| `BACKUP_AGE_IDENTITY_FILE` | Restore-Drill | Absoluter, geschützter Secret-Mount außerhalb des Repositories; enthält nur den Pfad, nie das Keymaterial selbst |
| `EMAIL_PROVIDER_API_KEY` | Platzhalter | Für den Mock-MVP leer lassen |
| `OPENAI_API_KEY` | Platzhalter | Für den Mock-MVP leer lassen |
| `STORAGE_ENDPOINT` | Platzhalter | Für den Mock-MVP leer lassen |
| `JOBROOM_API_URL` | Platzhalter | Für den Mock-MVP leer lassen |
| `MAPS_API_KEY` | Platzhalter | Für den Mock-MVP leer lassen |

Nicht leere Provider-Platzhalter werden bis zu einem expliziten
Security-/Legal-/Ops-Gate abgelehnt. Ein Env-Wert aktiviert nie automatisch
einen Real-Adapter.

### Payment-Sandbox und Finance

Alle Payment-Schalter sind standardmässig geschlossen. Der Stripe-Adapter
akzeptiert in Phase 24 ausschliesslich Testmodus-Konfiguration in
`local|ci|staging`; `production` und LIVE-Schlüssel werden abgelehnt.
Environment-Werte allein genügen nie: zusätzlich ist ein aktuelles
`ProviderActivation`-Ledger erforderlich.

| Variable | Sicherer Default / Scope | Beschreibung |
|---|---|---|
| `PAYMENT_PROVIDER_MODE` | `disabled` | Optional `stripe_sandbox`; wählt keinen LIVE-Modus |
| `PAYMENT_SANDBOX_COHORT` | `none` | `test` nur für eine ausdrücklich freigegebene Testkohorte |
| `REAL_PAYMENT_INGESTION` | `false` | Erlaubt nach Provider-Gate nur signaturgeprüfte durable Inbox-Writes |
| `REAL_PAYMENT_PROJECTION` | `false` | Projiziert Inbox-Ereignisse; setzt Ingestion voraus |
| `PAID_SELF_SERVICE` | `false` | Checkout-Kill-Switch; benötigt zusätzlich WTP-Go, Providerledger und Step-up |
| `FINANCE_REPAIR_ACTIONS` | `false` | Refund-/Repair-Mutationen; bleibt bis Phase 25A geschlossen |
| `PAID_SERVICE_RECOVERY` | `false` | Führt genehmigte, policygebundene Remedies aus |
| `STRIPE_ACCOUNT_ID` | leer | Exakte Test-Merchant-Account-ID aus dem Activation Ledger |
| `STRIPE_SECRET_KEY` | leer | Nur secret-gemounteter `sk_test_…`-Schlüssel; nie committen oder loggen |
| `STRIPE_WEBHOOK_SECRET` | leer | Secret-Mount für Raw-Body-Signaturprüfung |
| `STRIPE_SECRET_VERSION` | leer | Nicht geheime Referenz auf die freigegebene Secret-Version |

Die Aktivierungsreihenfolge und Incident-/Reconciliation-Abläufe stehen in
[`codex-plan/runbooks/payment-operations.md`](./codex-plan/runbooks/payment-operations.md).

### Privileged Assurance und Trust & Safety

Diese vier Phase-25-Schalter sind unabhängig von den Payment-Schaltern und
standardmässig fail-closed:

| Variable | Sicherer Default | Beschreibung |
|---|---|---|
| `ADMIN_MFA_REQUIRED` | `false` | Erzwingt Admin-AAL2 erst nach Enrollment-, Recovery- und Lockout-Gate |
| `PRIVILEGED_STEP_UP_MODE` | `disabled` | `observe` protokolliert; `enforce` verlangt action-/actor-/session-/tenant-/resource-gebundene Single-use Grants |
| `TRUST_RISK_MODE` | `observe` | Erlaubt erst nach Policyfreigabe den Modus `hold`; Observe allein widerruft keine Fachobjekte |
| `BREAK_GLASS_ENABLED` | `false` | Öffnet nur zeitgebundene, incidentgebundene und auditierte Grants; nie einen globalen Admin-Fallback |

Die zulässige Aktivierungsreihenfolge, Kill Switches, Device-Loss-,
Appeal-/Restore- und Worker-Failure-Abläufe stehen im
[`Security-&-Trust-Operations-Runbook`](./codex-plan/runbooks/security-trust-operations.md).

## PostgreSQL, Migrationen und Seed

### Lokale Dienste

| Dienst | Zweck | Host-Port | Persistenz |
|---|---|---:|---|
| `postgres` | lokale Entwicklung | `127.0.0.1:5434` | Named Volume `swisstalenthub-postgres` |
| `postgres-test` | isolierte Integrationstests | `127.0.0.1:5435` | flüchtiges `tmpfs` |

```text
docker compose up -d postgres
docker compose --profile test up -d postgres-test
docker compose config --quiet
```

Compose und Linux-CI verwenden PostgreSQL `16.13-alpine` mit festem
Image-Digest. CI arbeitet ausschließlich mit kurzlebigen, testbenannten
Service-Datenbanken.

### Committed-Migration-Workflow

```text
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:migrate:status
npm run db:smoke
```

- `db:migrate` führt `prisma migrate deploy` gegen die ausdrücklich
  konfigurierte Ziel-DB aus.
- Die **57 committed Migrationen** reichen von der Baseline über Domain-,
  Billing-, Radar-, Search- und Security-Verträge bis zu Phase-22-Privacy-,
  Legal-, Worker-, Phase-24-Payment-/Finance- und Phase-25-Assurance-/
  Trust-&-Safety-Constraints.
- `db:migrate:dev` und `db:studio` sind durch einen Local-/Loopback-Guard
  geschützt.
- `prisma db push` ist für Production, Staging, Releases und
  Completion-Evidence verboten. Schemaänderungen benötigen eine geprüfte,
  committed Migration.
- Es gibt keinen automatischen destruktiven Reset und keine allgemein sichere
  Down-Migration. Ein Rollback muss die konkrete Migration,
  Vorwärtskompatibilität und den getesteten Recovery-Pfad berücksichtigen.

### Deterministischer Demo-Seed

Beide Befehle rufen denselben Seed-Einstieg auf:

```text
npm run db:seed
npx prisma db seed
```

Der Seed-Vertrag `phase-25-demo-v14` verwendet stabile natürliche Schlüssel und
UUIDv5-Identitäten. Der erste Lauf legt Fixtures an oder verifiziert sie; jeder
weitere Lauf verifiziert dieselben unveränderlichen Inhalte und liefert
denselben versiegelten Manifest-Hash.

```text
npm run db:seed
npm run db:seed
npm run seed:verify
```

Enthalten sind unter anderem alle 26 Kantone, mindestens 29 Städte, 18
Kategorien, mindestens 60 Skills, 25 Firmen, mindestens 115 Jobs, die
Demo-Konten, getrennte Admin-Duties, Authenticator-/Security-Fixtures,
Candidate-/Employer-/Admin-Workflows, Billing-Snapshots, Job-Boosts,
Radar-/Reveal-, Privacy- und Trust-&-Safety-Fixtures.

Der Seed verweigert Staging, Production, produktionsbezeichnete Datenbanken und
lokale Nicht-Loopback-Ziele, bevor ein Demo-Datensatz geschrieben werden kann.
Preview-Seeding erfordert zusätzlich den nur für diesen kontrollierten Lauf
gesetzten Schalter `ENABLE_DEMO_SEED=true`; er ist bewusst kein normaler
Production-Env-Default.

## Verfügbare Routen

Der maschinenlesbare Sollstand liegt in
[`codex-plan/route-inventory.json`](./codex-plan/route-inventory.json) und wird
gegen den App-Router geprüft:

```text
npm run route:audit
```

Die Tabelle gruppiert die implementierten Einstiege; dynamische Segmente stehen
in eckigen Klammern.

| Bereich | Implementierte Routen |
|---|---|
| Öffentlich | `/`, `/jobs`, `/jobs/[slug]`, `/jobs/kanton/[slug]`, `/jobs/kategorie/[slug]`, `/jobs/kanton/[slug]/kategorie/[category]`, `/companies`, `/companies/[slug]`, `/salary-radar`, `/guide`, `/guide/[slug]`, `/pricing` |
| Arbeitgeber-Marketing | `/employers`, `/employers/demo`, `/employers/post-job`, `/employers/talent-radar`, `/employers/employer-branding`, `/employers/xml-import` |
| Auth | `/login`, `/register`, `/register/candidate`, `/register/employer`, `/forgot-password`, `/reset-password`, `/invite/[token]`, `/invite/resume`, `/logout`, Session-Refresh/Clear |
| Candidate | `/candidate/dashboard`, `/candidate/jobpass`, `/candidate/saved-jobs`, `/candidate/applications[/[id]]`, `/candidate/alerts`, `/candidate/messages[/[threadId]]`, `/candidate/talent-radar`, `/candidate/talent-radar/requests[/[id]]`, `/candidate/privacy`, Privacy-Request-Detail/Verify, `/candidate/settings/security`, `/candidate/support` |
| Employer/Recruiter | `/employer/dashboard`, `/employer/company`, `/employer/team`, `/employer/jobs[/[id]]`, `/employer/jobs/new`, `/employer/jobs/[id]/boost`, `/employer/applicants[/[id]]`, `/employer/analytics`, `/employer/billing` inklusive Usage/Profile/Checkout/Invoices, `/employer/talent-radar/requests`, `/employer/settings/security` |
| Admin | `/admin`, `/admin/jobs`, `/admin/companies`, `/admin/users`, `/admin/reports`, `/admin/imports`, `/admin/support`, `/admin/content`, `/admin/taxonomy`, `/admin/leads`, `/admin/billing`, `/admin/orders`, `/admin/invoices`, `/admin/plans`, `/admin/products`, `/admin/privacy-requests`, `/admin/analytics`, `/admin/business-cockpit`, `/admin/audit`, `/admin/system`, `/admin/security` einschließlich Roles/Grants/Authenticators/Break-glass sowie `/admin/trust-safety[/[id]]` |
| Security-Flows | `/security/step-up`, `/security/account-recovery` |
| Rollenübergreifend | `/support`, `/support/[id]`, `/alerts/unsubscribe/[token]`, `/forbidden` |
| Betriebs-/Provider-Handler | `/health/live`, `/health/ready`, Local-only `/dev/mailbox`, Employer-only `/mock/checkout/[orderId]`, signaturgegatet `/api/webhooks/payments/[provider]`, `/sitemap.xml`, `/robots.txt` |

Routen schützen nicht nur die Navigation: Layouts, Server Actions und
Repositories prüfen Rolle, Capability, Company-Mitgliedschaft,
Job-Zuweisung und Objekt-Ownership serverseitig. Fremde Objekt-IDs liefern eine
sichere 404 beziehungsweise einen Rollen-403 ohne Datenleck.

Bewusst **nicht verfügbar** sind eine öffentliche Partner-/ATS-API, SSO,
LIVE-Payment-/E-Mail-Provider, echte Datei-Downloadrouten, ein automatischer
Privacy-Export-Download und PDF-Rechnungen. Der vorhandene Payment-Webhook ist
ein deaktivierter Testadaptervertrag und keine LIVE-Providerfreigabe.

## Rollen und Berechtigungen

| Plattformrolle | Kernumfang |
|---|---|
| `CANDIDATE` | SwissJobPass, Saved Jobs, Bewerbungen, Jobabos, Nachrichten, Support, Privacy und eigener Talent-Radar-Consent/Reveal |
| `EMPLOYER` | Firmen-, Team-, Job-, Bewerber-, Billing-, Analytics- und berechtigte Talent-Radar-Workflows im eigenen Tenant |
| `RECRUITER` | Employer-Oberfläche, zusätzlich auf aktive Company-Mitgliedschaft und zugewiesene Jobs begrenzt |
| `ADMIN` | Capability-basierte Moderation, Operations, Support, Content, Billing, Katalog, Privacy und Audit; kein pauschaler UI-Vertrauensbonus |

Die globale Plattformrolle `ADMIN` verleiht allein keine Capability. Zehn
persistierte interne Rollen ordnen 50 explizite Capabilities und getrennte
Duties zu; abgelaufene oder widerrufene Assignments wirken bei der nächsten
serverseitigen Prüfung nicht mehr.

Innerhalb einer Firma existieren die Mitgliedschaftsrollen:

- `OWNER` — Eigentümeraktionen, insbesondere Planwechsel/Kündigung und
  kritische Teamverwaltung;
- `ADMIN` — operative Firmen- und zulässige Billing-/Teamaktionen;
- `RECRUITER` — Recruiting auf zugewiesenen Ressourcen;
- `VIEWER` — lesender Zugriff, soweit der jeweilige Use Case ihn erlaubt.

Eine Plattformrolle ersetzt keine Company-Mitgliedschaft. Jeder Tenant-Zugriff
prüft Mitgliedschaftsstatus, Rolle und bei Recruitern die konkrete Zuweisung.

## Monetarisierung

Preise und Packaging sind versionierte Markt- und Planungshypothesen, keine
bewiesene Zahlungsbereitschaft. Beträge werden als ganze Rappen gespeichert;
Formatierung in CHF findet erst an der Anzeigegrenze statt.

Ein lokales `CHECKOUT_COMPLETED` ist nur die Bestätigung eines Mock-Auftrags.
Es ist weder bezahlte Conversion noch Umsatz- oder
Zahlungsbereitschaftsnachweis. Vor einer Preisfreigabe müssen reale Schweizer
KMU ein vorab definiertes Angebot mit echtem, transparentem Geldfluss testen;
ein freigegebener manueller Rechnungs-Pilot kann einer Stripe-Integration
vorausgehen. Monatsabo, zeitlich begrenzter Hiring-Sprint und Retainer/Credits
werden getrennt getestet, weil gelegentliches Hiring Pause/Reaktivierung statt
dauerhafter Monatsretention erzeugen kann.

### Seed-Pläne

| Plan | Netto/Monat | Aktive Jobs | Seats | Talent Radar | Kontakte/Periode | Boosts/Periode | Analytics | Self-Service |
|---|---:|---:|---:|---|---:|---:|---|---|
| Free Basic | CHF 0 | 1 | 1 | nein | 0 | 0 | None | kein Checkout |
| Starter | CHF 149 | 3 | 2 | nein | 0 | 0 | Basic | ja |
| Pro | CHF 399 | 10 | 5 | ja | 10 | 3 | Advanced | ja |
| Business | CHF 899 | 30 | 15 | ja | 50 | 10 | Pro | Sales-Gate |
| Enterprise Contract | privat verhandelt | 100 | 50 | ja | 100 | 20 | Pro | nicht öffentlich |

Business, Enterprise und die inaktiven Jahresversionen sind nicht als
Self-Service-Checkout freigegeben. Employer-Import ist in allen P0-Plänen
standardmäßig deaktiviert.

### Produkte, Credits und Rechnungen

Aktive Mock-Self-Service-Produkte:

| Produkt | Netto | Wirkung |
|---|---:|---|
| Job Boost 7 Tage | CHF 79 | zeitgebundener, gekennzeichneter Boost |
| Job Boost 30 Tage | CHF 199 | zeitgebundener, gekennzeichneter Boost |
| Talent Radar Contact Pack 10 | CHF 99 | 10 `TALENT_CONTACT`-Credits |
| Talent Radar Contact Pack 50 | CHF 299 | 50 `TALENT_CONTACT`-Credits |

Featured Job/Employer, Newsletter, Social Push, Import Setup und Zusatzstelle
sind als inaktive P1/P2-Produkte gespeichert. `SUCCESS_FEE` ist für jede Rolle
serverseitig deaktiviert und bleibt bis zu einer ausdrücklichen rechtlichen
Prüfung inaktiv.

Credits laufen über append-only Grants/Consumption/Expiry-Belege.
Order- und Invoice-Zeilen speichern unveränderliche Preis-, Steuer-,
Währungs- und Produkt-/Plan-Snapshots. Der aktuelle Seed verwendet einen
geprüft zu bestätigenden **Planungssteuersatz von 810 Basispunkten = 8,1 %**.
Das ist keine Steuerberatung; vor einem realen Verkauf ist eine fachliche
Tax-Freigabe zwingend.

Der lokale Checkout kann einen Order bezahlen, die atomare
Mock-Fulfillment-Logik auslösen und eine HTML-Rechnung erzeugen. Es findet keine
echte Zahlung statt. Subscription-Renewal wird nicht autonom ausgeführt,
sondern als explizite Admin-Mock-Aktion dokumentiert und auditiert.

Die geprüften Business-, Cashflow-, AVG-, Salary- und Worker-Gates stehen in
[`codex-plan/commercial-go-live-gates.md`](./codex-plan/commercial-go-live-gates.md).

## Mock-Integrationen

Nur die folgenden sechs Verzeichnisse unter `lib/providers` sind externe
Provider-Ports:

| Port | Lokales Verhalten | Gate für einen Real-Adapter |
|---|---|---|
| `payments/PaymentProvider` | deterministische `/mock/checkout/...`-Operation; akzeptiert keinen Clientpreis und schreibt selbst keine Billing-Daten | Payment-/Legal-/Security-Review, Webhook-Signatur, Idempotenz, Reconciliation, Retry/Monitoring |
| `email/EmailProvider` | rendert Templates und schreibt redigierte `EmailLog`-Zeilen; kein externer Versand | gewählter Mailanbieter, DPA, Absender-/Bounce-/Suppression-/Retry-Konzept, Delivery-Monitoring |
| `ai/AiProvider` | deterministische regelbasierte Textverbesserung; kein Modellaufruf | Datenschutz-/Human-review-Policy, Timeouts, Limits, Redaction, Monitoring und freigegebener Modellanbieter |
| `jobroom/JobroomProvider` | versionierter `OccupationCode`-Fixture-Lookup mit `REQUIRES_REPORTING`, `NOT_REQUIRED` oder `UNKNOWN`; kein arbeit.swiss-Aufruf | offizielle Schnittstelle/Lizenz, Datenversionierung, Auth, Cache/Retry und rechtliche Prüfung; kein Scraping |
| `storage/StorageProvider` | validiert Dateimetadaten bis 5 MiB, speichert keine Bytes und liefert keine Read-URL | freigegebener S3/Supabase-kompatibler Speicher, Bucket/Region, Malware-Scan, signierte URLs, Retention/Deletion und DPA |
| `commute/CommuteProvider` | deterministische Haversine-Luftlinie aus Seed-Koordinaten; keine Route/Fahrzeit und kein Netzwerk | freigegebener Kartenanbieter, Datenminimierung, Quoten, Cache, DPA und klare Distanz-/Fahrzeitsemantik |

Analytics-Validierung/-Aggregation und der HTML-Invoice-Renderer sind interne
Domain-/Application-Services. Es existieren bewusst weder ein
`AnalyticsProvider` noch ein `InvoiceProvider`.

## Sicherheit und Datenschutz

- Passwörter werden mit `bcryptjs` gehasht. DB-Sessions speichern nur
  Token-Hashes; Session-Cookies sind httpOnly, `SameSite=Lax` und in
  Production `Secure`.
- Passkeys/WebAuthn, TOTP und gehashte Single-use Recovery Codes erhöhen die
  Session-Assurance. Hochrisikoaktionen verbrauchen opaque, kurzlebige und an
  Actor, Session, Purpose, Action, Tenant sowie Resource gebundene
  Step-up-Grants.
- Rollen, Capabilities, Tenant, Ownership und Recruiter-Zuweisungen werden
  serverseitig geprüft. Personalisierte und sensitive Antworten sind
  `private, no-store` und gegebenenfalls `noindex`.
- Eine per Request erzeugte Nonce schützt Next-Hydration, Theme-Script und
  geprüftes JSON-LD unter einer strikten CSP ohne
  `script-src 'unsafe-inline'`.
- Sensible öffentliche Aktionen verwenden atomare Rate-Limit-Buckets und
  `RATE_LIMITED`-Audit-Evidence. Production/Staging verlangen den gemeinsam
  genutzten PostgreSQL-Store; Prozessspeicher ist kein Produktionsschutz.
- Audit-Ereignisse, Consent-Änderungen, Kontaktanfragen, Reveals,
  Moderations-, Billing- und Privacy-Aktionen werden mit minimierten,
  allowlist-validierten Metadaten protokolliert. IP-Pseudonyme können mit
  `npm run security:maintenance` nach 30 Tagen entfernt werden, ohne das
  Audit-Ereignis zu löschen.
- Talent Radar sendet Arbeitgebern keine identitätsführenden Felder.
  Company-spezifische opake IDs, Kohortengrenzen, atomarer Credit-Verbrauch,
  kandidatengesteuerte Annahme und ein feldgenauer Reveal schützen die
  Identität.
- Consent ist versioniert und append-only. Kandidat:innen können Radar
  deaktivieren und Reveals widerrufen; abhängige Mappings und offene Requests
  werden dabei geschlossen.
- Privacy-Export, Korrektur und Löschung sind nachvollziehbare
  **Mock-Verfahren**. Ein Export erzeugt ein Manifest, aber keine ausgelieferte
  Datei; Löschung ist kein automatisches vollständiges Erasure.
- Provider-Mocks führen keine HTTP-, TCP- oder TLS-Aufrufe aus. Die Anwendung
  scrapt keine Websites und ruft insbesondere arbeit.swiss nicht automatisiert
  ab.
- Logs und Nutzerfehler werden redigiert. E-Mail-/Reset-Fehler verraten nicht,
  ob ein Konto existiert.
- `GET /health/live` prüft nur den Prozess; `GET /health/ready` prüft
  PostgreSQL, Schema und letzte Migration mit Timeouts, ohne URLs,
  Credentials oder Tabelleninhalte preiszugeben.

Diese Maßnahmen sind eine datenschutzfreundliche technische Vorbereitung,
keine abschließende DSG-/DSGVO-, Arbeitsvermittlungs-, AGB- oder
Steuerkonformitätszusage.

## Bekannte Limitationen des MVP

1. **Payment-Sandbox:** kein LIVE-Stripe, keine reale Kartenbelastung und kein
   Produktions-Settlement. Signierte Test-Webhooks, Dunning und
   Reconciliation sind technisch vorhanden, belegen aber weder
   Zahlungsbereitschaft noch PSP-/Tax-/Legal-/Finance-Freigabe.
2. **Mock Email:** Nachrichten werden als redigiertes `EmailLog` erfasst; es
   findet kein echter Versand statt. Die optionale lokale Mailbox ist kein
   Delivery-System.
3. **Mock AI:** deterministische Regeln statt eines Sprachmodells; Qualität und
   Fairness eines späteren Modells sind nicht vorweggenommen.
4. **Mock Job-Room:** versionierter Fixture-Lookup; kein aktueller
   arbeit.swiss-Call. `UNKNOWN` ist ein absichtlicher, fail-closed Zustand.
5. **Mock Storage:** nur Metadaten, keine Dateibytes, Download-URL oder
   Malware-Prüfung.
6. **Mock Commute:** ungefähre Luftlinie aus Seed-Koordinaten, keine Route oder
   Fahrzeit; bei fehlender Konfiguration kann die Funktion nicht als
   Kartenersatz dienen.
7. **Subscription-Renewal:** keine automatische Verlängerung; nur eine
   explizite Admin-Mock-Aktion.
8. **Worker nicht produktiv aktiviert:** Der persistierte Phase-23-Worker-,
   Lease-, Retry-, DLQ-/Replay- und Handlervertrag ist lokal/CI vorhanden.
   Ein deployter autonomer Scheduler, Pager/On-call und freigegebene
   SLO/RPO/RTO fehlen weiterhin und blockieren unbeaufsichtigten öffentlichen
   Self-Service.
9. **Search:** parameterisiertes PostgreSQL-SQL normalisiert Titel,
   Firmenname und Body und verwendet gewichtetes `LIKE` mit globaler
   DB-Rangfolge und signiertem Keyset-Cursor. Es gibt noch kein
   `tsvector`/GIN, keine linguistische Volltextsuche und keine
   Rechtschreib-/Synonymtoleranz. Seiten sind standardmäßig 20 und maximal 50
   Treffer groß.
10. **Sponsored-Zone:** maximal drei relevante, klar markierte Treffer auf der
    ersten Suchseite und zwei auf der Homepage; keine Wiederauffüllung auf
    Folgeseiten. Boosting beeinflusst niemals den Fair-Job-Score.
11. **SEO/Sitemap:** beliebige Filter-/Keyword-/Cursor-URLs sind
    `noindex,follow`. Cluster-Landings werden nur mit publiziertem Inhalt und
    wirksamer, dual freigegebener Live-Evidence indexiert. Die einzelne Sitemap
    ist auf 50.000 URLs begrenzt und bricht bei Überschreitung ab; ein
    Sitemap-Index/Chunking ist noch nicht implementiert.
12. **Rate-Limiting:** PostgreSQL ist der verpflichtende atomare
    Production-Store. Der Memory-Adapter ist nur Local/Test und wird nicht als
    Launch-Schutz dargestellt.
13. **Rechnungen:** internes HTML, kein PDF. Alle Beträge und Snapshots liegen
    in ganzen Rappen vor.
14. **Privacy-Verfahren:** Export und Löschung bleiben kontrollierte
    Case-/Manifest-Mocks ohne automatischen Download oder vollständige
    Datenlöschung.
15. **Betrieb und Recht:** keine bestätigte Incident-Response, DPA-Landschaft,
    AVG-/Rechts-/Steuerfreigabe oder produktive RPO/RTO-Zusage.
16. **Salary Radar:** der vorhandene Datensatz ist ausdrücklich fiktiv und
    Demo-only. Staging/Production zeigen keine Werte; die Route ist `noindex`
    und fehlt in der Sitemap, bis ein versionierter, fachlich geprüfter
    LIVE-Snapshot mit ehrlichem Berufsgruppen-/Grossregionsmapping vorliegt.

## Mock-Provider später ersetzen

Ein Providerwechsel beginnt immer am bestehenden Port und in der serverseitigen
Composition Root. Das bloße Befüllen eines Platzhalters ist absichtlich
wirkungslos und wird von der Env-Validierung abgelehnt.

| Integration | Zu implementierender Port | Aktueller Platzhalter | Zusätzlich notwendige Arbeit |
|---|---|---|---|
| Stripe | `lib/providers/payments/payment-provider.ts` | `STRIPE_SECRET_KEY` | vorhandenen deaktivierten Testadapter nach WTP-/PSP-/Tax-/Legal-/Finance-/Security-Gate mit freigegebenen Secrets, Settlement-/3DS-, Monitoring- und Incident-Evidence aktivieren; LIVE bleibt gesondert |
| Postmark/Mailgun/SendGrid | `lib/providers/email/email-provider.ts` | `EMAIL_PROVIDER_API_KEY` | Anbieterwahl, Absenderdomain, Bounce/Suppression, Templates, Retry/Outbox, Delivery-Monitoring und DPA |
| OpenAI oder anderer Modellanbieter | `lib/providers/ai/ai-provider.ts` | `OPENAI_API_KEY` | freigegebene Modell-/Region-Konfiguration, Redaction, Moderation, Limits, Timeouts, Fallback und Human Review |
| S3/Supabase-kompatibler Speicher | `lib/providers/storage/storage-provider.ts` | `STORAGE_ENDPOINT` | nach Freigabe Bucket/Region/Credentials ergänzen, Upload-Streaming, Malware-Scan, signierte URLs, Lifecycle/Deletion und DPA |
| Offizielle Job-Room-Integration | `lib/providers/jobroom/jobroom-provider.ts` | `JOBROOM_API_URL` | offizieller Zugang/Auth, Lizenz, Versionierung, Retry/Cache, Monitoring und Audit; niemals Scraping als Ersatz |
| Karten-/Commute-Service | `lib/providers/commute/commute-provider.ts` | `MAPS_API_KEY` | Anbieter/Endpoint, Routing-Semantik, Quoten, Cache, Datenschutz und Fallback |

Jeder Real-Adapter benötigt Failure-Mode-, Security-, Datenschutz- und
Operations-Tests sowie einen dokumentierten Fallback. Analytics bleibt intern;
eine spätere Vendor-Integration wäre eine neue Architekturentscheidung. Für
Rechnungen wäre ein PDF-Renderer zu ergänzen, kein erfundener
Invoice-Provider.

## Qualitäts-, Release- und Recovery-Befehle

Die normalen Gates:

```text
npm ci
npm run env:validate
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:migrate:status
npm run db:seed
npm run db:seed
npm run seed:verify
npm run db:smoke
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

`test:e2e` führt den HTTP-/Header-Smoke und danach die Playwright-Suite mit
Candidate-, Employer-, Recruiter-, Admin-, Billing-, Radar-, Search- und
Security-Flows aus. `test:e2e:hsts` prüft die HSTS-Header-Emission in einer
isolierten production-like Testkonfiguration; es beweist keine echte
TLS-Terminierung.

Zusätzliche Phase-18-Gates:

```text
npm run route:audit
npm run plan:audit
npm run security:release-scan
npm run license:audit
npm run test:release
```

`test:release` besitzt E2E-08: sauberer isolierter Clone, leere
release-/restore-benannte Datenbanken, CI-Env-Validierung ohne Datei,
Migration, zweimal identischer Seed, Production-Demo-Guard, Build,
verschlüsseltes Backup, isolierter Restore, Migration-/Manifest-/DB-Smoke,
Vier-Rollen-/Password-Reset-Smoke und Cleanup. Tatsächliche Befehle,
Exit-Codes, Commit, Checksummen, DB-Identifier, Zeiten und Blocker gehören in
[`BUILD_REPORT.md`](./BUILD_REPORT.md), nicht als unbelegte Behauptung hierher.

### Verschlüsselter Recovery-Drill

Die Wrapper sind bewusst nur für allowlistete Local-/CI-Drills bestimmt, nicht
für eine unbekannte, geteilte, Staging- oder Production-Datenbank:

```text
npm run ops:backup -- --source release-test --out <absoluter-externer-pfad>.dump.age
npm run ops:restore -- --in <absoluter-externer-pfad>.dump.age --target restore-test
```

Für Backup muss `DATABASE_URL` eine getrennte Loopback-Datenbank
`swisstalenthub_release_test_<12-32 hex>` bezeichnen. Restore verwendet eine
andere, leere `TEST_DATABASE_URL`
`swisstalenthub_restore_test_<12-32 hex>`. Output, `.sha256` und
`BACKUP_AGE_IDENTITY_FILE` müssen absolut und außerhalb des Repositories
liegen.

Der Backup-Wrapper streamt
`pg_dump --format=custom --no-owner --no-acl` direkt durch `age`, schreibt
keinen Plaintext-Dump, benennt erst den vollständigen Ciphertext atomar um und
löscht Teilartefakte bei Fehlern. Restore prüft zuerst SHA-256 und das leere,
getrennte Ziel, streamt `age --decrypt` in
`pg_restore --exit-on-error --clean --if-exists --no-owner` und prüft danach
Migration, Seed-Manifest und DB-Smoke.

Der Architektur-Zielwert für einen später freigegebenen produktiven
Backupdienst lautet 30 tägliche plus 12 monatliche verschlüsselte Objekte.
RPO ≤ 24 Stunden und RTO ≤ 8 Stunden sind **unbestätigte Hypothesen**, bis
wiederholte Drills und Business/Ops sie freigeben. Backupbytes, private
Identitäten, DB-URLs und Credentials dürfen nie committed werden.

## Deployment-Hinweise

Ein Deployment ist erst zulässig, nachdem der grüne technische Release-Report
vorliegt **und** sämtliche dafür relevanten, weiterhin offenen
AVG-/Legal-/Privacy-/Tax-/Commercial-/Data-/Provider-/Ops-Gates geschlossen
und freigegeben wurden.

1. Einen verwalteten, PostgreSQL-16-kompatiblen Anbieter in einer
   freigegebenen Schweizer/EU-Region mit TLS, Backups, Restore-Möglichkeit,
   DPA, Monitoring und Zugriffskontrolle auswählen. Im Repository ist bewusst
   kein konkreter Cloudanbieter freigegeben.
2. Secrets aus einem Secret Manager injizieren, nicht aus einer committed
   Env-Datei. Production benötigt insbesondere `APP_ENV=production`,
   `NODE_ENV=production`, `DATABASE_URL`, eine HTTPS-`APP_URL`,
   `APP_BUILD_ID`, Session-/Keyring-Secrets,
   `RATE_LIMIT_BACKEND=postgres`, die exakte `TRUSTED_PROXY_HOPS`-Zahl,
   `ENABLE_LOCAL_MOCK_MAILBOX=false` und eine geprüfte
   `ABUSE_REPORT_ADMIN_EMAILS`-Liste. `TEST_DATABASE_URL` und alle
   Real-Provider-Platzhalter bleiben leer.
3. Der äußerste Ingress muss HTTPS terminieren, eingehende
   `X-Forwarded-For`-Werte verwerfen und selbst neu setzen. Nur unter echter
   HTTPS-Auslieferung darf der in `APP_ENV=production` gesetzte
   `Strict-Transport-Security`-Header wirksam werden.
4. Production setzt Session- und Company-Context-Cookies automatisch auf
   `Secure`; httpOnly und `SameSite=Lax` gelten in jeder Umgebung.
5. Installation, Migration und Build erfolgen reproduzierbar:

   ```text
   npm ci
   npm run env:validate
   npm run db:generate
   npm run db:migrate
   npm run db:migrate:status
   npm run build
   npm run start
   ```

6. Demo-Seeding ist in Staging/Production verboten. Readiness erst nach
   erfolgreicher Migration aktivieren und `/health/live` sowie
   `/health/ready` überwachen.
7. Ein autonomer Worker/Outbox muss vor unbeaufsichtigtem öffentlichem
   Self-Service Alerts, Renewal und fällige Projektionen mit Lease,
   Idempotenz, Retry/Backoff, Dead-Letter und Monitoring betreiben. Ein
   externer, serieller Scheduler müsste zusätzlich
   `npm run security:maintenance` mindestens täglich ausführen. Beides gehört
   nicht zum MVP und bleibt ein Go-live-Gate.
8. Rollback bedeutet nicht `db push` oder ein blindes Down-Script. Eine frühere
   App-Version darf nur bei bestätigter Schema-Kompatibilität zurückgesetzt
   werden; andernfalls ist der geprobte, verschlüsselte Restore in ein neues
   isoliertes Ziel mit anschließendem Smoke und kontrolliertem Cutover nötig.

## Rechtlicher und Compliance-Hinweis

> **Datenschutzfreundliches MVP — keine Rechtsberatung. Ein entgeltlicher
> Online-Stellenmarkt und Talent-Radar-Kontaktfluss werden erst nach konkreter
> AVG/AVV-Prüfung und gegebenenfalls erforderlicher Bewilligung real betrieben.
> Success Fee bleibt zusätzlich deaktiviert.**

Zusätzlich benötigen insbesondere Datenschutzerklärung, AGB, Aufbewahrung und
Löschung, Talent-Radar-Kohorten, Recontact-Regeln, Stellenmeldepflicht,
Steuerbehandlung, Datenstandorte, Auftragsbearbeitung und Incident-Prozesse eine
fachliche Freigabe vor einem realen Betrieb.

SECO weist darauf hin, dass regelmässige, entgeltliche Zusammenführung von
Stellensuchenden und Arbeitgebenden bewilligungspflichtige private
Arbeitsvermittlung sein kann; Inlandstätigkeit ist kantonal,
grenzüberschreitende Tätigkeit zusätzlich eidgenössisch zu beurteilen:
[SECO – Private Arbeitsvermittlung und Personalverleih](https://www.seco.admin.ch/de/private-arbeitsvermittlung-und-personalverleih).

## Plan, Requirements und Evidence

- [`AGENTS.md`](./AGENTS.md) — End-to-End- und Evidence-Regeln;
- [`codex-plan/00-PLAN.md`](./codex-plan/00-PLAN.md) — Masterplan und
  Product-/Pilot-Gates;
- [`codex-plan/requirements-matrix.md`](./codex-plan/requirements-matrix.md) —
  P0- und E2E-Traceability;
- [`codex-plan/product-quality-gates.md`](./codex-plan/product-quality-gates.md)
  — Qualitäts- und Release/Operations-Gates;
- [`codex-plan/commercial-go-live-gates.md`](./codex-plan/commercial-go-live-gates.md)
  — bewertete Businessbefunde sowie offene WTP-, Cashflow-, AVG-, Salary- und
  Worker-Gates;
- [`codex-plan/18-documentation-final-audit.md`](./codex-plan/18-documentation-final-audit.md)
  — Phase-18-Vertrag;
- [`codex-plan/evidence/README.md`](./codex-plan/evidence/README.md) —
  Evidence-Index einschließlich Phase 18;
- [`BUILD_REPORT.md`](./BUILD_REPORT.md) — Zielcommit, tatsächlich ausgeführte
  Gates, E2E-08, bekannte Blocker und ehrlicher Freigabestatus.

Ein Checkbox-Häkchen bedeutet „im Zielcommit implementiert und verifiziert“.
Ein fehlendes Tool, eine unerreichbare Datenbank oder ein nicht gelaufener
Recovery-Drill bleibt `Needs Verification` und blockiert den betreffenden
Release-Gate; ein erfolgreicher Build ersetzt diesen Nachweis nicht.
