# SwissTalentHub / PortalGERM

SwissTalentHub ist ein Schweizer Job-Marktplatz für Stellensuchende, Arbeitgeber,
Recruiter und Plattform-Operations. Der kontrollierte MVP verbindet öffentliche
Job- und Firmensuche, transparente Lohnbänder und einen versionierten
Fair-Job-Score mit Candidate-, Employer- und Admin-Workflows. Talent Radar schützt
die Identität von Kandidat:innen bis zu einer ausdrücklich bestätigten,
feldgenauen Freigabe. Bezahlte Job-Boosts werden sichtbar gekennzeichnet und
verändern niemals den Fair-Job-Score.

Der aktuelle Stand ist **Demo-ready für lokale Vorführungen und kontrollierte
interne Produkt-Evaluationen**. Er ist **weder pilot-ready noch
Production-ready**. Phase 33 ergänzt technisch konfigurierbare Resend-,
S3-/ClamAV- und Stripe-Adapter sowie getrennte lokale Mock- und
Production-Contract-Runtimes; diese verwenden im Test ausschließlich lokale
Stubs und sind nicht aktiviert. AVG-/Rechts-/Datenschutz-/Steuerfreigaben,
echte Providerkonten und Zielumgebung, bezahlte Marktvalidierung, ein
monatliches Cashflow-/Runway-Modell, ein fachlich freigegebener
LIVE-Lohndatensatz, Pager/On-call, Incident-Prozesse und bestätigte
Recovery-SLAs bleiben separate externe Go-live-Gates.

[`BUILD_REPORT.md`](./BUILD_REPORT.md) dokumentiert unverändert den
historischen Phase-18-Candidate; daraus folgt kein Testurteil für den aktuellen
Phase-33-Baum. Der Phase-33-Abschluss erhält einen eigenen commit- und
artefaktgebundenen Evidence-Record und ein getrenntes technisches/
aktivierungsbezogenes Urteil.

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
Pager und Drills freigegeben sind. Ausserhalb Local/CI sperrt der MFA-Default
zusätzlich den gesamten Adminbereich statt Passwortzugriff als Fallback
zuzulassen. Das Betriebsverfahren steht im
[`Security-&-Trust-Operations-Runbook`](./codex-plan/runbooks/security-trust-operations.md).

Dieses Verzeichnis ist ein eigenes verschachteltes Git-Repository. Die
[`CLAUDE.md`](./CLAUDE.md) grenzt es ausdrücklich vom separaten Elternprojekt
`Portal.git` ab; dessen Providerregeln gelten hier nicht.

## Demo-Konten

Die folgenden Konten existieren nur nach dem lokalen/CI-Demo-Seed. Das gemeinsame
Passwort lautet `Demo12345!`. Diese Zugangsdaten dürfen niemals in Staging oder
Production angelegt oder wiederverwendet werden.

| Perspektive                | E-Mail                                      | Rolle / Fixture                                                                                                       | Einstieg                  |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Kandidat:in                | `candidate@demo.ch`                         | `CANDIDATE`                                                                                                           | `/candidate/dashboard`    |
| Arbeitgeber                | `employer@demo.ch`                          | `EMPLOYER`, Owner von NovaRigi Digital AG, Pro                                                                        | `/employer/dashboard`     |
| Recruiter                  | `recruiter@demo.ch`                         | `RECRUITER`, zugewiesene NovaRigi-Jobs                                                                                | `/employer/dashboard`     |
| Plattform-/Operationsadmin | `admin@demo.ch`                             | `ADMIN` mit expliziten Platform-, Moderation-, Support-, Content-, Finance-, Privacy-Process- und Trust-Review-Rollen | `/admin`                  |
| Security-Admin             | `security-admin@demo.swisstalenthub.test`   | `ADMIN`, Security und unabhängige Trust-Freigabe                                                                      | `/admin/security`         |
| Privacy-Verifier           | `privacy-verifier@demo.swisstalenthub.test` | `ADMIN`, getrennte Privacy-Verifikation                                                                               | `/admin/privacy-requests` |

Für Plan- und Entitlement-Vergleiche erzeugt derselbe Seed zusätzlich diese
Arbeitgeber-Owner:

| Plan                | Firma                          | Login                                                        |
| ------------------- | ------------------------------ | ------------------------------------------------------------ |
| Free Basic          | Alpenfaden Atelier GmbH        | `owner+alpenfaden-atelier@demo.swisstalenthub.test`          |
| Starter             | Rheintal Werkbogen AG          | `owner+rheintal-werkbogen@demo.swisstalenthub.test`          |
| Pro                 | NovaRigi Digital AG            | `employer@demo.ch`                                           |
| Business            | Carevia Quartiergesundheit AG  | `owner+carevia-quartiergesundheit@demo.swisstalenthub.test`  |
| Enterprise Contract | Quarzspindel Industriewerke AG | `owner+quarzspindel-industriewerke@demo.swisstalenthub.test` |

## Verbindliche Runtime und Tech-Stack

| Bereich     | Implementierung                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | Node.js `24.18.0`, npm `11.16.0`                                                                                                                                             |
| Web         | Next.js `16.2.11` App Router, React `19.2.7`, TypeScript `5.9.3`                                                                                                             |
| UI          | Tailwind CSS `4.3.3`, shadcn CLI `4.13.1`, Base UI, Lucide                                                                                                                   |
| Daten       | PostgreSQL 16, Prisma ORM/Client `7.9.1`                                                                                                                                     |
| Validierung | Zod `4.4.3`, zusätzliche Domain- und SQL-Constraints                                                                                                                         |
| Auth        | Eigene E-Mail/Passwort-Authentifizierung mit `bcryptjs`, persistierten DB-Sessions, httpOnly-Cookie sowie WebAuthn/TOTP/Recovery und aktionsgebundenem Step-up; kein Auth.js |
| Tests       | Vitest `4.1.10`, Testing Library, Playwright `1.61.1`, axe-core                                                                                                              |
| Provider    | Serverseitige Ports mit Local-Mocks sowie fail-closed Resend-, S3-/ClamAV- und Stripe-Contract/Sandbox/Live-Adaptern; Code oder Secrets allein aktivieren keinen Use Case    |

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

| Verzeichnis                  | Verantwortung                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`app`](./app)               | Next.js-Routen, Layouts, Server Actions und Route Handler                                                       |
| [`components`](./components) | UI-Primitives und rollenbezogene Oberflächen                                                                    |
| [`lib`](./lib)               | Domain-Policies, Auth, Billing, Search, Privacy, Provider-Ports und autorisierte Datenzugriffe                  |
| [`prisma`](./prisma)         | Schema, 68 committed Migrationen (67 historische plus eine additive Phase-33-Migration), deterministischer Seed |
| [`tests`](./tests)           | Unit-, PostgreSQL-Integration- und Playwright-E2E-Suiten                                                        |
| [`scripts`](./scripts)       | plattformneutrale Env-, DB-, Release-, Security- und Recovery-Werkzeuge                                         |
| [`codex-plan`](./codex-plan) | verbindlicher Plan, ADRs, Requirements und Evidence                                                             |

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

| Variable               | Pflicht / Scope    | Beschreibung                                                                                                                       |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`              | immer              | `local`, `ci`, `preview`, `staging` oder `production`; steuert Sicherheits- und Seed-Gates                                         |
| `NODE_ENV`             | immer              | Node-Laufzeit `development`, `test` oder `production`                                                                              |
| `DATABASE_URL`         | immer              | Explizite PostgreSQL-URL; in CI muss der DB-Name `ci`/`test` enthalten                                                             |
| `TEST_DATABASE_URL`    | Local/CI           | Getrennte, testbenannte PostgreSQL-DB; in CI Pflicht, in Staging/Production verboten                                               |
| `APP_URL`              | immer              | Absolute credential-, Query-, Fragment- und Pfad-freie HTTP(S)-Origin; Staging/Production nur HTTPS                                |
| `NEXT_PUBLIC_APP_NAME` | immer              | Öffentlicher Produktname, standardmäßig `SwissTalentHub`                                                                           |
| `APP_BUILD_ID`         | Staging/Production | Nicht sensitiver, commit-eindeutiger Build-Identifier; lokal `local-development`                                                   |
| `LOG_LEVEL`            | immer              | `debug`, `info`, `warn` oder `error`                                                                                               |
| `TRUSTED_PROXY_HOPS`   | immer              | Lokal `0`; in Preview/Staging/Production exakt `1` bis `8` gemäß kontrollierter Ingress-Topologie; auf direktem Vercel-Ingress `1` |

Eine vollständig explizite Prozesskonfiguration muss mindestens `APP_ENV`,
`DATABASE_URL` und `APP_URL` gemeinsam bereitstellen; sie wird nicht still mit
lokalen Env-Dateien ergänzt.

### Secrets, Rotation und lokale Mailbox

| Variable                       | Pflicht / Scope                 | Beschreibung                                                                        |
| ------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| `SESSION_SECRET`               | immer                           | Kanonisches Base64 für exakt 32 zufällige Bytes                                     |
| `AUDIT_IP_HASH_KEYS`           | immer                           | Versioniertes HMAC-Keyring für Audit-IP-Pseudonyme                                  |
| `RADAR_OPAQUE_LOOKUP_KEYS`     | immer                           | Versioniertes HMAC-Keyring für opake Radar-Lookups                                  |
| `RADAR_OPAQUE_ENCRYPTION_KEYS` | immer                           | Versioniertes Verschlüsselungs-Keyring für Radar-Mappings                           |
| `REVEAL_CONFIRMATION_KEYS`     | immer                           | Versioniertes HMAC-Keyring für einmalige Reveal-Bestätigungen                       |
| `PII_REVEAL_KEYS`              | immer                           | Versioniertes Verschlüsselungs-Keyring für freigegebene Identitätswerte             |
| `NOTIFICATION_DELIVERY_KEYS`   | immer                           | Eigenständiges AES-256-GCM-Keyring für eingefrorenes Provider-Requestmaterial und den zeilengebundenen expliziten Empfängerumschlag; niemals für Hashes verwenden |
| `NOTIFICATION_RECIPIENT_HASH_KEYS` | immer                       | Davon getrenntes HMAC-Keyring für Empfänger-Lookup, Korrelation und Suppression; niemals als Verschlüsselungsschlüssel verwenden |
| `ENABLE_LOCAL_MOCK_MAILBOX`    | Local/Test                      | Standard `false`; in Production-Builds, Staging und Production zwingend `false`     |
| `DEV_MAILBOX_SECRET`           | bei aktivierter lokaler Mailbox | Base64/Base64url für mindestens 32 zufällige Bytes                                  |
| `ABUSE_REPORT_ADMIN_EMAILS`    | Staging/Production              | Kommagetrennte, geprüfte Empfängerliste; `admin@demo.ch` ist nur der lokale Default |

Alle `*_KEYS` verwenden kommaseparierte Einträge
`version:base64-32-byte-key`. Der **erste** Eintrag ist der aktive Writer.
Ältere, eindeutige Einträge werden nur zum Lesen behalten, bis kein
persistierter Datensatz mehr auf sie verweist. Schlüsselmaterial darf weder
zwischen Keyrings noch mit `SESSION_SECRET` wiederverwendet werden.

### Rate-Limiting, Recovery und Provider

| Variable                                                                   | Pflicht / Scope        | Beschreibung                                                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_BACKEND`                                                       | immer                  | `postgres`; `memory` ist ausschließlich ein Local/Test-Adapter                                                                                       |
| `BACKUP_AGE_RECIPIENT`                                                     | Recovery-Drill         | Ein öffentlicher X25519-`age1...`-Empfänger                                                                                                          |
| `BACKUP_AGE_IDENTITY_FILE`                                                 | Restore-Drill          | Absoluter, geschützter Secret-Mount außerhalb des Repositories; enthält nur den Pfad, nie das Keymaterial selbst                                     |
| `EMAIL_PROVIDER_MODE`                                                      | immer                  | `disabled`, Local/CI `local_mock`, isoliert `resend_contract`, geprüftes Non-Production `resend_sandbox` oder Production `resend_live`               |
| `EMAIL_PROVIDER_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_SECRET_VERSION`, `RESEND_WEBHOOK_SECRET_VERSION` | Resend-Modus           | Getrennte Secret-Mounts und nicht geheime Versionsreferenzen für API- und Webhook-Authority; erteilen allein keine Autorität                           |
| `DOCUMENT_STORAGE_MODE`                                                    | immer                  | `disabled`, Local/CI `filesystem_sandbox`, isoliert `s3_contract` oder Production `s3_live`                                                          |
| `DOCUMENT_SCANNER_MODE`                                                    | immer                  | `disabled`, Local/CI `sandbox`, isoliert `clamav_contract` oder Production `clamav_live`; Production akzeptiert nur das freigegebene S3-/ClamAV-Paar |
| `DOCUMENT_STORAGE_*`, `DOCUMENT_SCANNER_*`                                 | Storage-/Scanner-Modus | Endpoint, Bucket, Region, Verschlüsselung, Secret-Version und Scannertransport; exakte Ledgerbindung bleibt Pflicht                                  |
| `OPENAI_API_KEY`                                                           | Platzhalter            | Für den Mock-MVP leer lassen                                                                                                                         |
| `JOBROOM_API_URL`                                                          | Platzhalter            | Für den Mock-MVP leer lassen                                                                                                                         |
| `MAPS_API_KEY`                                                             | Platzhalter            | Für den Mock-MVP leer lassen                                                                                                                         |

Jeder nicht deaktivierte Provider-Modus benötigt zusätzlich einen exakten,
aktuellen `ProviderActivation`-Eintrag für Environment, Use Case, Adapter,
Version, Mode, Config-/Evidence-Digest, Secret-Version, Health, Owner und Kill
Switch. Ein Env-Wert oder Secret aktiviert nie automatisch einen Real-Adapter;
Mock/Sandbox/Demo/`.invalid` und Live→Mock-Fallback sind in Production
verboten.

### Notification-Zustellmaterial und Empfänger-Evidence

Der Phase-33-Vertrag trennt Verschlüsselung und pseudonyme Korrelation
strukturell: `NOTIFICATION_DELIVERY_KEYS` verschlüsselt das eingefrorene
Provider-Requestmaterial und den expliziten Empfängerumschlag;
`NOTIFICATION_RECIPIENT_HASH_KEYS` erzeugt ausschließlich HMAC-basierte
Empfänger-Hashes für Korrelation und Suppression. Die jeweiligen
Schlüsselversionen werden am Datensatz inventarisiert. Das Resend-API-Secret
und das Webhook-Secret rotieren ebenfalls unabhängig über
`RESEND_SECRET_VERSION` beziehungsweise `RESEND_WEBHOOK_SECRET_VERSION` und
dürfen keine Autorität füreinander ableiten.

Der explizite Empfängerumschlag ist als zeilengebundene AES-v2-Evidence
höchstens 31 Tage gültig. Im normalen Versandpfad verfallen Empfänger- und
Provider-Requestmaterial nach 23 Stunden; eine minutenbasierte Maintenance
löscht es providerunabhängig auch bei deaktiviertem oder widerrufenem
Provider. Korrelierbare Attempt-Evidence (`providerReceipt`,
`providerRequestDigest`, Empfänger-Hash und dessen Schlüsselversion) wird nach
exakt `400 × 24 h` einmalig kompaktiert. Die nicht-PII Audit-/Timeline-Kette
bleibt erhalten und unveränderlich.

Netzwerkfehler, HTTP 408/5xx, malformed/oversized 2xx und konkurrierende
Idempotency-Konflikte sind **unbekannte Provider-Ausgänge**, nicht sichere
Fehlschläge. Sie erhalten nur bounded Retries mit demselben Idempotency-Key und
wechseln danach auf `PAUSED` zur manuellen Reconciliation; weder Blind-Resend
noch automatisches Dead Letter ist zulässig. Ein Resend-Webhook darf erst in
derselben Transaktion nach einem Lock der exakten `ProviderActivation` Inbox-
oder Suppression-Wirkung erzeugen. Inboxidentität und Suppressionsevidenz sind
append-only/monoton; nur die ausdrücklich erlaubten einmaligen
Status-/Release-Übergänge sind mutierbar.

Diese technischen Lebenszyklen sind im Phase-33-Arbeitsbaum implementiert,
aber noch keine Go-live-Evidence: Exact-candidate-G4 sowie reale Provider-,
Privacy-/Legal-/DPA-/AVG-/SECO-/Tax-/Finance-/Operations-/Stagingfreigaben
bleiben offen.

### Payment-Sandbox und Finance

Alle Payment-Schalter sind standardmässig geschlossen. Der Stripe-Adapter
kennt getrennte Contract-, Sandbox- und Live-Modi. `stripe_contract` ist nur
im isolierten Phase-33-Profil zulässig; `stripe_live` verwendet den festen
Stripe-Endpunkt und verlangt Production-Credentials sowie die exakte
Activation-Ledger-Bindung. Der vorhandene Live-Code und Environment-Werte
allein sind keine Provider-, Finance-, Tax-, Legal- oder WTP-Freigabe.

| Variable                  | Sicherer Default / Scope | Beschreibung                                                                                                                    |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER_MODE`   | `disabled`               | `stripe_contract`, `stripe_sandbox` oder `stripe_live` nur in der jeweils erlaubten Umgebung und mit passender Ledger-Autorität |
| `PAYMENT_SANDBOX_COHORT`  | `none`                   | `test` nur für eine ausdrücklich freigegebene Testkohorte                                                                       |
| `REAL_PAYMENT_INGESTION`  | `false`                  | Erlaubt nach Provider-Gate nur signaturgeprüfte durable Inbox-Writes                                                            |
| `REAL_PAYMENT_PROJECTION` | `false`                  | Projiziert Inbox-Ereignisse; setzt Ingestion voraus                                                                             |
| `PAID_SELF_SERVICE`       | `false`                  | Checkout-Kill-Switch; benötigt zusätzlich WTP-Go, Providerledger und Step-up                                                    |
| `FINANCE_REPAIR_ACTIONS`  | `false`                  | Refund-/Repair-Mutationen; bleibt bis Phase 25A geschlossen                                                                     |
| `PAID_SERVICE_RECOVERY`   | `false`                  | Führt genehmigte, policygebundene Remedies aus                                                                                  |
| `STRIPE_ACCOUNT_ID`       | leer                     | Exakte Merchant-Account-ID aus dem Activation Ledger                                                                            |
| `STRIPE_SECRET_KEY`       | leer                     | Nur secret-gemounteter, zum gewählten Sandbox-/Live-Modus passender Schlüssel; nie committen oder loggen                        |
| `STRIPE_WEBHOOK_SECRET`   | leer                     | Secret-Mount für Raw-Body-Signaturprüfung                                                                                       |
| `STRIPE_SECRET_VERSION`   | leer                     | Nicht geheime Referenz auf die freigegebene Secret-Version                                                                      |

Die Aktivierungsreihenfolge und Incident-/Reconciliation-Abläufe stehen in
[`codex-plan/runbooks/payment-operations.md`](./codex-plan/runbooks/payment-operations.md).

### Privileged Assurance und Trust & Safety

Diese vier Phase-25-Schalter sind unabhängig von den Payment-Schaltern und
standardmässig fail-closed:

| Variable                  | Sicherer Default | Beschreibung                                                                                                                                                          |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_MFA_REQUIRED`      | `false`          | Local/CI-Vertrag ohne globalen Cutover; in Preview/Staging/Production sperrt `false` den gesamten Adminbereich, `true` erzwingt den bestehenden AAL2-/Enrollment-Pfad |
| `PRIVILEGED_STEP_UP_MODE` | `disabled`       | `observe` protokolliert; `enforce` verlangt action-/actor-/session-/tenant-/resource-gebundene Single-use Grants                                                      |
| `TRUST_RISK_MODE`         | `observe`        | Erlaubt erst nach Policyfreigabe den Modus `hold`; Observe allein widerruft keine Fachobjekte                                                                         |
| `BREAK_GLASS_ENABLED`     | `false`          | Öffnet nur zeitgebundene, incidentgebundene und auditierte Grants; nie einen globalen Admin-Fallback                                                                  |

Die zulässige Aktivierungsreihenfolge, Kill Switches, Device-Loss-,
Appeal-/Restore- und Worker-Failure-Abläufe stehen im
[`Security-&-Trust-Operations-Runbook`](./codex-plan/runbooks/security-trust-operations.md).

## PostgreSQL, Migrationen und Seed

### Lokale Dienste

| Dienst          | Zweck                       |        Host-Port | Persistenz                             |
| --------------- | --------------------------- | ---------------: | -------------------------------------- |
| `postgres`      | lokale Entwicklung          | `127.0.0.1:5434` | Named Volume `swisstalenthub-postgres` |
| `postgres-test` | isolierte Integrationstests | `127.0.0.1:5435` | flüchtiges `tmpfs`                     |

```text
docker compose up -d postgres
docker compose --profile test up -d postgres-test
docker compose config --quiet
```

Compose und Linux-CI verwenden PostgreSQL `16.13-alpine` mit festem
Image-Digest. CI arbeitet ausschließlich mit kurzlebigen, testbenannten
Service-Datenbanken.

Phase 33 ergänzt in [`compose.phase33.yml`](./compose.phase33.yml) zwei davon
getrennte Profile:

- `local/mock`: gebaute App, Worker, Scheduler und PostgreSQL mit lokalen
  Mailbox-, Filesystem- und Scanner-Doubles; Payment bleibt deaktiviert;
- `production-contract`: dasselbe Standalone-/OCI-Artefakt mit separatem
  Worker/Scheduler, PostgreSQL 16, TLS-Proxy, S3-kompatiblem Object Storage,
  ClamAV und lokalen Resend-/Stripe-HTTP-Stubs. Es führt echten Adaptercode
  aus, erzeugt aber keine externe Wirkung und ist keine Live-Evidence.

```text
npm run phase33:runtime:config:local
npm run phase33:runtime:up:local
npm run phase33:runtime:down:local
npm run phase33:runtime:config:contract
npm run phase33:runtime:smoke:contract
npm run phase33:runtime:down:contract
```

`PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT=true` ist ausschließlich der enge,
loopbackgebundene Startvertrag des lokalen Mock-Containers bei
`APP_ENV=local`; Preview, Staging und Production lehnen ihn ab.

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
- Die **68 committed Migrationen** bestehen aus 67 bytegenau geschützten
  historischen Migrationen und einer additiven Phase-33-Migration. Sie reichen
  von der Baseline über Domain-,
  Billing-, Radar-, Search- und Security-Verträge bis zu Phase-22-Privacy-,
  Legal-, Worker-, Phase-24-Payment-/Finance- und Phase-25-Assurance-/
  Trust-&-Safety-Constraints sowie den Phase-33-Providerbindungen für
  Subscriptions und Payment-Events.
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
gegen den App-Router geprüft. Derselbe Audit bindet außerdem alle exportierten
Server Actions und schema-definierten Laufzeitkontrollen an die exakten
Quellen in
[`codex-plan/server-action-inventory.json`](./codex-plan/server-action-inventory.json)
und
[`codex-plan/feature-flag-inventory.json`](./codex-plan/feature-flag-inventory.json):

```text
npm run route:audit
```

Die Tabelle gruppiert die implementierten Einstiege; dynamische Segmente stehen
in eckigen Klammern.

| Bereich                    | Implementierte Routen                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Öffentlich                 | `/`, `/jobs`, `/jobs/[slug]`, `/jobs/kanton/[slug]`, `/jobs/kategorie/[slug]`, `/jobs/kanton/[slug]/kategorie/[category]`, `/companies`, `/companies/[slug]`, `/salary-radar`, `/guide`, `/guide/[slug]`, `/pricing`                                                                                                                                                                                                                                                                    |
| Arbeitgeber-Marketing      | `/employers`, `/employers/demo`, `/employers/post-job`, `/employers/talent-radar`, `/employers/employer-branding`, `/employers/xml-import`                                                                                                                                                                                                                                                                                                                                              |
| Auth                       | `/login`, `/register`, `/register/candidate`, `/register/employer`, `/forgot-password`, `/reset-password`, `/invite/[token]`, `/invite/resume`, `/logout`, Session-Refresh/Clear                                                                                                                                                                                                                                                                                                        |
| Candidate                  | `/candidate/dashboard`, `/candidate/jobpass`, `/candidate/saved-jobs`, `/candidate/applications[/[id]]`, `/candidate/alerts`, `/candidate/messages[/[threadId]]`, `/candidate/talent-radar`, `/candidate/talent-radar/requests[/[id]]`, `/candidate/privacy`, Privacy-Request-Detail/Verify, `/candidate/settings/security`, `/candidate/support`                                                                                                                                       |
| Employer/Recruiter         | `/employer/dashboard`, `/employer/company`, `/employer/team`, `/employer/jobs[/[id]]`, `/employer/jobs/new`, `/employer/jobs/[id]/boost`, `/employer/applicants[/[id]]`, `/employer/analytics`, `/employer/billing` inklusive Usage/Profile/Checkout/Invoices, `/employer/talent-radar/requests`, `/employer/settings/security`                                                                                                                                                         |
| Admin                      | `/admin`, `/admin/jobs`, `/admin/companies`, `/admin/users`, `/admin/reports`, `/admin/imports`, `/admin/support`, `/admin/content`, `/admin/taxonomy`, `/admin/leads`, `/admin/billing`, `/admin/orders`, `/admin/invoices`, `/admin/plans`, `/admin/products`, `/admin/privacy-requests`, `/admin/analytics`, `/admin/business-cockpit`, `/admin/audit`, `/admin/system`, `/admin/security` einschließlich Roles/Grants/Authenticators/Break-glass sowie `/admin/trust-safety[/[id]]` |
| Security-Flows             | `/security/step-up`, `/security/account-recovery`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rollenübergreifend         | `/support`, `/support/[id]`, `/alerts/unsubscribe/[token]`, `/forbidden`                                                                                                                                                                                                                                                                                                                                                                                                                |
| Betriebs-/Provider-Handler | `/health/live`, `/health/ready`, Local-only `/dev/mailbox`, Employer-only `/mock/checkout/[orderId]`, signaturgegatet `/api/webhooks/payments/[provider]` und `/api/webhooks/email/resend`, autorisierte Document-/Privacy-Export-Handler, `/sitemap.xml`, `/robots.txt`                                                                                                                                                                                                                |

Routen schützen nicht nur die Navigation: Layouts, Server Actions und
Repositories prüfen Rolle, Capability, Company-Mitgliedschaft,
Job-Zuweisung und Objekt-Ownership serverseitig. Fremde Objekt-IDs liefern eine
sichere 404 beziehungsweise einen Rollen-403 ohne Datenleck.

Bewusst **nicht verfügbar** sind eine öffentliche Partner-/ATS-API, SSO,
aktivierte LIVE-Provider und PDF-Rechnungen. Autorisierte Document-Reads und
Privacy-Export-Downloads existieren, bleiben aber an aktuellen Owner/Grant,
Quarantäne-/Scanstatus, Retention und den freigegebenen Storage-/Privacy-Modus
gebunden. Resend-/Stripe-Webhooks und Live-Adaptercode sind ohne exakte
Provider- und externe Aktivierung wirkungslos und keine LIVE-Freigabe.

## Rollen und Berechtigungen

| Plattformrolle | Kernumfang                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CANDIDATE`    | SwissJobPass, Saved Jobs, Bewerbungen, Jobabos, Nachrichten, Support, Privacy und eigener Talent-Radar-Consent/Reveal                 |
| `EMPLOYER`     | Firmen-, Team-, Job-, Bewerber-, Billing-, Analytics- und berechtigte Talent-Radar-Workflows im eigenen Tenant                        |
| `RECRUITER`    | Employer-Oberfläche, zusätzlich auf aktive Company-Mitgliedschaft und zugewiesene Jobs begrenzt                                       |
| `ADMIN`        | Capability-basierte Moderation, Operations, Support, Content, Billing, Katalog, Privacy und Audit; kein pauschaler UI-Vertrauensbonus |

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

| Plan                |       Netto/Monat | Aktive Jobs | Seats | Talent Radar | Kontakte/Periode | Boosts/Periode | Analytics | Self-Service     |
| ------------------- | ----------------: | ----------: | ----: | ------------ | ---------------: | -------------: | --------- | ---------------- |
| Free Basic          |             CHF 0 |           1 |     1 | nein         |                0 |              0 | None      | kein Checkout    |
| Starter             |           CHF 149 |           3 |     2 | nein         |                0 |              0 | Basic     | ja               |
| Pro                 |           CHF 399 |          10 |     5 | ja           |               10 |              3 | Advanced  | ja               |
| Business            |           CHF 899 |          30 |    15 | ja           |               50 |             10 | Pro       | Sales-Gate       |
| Enterprise Contract | privat verhandelt |         100 |    50 | ja           |              100 |             20 | Pro       | nicht öffentlich |

Business, Enterprise und die inaktiven Jahresversionen sind nicht als
Self-Service-Checkout freigegeben. Employer-Import ist in allen P0-Plänen
standardmäßig deaktiviert.

### Produkte, Credits und Rechnungen

Aktive Mock-Self-Service-Produkte:

| Produkt                      |   Netto | Wirkung                                |
| ---------------------------- | ------: | -------------------------------------- |
| Job Boost 7 Tage             |  CHF 79 | zeitgebundener, gekennzeichneter Boost |
| Job Boost 30 Tage            | CHF 199 | zeitgebundener, gekennzeichneter Boost |
| Talent Radar Contact Pack 10 |  CHF 99 | 10 `TALENT_CONTACT`-Credits            |
| Talent Radar Contact Pack 50 | CHF 299 | 50 `TALENT_CONTACT`-Credits            |

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

## Provider-Integrationen und lokale Test-Doubles

Die folgenden Ports kapseln externe Providergrenzen. Local/CI bleibt
mock-first; Phase 33 ergänzt für die LC4-/LC5-Pflichtpfade echte Adapter hinter
derselben Composition Root und einer exakten Activation-Ledger-Bindung.

| Port                           | Implementierter technischer Stand                                                                                                                                     | Noch erforderliches Aktivierungsgate                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `payments/PaymentProvider`     | deterministischer Mock plus Stripe Contract/Sandbox/Live HTTP-Adapter, hosted Checkout, signierte Inbox, Reconciliation, Refund/Dispute/Dunning und Providerbinding   | PSP-Konto/Vertrag, Account/Price/Webhook, WTP, Finance/Tax/Legal/Security, Monitoring und Incident-Evidence        |
| `email/EmailProvider`          | lokale redigierte Mailbox plus Resend Contract/Sandbox/Live HTTP-Adapter, Templates, durable Outbox, Receipt-/Bounce-/Suppression-Inbox und Providerbinding           | Resend-Konto, DPA/Region, Absenderdomain/DNS, Secret-Version, Delivery-Monitoring und Pager                        |
| `ai/AiProvider`                | deterministische regelbasierte Textverbesserung; kein Modellaufruf                                                                                                    | Datenschutz-/Human-review-Policy, Timeouts, Limits, Redaction, Monitoring und freigegebener Modellanbieter         |
| `jobroom/JobroomProvider`      | versionierter `OccupationCode`-Fixture-Lookup mit `REQUIRES_REPORTING`, `NOT_REQUIRED` oder `UNKNOWN`; kein arbeit.swiss-Aufruf                                       | offizielle Schnittstelle/Lizenz, Datenversionierung, Auth, Cache/Retry und rechtliche Prüfung; kein Scraping       |
| `storage` Object Store/Scanner | verschlüsselter Filesystem-Sandboxpfad plus S3-Contract/Live Object Store, ClamAV Contract/Live Scanner, Quarantäne, Grants und authority-bound Reads/Privacy Exports | freigegebener Bucket/Region/KMS, ClamAV-TLS, Credentials/Rotation, DPA/Retention/Deletion, Monitoring und Recovery |
| `commute/CommuteProvider`      | deterministische Haversine-Luftlinie aus Seed-Koordinaten; keine Route/Fahrzeit und kein Netzwerk                                                                     | freigegebener Kartenanbieter, Datenminimierung, Quoten, Cache, DPA und klare Distanz-/Fahrzeitsemantik             |

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
- Privacy-Export, Korrektur und Löschung arbeiten auf einem inventarisierten,
  versionierten Vollzugsvertrag mit Verifikation, Legal Hold, Audit und
  autorisiertem Export-Download. Local/CI nutzt verschlüsselte Sandboxbytes;
  S3-Exportcode bleibt bis Provider-, Retention- und Rechtsfreigabe deaktiviert.
- Reine Provider-Mocks führen keine externen HTTP-, TCP- oder TLS-Aufrufe aus.
  Das isolierte `production-contract`-Profil spricht nur seine lokalen
  Resend-/Stripe-/S3-/ClamAV-Stubs an und ist keine Live-Evidence. Die Anwendung
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

1. **Payment nicht aktiviert:** Stripe-Contract/Sandbox/Live-Code ist vorhanden,
   aber es gibt kein freigegebenes Providerkonto, keine reale Kartenbelastung
   und kein Production-Settlement. Signierte Webhooks, durable Inbox,
   Reconciliation, Refund/Dispute und Dunning belegen weder
   Zahlungsbereitschaft noch PSP-/Tax-/Legal-/Finance-Freigabe.
2. **E-Mail nicht aktiviert:** Resend-Adapter, Webhook-Inbox, Bounce/
   Suppression, getrennte Delivery-/Recipient-Hash-Keyrings, bounded
   Unknown-Outcome-Reconciliation und durable Outbox sind vorhanden, laufen
   lokal aber gegen Mock/Contract-Stubs. Der finale exact-candidate-
   Retention-/Failure-Nachweis ist ausstehend. Ohne Domain/DNS, DPA,
   Providerledger, Monitoring und Secrets findet kein echter Versand statt.
3. **Mock AI:** deterministische Regeln statt eines Sprachmodells; Qualität und
   Fairness eines späteren Modells sind nicht vorweggenommen.
4. **Mock Job-Room:** versionierter Fixture-Lookup; kein aktueller
   arbeit.swiss-Call. `UNKNOWN` ist ein absichtlicher, fail-closed Zustand.
5. **Storage/Scanner nicht aktiviert:** Local/CI verarbeitet echte,
   verschlüsselte Sandboxbytes mit Quarantäne/Scan/Grants; S3- und
   ClamAV-Adapter existieren für Contract/Live-Modi. Ein echter Bucket,
   KMS/Region/DPA, Scanner-TLS, Retention und Operations-Evidence fehlen.
6. **Mock Commute:** ungefähre Luftlinie aus Seed-Koordinaten, keine Route oder
   Fahrzeit; bei fehlender Konfiguration kann die Funktion nicht als
   Kartenersatz dienen.
7. **Subscription-Renewal:** keine automatische Verlängerung; nur eine
   explizite Admin-Mock-Aktion.
8. **Worker/Scheduler nicht auf einem Zielsystem aktiviert:** Separate
   App-/Worker-/Scheduler-Prozesse, Lease, Heartbeat, Retry, DLQ/Replay und der
   lokale Production-Contract sind vorhanden. Hosting, Zielsystem-Monitoring,
   Pager/On-call sowie freigegebene SLO/RPO/RTO fehlen weiterhin und blockieren
   unbeaufsichtigten öffentlichen Self-Service.
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
14. **Privacy-Aktivierung:** inventarisierter Export, autorisierter Download,
    Korrektur und Erasure sind technisch implementiert; reale Retention-/Legal-
    Freigabe, Processor-/Zielstorage-Evidence, Nicht-Kontoinhaber-Identität und
    Operations-Abnahme bleiben offen.
15. **Betrieb und Recht:** keine bestätigte Incident-Response, DPA-Landschaft,
    AVG-/Rechts-/Steuerfreigabe oder produktive RPO/RTO-Zusage.
16. **Salary Radar:** der vorhandene Datensatz ist ausdrücklich fiktiv und
    Demo-only. Staging/Production zeigen keine Werte; die Route ist `noindex`
    und fehlt in der Sitemap, bis ein versionierter, fachlich geprüfter
    LIVE-Snapshot mit ehrlichem Berufsgruppen-/Grossregionsmapping vorliegt.

## Provider konfigurieren und freigeben

Ein Providerwechsel beginnt immer am bestehenden Port und in der serverseitigen
Composition Root. Das bloße Befüllen eines Secrets ist absichtlich wirkungslos;
der freigegebene Modus, ein exakter `ProviderActivation`-Eintrag, Health,
Config-/Evidence-Digest, Secret-Version und alle externen Gates müssen
zusammenpassen.

| Integration                        | Bestehender Port/Adapter                                                    | Konfiguration                                                                              | Zusätzlich notwendige Aktivierungsevidence                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Stripe                             | `payments/payment-provider.ts` + `stripe-payment-provider.ts`               | `PAYMENT_PROVIDER_MODE`, Account, API-/Webhook-Secret und Secret-Version                   | WTP, PSP-/Tax-/Legal-/Finance-/Security-Gate, Price-/Accountbinding, Settlement/3DS, Monitoring, Incident und Zielsystemreceipt |
| Resend                             | `email/email-provider.ts` + `resend-email-provider.ts`                      | `EMAIL_PROVIDER_MODE`, getrennte API-/Webhook-Secrets und `RESEND_SECRET_VERSION`/`RESEND_WEBHOOK_SECRET_VERSION`, From-Domain, `NOTIFICATION_DELIVERY_KEYS`, `NOTIFICATION_RECIPIENT_HASH_KEYS` | Anbieter/DPA/Region, Absenderdomain/DNS, Bounce/Suppression, Key-Version-Inventar, Retention/Compaction, Unknown-Outcome-Reconciliation, Delivery-Monitoring, Pager und Zielsystemreceipt |
| OpenAI oder anderer Modellanbieter | `lib/providers/ai/ai-provider.ts`                                           | `OPENAI_API_KEY`                                                                           | freigegebene Modell-/Region-Konfiguration, Redaction, Moderation, Limits, Timeouts, Fallback und Human Review                   |
| S3-kompatibler Speicher + ClamAV   | `storage/s3-document-object-store.ts` + `storage/clamav-malware-scanner.ts` | Storage-/Scanner-Modi, Endpoint, Bucket, Region, KMS/TLS, Credentials und Secret-Versionen | Bucket-/Netzpolicy, DPA, Retention/Deletion, Malware-/Outage-Monitoring, Backup/Restore und Zielsystemreceipt                   |
| Offizielle Job-Room-Integration    | `lib/providers/jobroom/jobroom-provider.ts`                                 | `JOBROOM_API_URL`                                                                          | offizieller Zugang/Auth, Lizenz, Versionierung, Retry/Cache, Monitoring und Audit; niemals Scraping als Ersatz                  |
| Karten-/Commute-Service            | `lib/providers/commute/commute-provider.ts`                                 | `MAPS_API_KEY`                                                                             | Anbieter/Endpoint, Routing-Semantik, Quoten, Cache, Datenschutz und Fallback                                                    |

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

Der strengere Phase-33-Orchestrator führt 38 fest definierte Clean-Clone-
Prüfungen einschließlich Scale-Observation, Provider-/Worker-Verträge, drei
Browser, beide Dockerprofile und Dependency-Security aus:

```text
npm run phase33:audit
npm run phase33:scale
npm run phase33:providers
npm run phase33:e2e
npm run test:phase33
```

`npm run test:phase33` ist erst Evidence, wenn sein JSON-Report Exit `0`, alle
38 Command-IDs genau einmal, alle technischen Gates `PASS`, fehlgeschlagene
Commands und unerklärte Skips `0` sowie denselben unveränderlichen Candidate
wie das technische Manifest ausweist. Nicht strukturiert gemessene Retry-,
Console-, Leak- oder Secret-Metriken werden nicht als erfundene Nullwerte
ausgegeben. Die nachgelagerte Activation-Auswertung bleibt bei fehlender
externer Evidence erwartungsgemäß blockiert.

Der read-only Workflow `.github/workflows/phase33-g4.yml` führt diesen Vertrag
auf Pull Requests und `main` ohne Production-Secrets oder Deploymentwirkung
aus. LC4- und LC5-Manifeste/Verdicts entstehen aus demselben Report und exakt
dem darin gebundenen OCI-Image; Evidence wird erst nach vollständigem
technischem Pass hochgeladen. Ein echter CI-Receipt entsteht erst nach Push.

`npm run phase33:audit` besitzt 16 fail-closed Checks. Dazu gehören die
klassifizierten Route-/Action-/Laufzeitkontroll-Inventare sowie
`MIGRATION_BASELINE_ANCHORED_TO_GIT`: die 67 historischen Migrationen werden
direkt aus Baseline-Commit
`59ed81033d409aac847c55f1da3ecf5370f4f035` rekonstruiert. Das committed
Baseline-JSON wird damit geprüft und nicht als alleinige Wahrheit akzeptiert,
sowie `PHASE_33_CI_G4_WORKFLOW` für den statischen CI-Vertrag.

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
   Bei Supabase/Supavisor ist für eine serverlose Laufzeit der Transaction-
   Pooler vorgesehen; Session-Einstellungen werden dort nicht verlässlich
   beibehalten. `statement_timeout` und
   `idle_in_transaction_session_timeout` müssen deshalb als wirksame Rollen-
   oder Datenbankpolicy auf höchstens fünf Sekunden gesetzt werden. Die App
   prüft beide Werte in `/health/ready`; ein abweichender Wert blockiert den
   Rollout. Migrationen verwenden eine dafür geeignete direkte oder Session-
   Verbindung. Siehe die offiziellen
   [Supabase-Verbindungsmodi](https://supabase.com/docs/guides/database/connecting-to-postgres)
   und [Timeout-Hinweise](https://supabase.com/docs/guides/database/postgres/timeouts).
2. Secrets aus einem Secret Manager injizieren, nicht aus einer committed
   Env-Datei. Production benötigt insbesondere `APP_ENV=production`,
   `NODE_ENV=production`, `DATABASE_URL`, eine HTTPS-`APP_URL`,
   `APP_BUILD_ID`, Session-/Keyring-Secrets,
   `RATE_LIMIT_BACKEND=postgres`, die exakte `TRUSTED_PROXY_HOPS`-Zahl,
   `ENABLE_LOCAL_MOCK_MAILBOX=false` und eine geprüfte
   `ABUSE_REPORT_ADMIN_EMAILS`-Liste. `TEST_DATABASE_URL` bleibt leer.
   Provider-Modi bleiben `disabled`, bis die benötigten Secret-Mounts,
   nicht geheimen Versions-/Configwerte und exakt passende Activation-Ledger-
   Evidence im freigegebenen Zielsystem vorliegen.
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
   `/health/ready` überwachen. `ready` bestätigt neben Schema und Migration
   auch die effektiven serverseitigen Statement-/Idle-Transaction-Timeouts.
7. App, Worker und Scheduler werden als getrennte Prozesse gestartet. Der
   Worker/Outbox-Vertrag verarbeitet aktivierte Handler mit Lease, Heartbeat,
   Idempotenz, Retry/Backoff, Dead-Letter und Replay; der Scheduler stößt die
   erlaubten Maintenance-Schritte an. Vor unbeaufsichtigtem öffentlichem
   Self-Service müssen Zielhost, Handler-/Providerledger, Monitoring,
   Backpressure, Pager/On-call und Restart-/Outage-Drill auf dem deployten
   Artefakt extern belegt werden.
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
- [`codex-plan/33-go-live-readiness-e2e-acceptance.md`](./codex-plan/33-go-live-readiness-e2e-acceptance.md)
  — technischer Phase-33-Closure-/E2E-Vertrag;
- [`codex-plan/phase33-findings-ledger.md`](./codex-plan/phase33-findings-ledger.md)
  — technische Blocker, externe Gates und erlaubte Statusübergänge;
- [`codex-plan/evidence/README.md`](./codex-plan/evidence/README.md) —
  Evidence-Index einschließlich Phase 18;
- [`BUILD_REPORT.md`](./BUILD_REPORT.md) — Zielcommit, tatsächlich ausgeführte
  Gates, E2E-08, bekannte Blocker und ehrlicher Freigabestatus.

Ein Checkbox-Häkchen bedeutet „im Zielcommit implementiert und verifiziert“.
Ein fehlendes Tool, eine unerreichbare Datenbank oder ein nicht gelaufener
Recovery-Drill bleibt `Needs Verification` und blockiert den betreffenden
Release-Gate; ein erfolgreicher Build ersetzt diesen Nachweis nicht.
