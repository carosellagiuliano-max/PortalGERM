# SwissTalentHub / PortalGERM

**Phasen 01 bis 16 sind implementiert und verifiziert; als nächster Schritt folgt Phase 17.** Auf der reproduzierbaren Next.js-/TypeScript-Foundation und dem Prisma/PostgreSQL-Domänenvertrag stehen inzwischen Core-Policies, netzwerkfreie lokale Provider-Mocks mit persistierten Logs/Effekten, ein deterministischer Demo-Datensatz, End-to-End-Authentifizierung und rollen-/mandantenbasierte Autorisierung.

Der aktuelle Produktumfang umfasst öffentliche Job- und Firmen-Discovery, eine datenbankgerankte Keyset-Suche, stabile SEO-/Canonical-/Sitemap-Verträge, Jobdetails und sichere Save-/Apply-Intents, Pricing sowie persistierte Arbeitgeber-Leads. Kandidaten erhalten SwissJobPass, Saved Jobs, Bewerbungen, Jobabos, Nachrichten und Privacy-/Talent-Radar-Basics. Arbeitgeber und Recruiter erhalten Firmenprofil und Verifizierungsanträge, Team/Einladungen/Zuweisungen, Jobliste und 5-Schritt-Wizard, Bewerberpipeline sowie ehrliche Analytics- und Radar-Locked-States. Arbeitgeber-Owner können ausserdem Billingprofile, Abonnemente, Credits, Kontingente, Rechnungen und den vollständig lokalen Mock-Checkout verwalten. Plattformadmins betreiben Job-/Company-/User-Moderation, Reports, lizenzierte Imports, Support, Content, Taxonomie, Leads, Billing/Katalog sowie evidenzbasierte Operations- und Finanzansichten. Phase 16 schliesst den kontrollierten MVP mit per-request CSP-Nonces, CSRF-/IDOR-/Cache-Härtung, strukturiertem redigiertem Logging, Health-/Readiness-Routen, vollständiger Audit-Evidenz und Abuse-Workflows ab.

Job-Boosts besitzen einen vollständigen, zeitgebundenen Lebenszyklus mit Plan-/Admin-Credit oder lokalem Mock-Checkout, Arbeitgeber-/Admin-Kündigung, öffentlicher Kennzeichnung und begrenzter Sponsored-Zone. **Boosts beeinflussen die Sichtbarkeit, niemals den Fair-Job-Score.** Talent Radar bietet berechtigten, verifizierten Firmen eine kohortengeschützte anonyme Suche, atomar finanzierte Kontaktanfragen und ausschliesslich kandidatengesteuerte, feldgenaue Reveal-Snapshots; Kandidat:innen und Admins erhalten die dazugehörigen Contact-, Consent-, Abuse- und Privacy-Case-Workflows. Der Zahlungsfluss bleibt ausdrücklich ein lokaler Mock: Es gibt weder Stripe noch echte Payment-Webhooks oder einen autonomen Renewal-Worker. Export und Löschung bleiben dokumentierte P0-Mock-Verfahren ohne automatische Dateiübermittlung oder Datenlöschung. Alle Provider bleiben lokale Mocks; echte Provider, Produktionsbetrieb und eine abschliessende Produktions-/DSG-Freigabe sind nicht behauptet.

## Verbindliche Runtime

- Node.js **24.18.0**
- npm **11.16.0**
- PostgreSQL **16**

Die Node-Version ist in `.node-version` und `.nvmrc`, die npm-Version in `package.json#packageManager` und den Engines gepinnt. `engine-strict=true` verhindert Installationen mit einer abweichenden Runtime.

Prüfen:

```powershell
node --version
npm --version
```

Erwartet werden `v24.18.0` und `11.16.0`.

## Voraussetzungen

- Git und eine PowerShell- oder vergleichbare Shell
- Node.js/npm in den oben genannten exakten Versionen
- Docker Desktop beziehungsweise Docker Engine mit Compose für die lokale PostgreSQL-Instanz
- freie lokale Ports `3000`, `5434` und bei Integrationstests `5435`

## Lokales Setup

```powershell
npm ci
npm run env:init
npm run env:validate
docker compose up -d postgres
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:migrate:status
npm run db:seed
npm run db:smoke
npm run dev
```

Danach ist die lokale Anwendung unter [http://127.0.0.1:3000](http://127.0.0.1:3000) erreichbar.

Der lokale Demo-Seed stellt unter anderem folgende bereits dokumentierte Konten bereit (Passwort jeweils `Demo12345!`):

- `candidate@demo.ch` — Candidate-Portal
- `employer@demo.ch` — Arbeitgeber-Portal, Owner einer Pro-Demofirma
- `recruiter@demo.ch` — Recruiter mit mandanten- und jobgebundenen Zuweisungen
- `admin@demo.ch` — Adminportal für Operations, Moderation, Import, Support, Content, Leads sowie Phase-12-Billing und -Katalog

`npm ci` verwendet ausschliesslich das committed Lockfile. `package.json#allowScripts` dokumentiert zusätzlich die versionsgenaue Soll-Allowlist geprüfter Dependency-Install-Scripts; das gepinnte npm 11.16 meldet die streng erzwingende Projektoption `strict-allow-scripts` jedoch noch als unbekannt. Diese Erzwingung wird deshalb ehrlich als Runtime-Upgrade-Punkt geführt und nicht als bereits wirksam behauptet. `npm run env:init` erzeugt einmalig eine ignorierte `.env.local` mit lokal gültigen, voneinander verschiedenen Zufallsschlüsseln. Der Befehl überschreibt keine vorhandene Datei, läuft nur lokal, übernimmt keine URL aus dem Shell-Environment und setzt auf unterstützenden Dateisystemen Modus `0600`. `.env.example` ist absichtlich nicht direkt lauffähig und enthält nur erkennbare Platzhalter.

## Umgebungsvariablen

`npm run env:validate` prüft unter anderem:

- ein explizites `APP_ENV`; Prozesskonfiguration und lokale Env-Dateien werden nie still gemischt;
- PostgreSQL-URLs und absolute `APP_URL`;
- einen 32-Byte-Base64-`SESSION_SECRET`;
- getrennte, versionierte 32-Byte-Keyrings für Audit-IP-HMAC, Radar-Lookup, Radar-Verschlüsselung, Reveal-Bestätigung und PII-Reveal;
- keine wiederverwendeten Schlüssel;
- `RATE_LIMIT_BACKEND=postgres` und deaktivierte lokale Mock-Mailbox in Staging/Production;
- einen credential-, query- und fragmentfreien `APP_URL`-Origin;
- leere, noch nicht freigegebene Real-Provider-Variablen;
- falls gesetzt, einen absoluten `BACKUP_AGE_IDENTITY_FILE`-Pfad ausserhalb des Repositories.

Fehler nennen nur Variablenname und Regel, niemals den Secret-Wert. `.env.local`, `.env` und andere lokale Env-Dateien dürfen nicht committed oder in Logs ausgegeben werden. Ops-Backup-Werte bleiben leer, bis der separate Betriebsprozess freigegeben ist; private Age-Identitäten gehören nie ins Repository.

## PostgreSQL und Compose

| Dienst | Zweck | Host-Port | Persistenz |
|---|---|---:|---|
| `postgres` | lokale Entwicklung | `127.0.0.1:5434` | Named Volume `swisstalenthub-postgres` |
| `postgres-test` | isolierte Integrationstests | `127.0.0.1:5435` | flüchtiges `tmpfs` |

Entwicklungsdatenbank starten:

```powershell
docker compose up -d postgres
```

Zusätzliche Testdatenbank starten:

```powershell
docker compose --profile test up -d postgres-test
```

Beide Dienste und die Linux-CI verwenden PostgreSQL `16.13-alpine` mit festem
Image-Digest. `DATABASE_URL` und `TEST_DATABASE_URL` sind getrennt. CI verwendet
ausschliesslich eine kurzlebige Service-Datenbank; keine CI-Aktion kennt oder
akzeptiert eine Production-URL.

## Prisma, Migration, Seed und DB-Smoke

```powershell
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:migrate:status
npm run db:seed
npm run db:smoke
```

- `db:generate` erzeugt den ignorierten Prisma Client neu.
- `db:validate` prüft Schema und Konfiguration ohne Datenbankmutation.
- `db:migrate` verwendet `prisma migrate deploy` gegen die explizite `DATABASE_URL`.
- `db:migrate:status` bestätigt, dass alle committed Migrationen angewandt sind.
- Die **42 committed Migrationen** reichen von der leeren Baseline über den Domänenvertrag und die Phase-14-Radar-/Privacy-Verträge bis zu den Phase-15-Cluster-Gates sowie dem Phase-16-Company-Media-Manifest und der Audit-IP-Retention. Zusätzlich zu Prisma-SQL enthalten sie benannte Checks, Composite-FKs, Partial-/Exclusion-Indizes sowie Lifecycle-, Append-only- und Concurrency-Trigger.
- `db:seed` erzeugt beziehungsweise verifiziert den deterministischen, wiederholbaren Demo-Vertrag `phase-14-demo-v13` mit Katalogen und Preisversionen, Demo-Identitäten, Firmen, Jobs, Bewerbungen, Candidate-/Employer-Workflows, Billingprofilen, Abonnementperioden, Credits, Orders, Rechnungen und Boost-Belegen. Phase 14 ergänzt zwei anonymisierte 10er-Radar-Sessions, firmenspezifische Opaque-Mappings, 0/1-Credit-Kontraste, alle Contact-Zustände, aktive/widerrufene Reveal-Belege, Privacy-Cases, seltene Kohorten und PII-Canaries. Hinzu kommen eine klar begrenzte lokale Importquelle und ein nicht aktivierbares DEMO-Cluster-Assessment. Staging und Production sind fail-closed gesperrt; es gibt keinen Production-Seed.
- Phase-16-Angriffspayloads, Tenant-A/B-IDOR-Fälle, Secret-Canaries und Rate-Grenzfälle leben ausschliesslich in isolierten Test-Fixtures; der öffentliche Demo-Seed enthält keine absichtlich schädlichen Inhalte.
- `npm run seed:verify` prüft den vollständigen Seed-Vertrag und liefert einen stabilen Manifest-Hash.
- `db:smoke` führt einen read-only Datenbank-Smoke aus; bei `APP_ENV=ci` verwendet er `TEST_DATABASE_URL`.

Die interaktiven Befehle `npm run db:migrate:dev` und `npm run db:studio` besitzen zusätzlich einen Fail-closed-Guard: Sie akzeptieren nur `APP_ENV=local`, einen Loopback-Host und keine production-/staging-bezeichnete Datenbank. `db:migrate` bleibt der nicht-interaktive Deploy-Pfad für eine ausdrücklich vollständig konfigurierte Zielumgebung.

Der Demo-Seed ist ausschliesslich für lokale Entwicklung, CI und explizit freigegebene Preview-Umgebungen gedacht. Es gibt keinen automatischen Reset. Die Gruppierung der Modelle und der Umgang mit dem strengeren SQL-Vertrag sind in [`prisma/README.md`](./prisma/README.md) dokumentiert.

## Qualitätsbefehle

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run test:e2e:hsts
npm run seed:verify
```

`test:integration` und `test:e2e` verlangen `APP_ENV=local|ci` sowie eine
eindeutig test-bezeichnete, von `DATABASE_URL` getrennte `TEST_DATABASE_URL`.
`test:e2e` startet nach einem erfolgreichen Build selbst einen Production-Server
auf einem freien Loopback-Port, prüft Inhalt, Health/404, Security-, Correlation-
und No-store-Header sowie eine Secret-Canary und beendet den Prozess wieder.
`test:e2e:hsts` erzeugt zusätzlich in einer isolierten Testdatenbank einen
production-like Build mit `APP_ENV=production`, `TRUSTED_PROXY_HOPS=1`,
HTTPS-`APP_URL` und sicherer Testkonfiguration. Danach startet es genau dieses
Artefakt per `next start` und verlangt auf `/health/live` exakt
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
Der lokale Request bleibt absichtlich HTTP und beweist daher ausschliesslich die
Header-Emission, nicht die TLS- oder Browserwirkung von HSTS.
`typecheck` erzeugt davor mit `next typegen` die von Next verwaltete und bewusst
ignorierte `next-env.d.ts`; dadurch hinterlassen `dev` und `build` keinen
versionsabhängigen Diff im Repository.

Zusätzliche Konfigurationschecks:

```powershell
npm run env:validate
npm run db:generate
npm run db:validate
docker compose config --quiet
```

Die Linux-CI führt Clean Install, Env-Validierung, Prisma Generate/Validate, Lint, Typecheck, Unit-Tests, alle committed Migrationen samt Statusprüfung, Demo-Seed, DB-Smoke, PostgreSQL-Integrationstests, Production Build und einen HTTP-Smoke aus. Ein separater `windows-latest`-Job wiederholt ohne Docker mindestens Install, Env-, Prisma-, Lint-, Typecheck-, Unit- und Build-Prüfung und belegt damit die npm-cmd-Portabilität.

## Health-Routen

- `GET /health/live` liefert `200 {"status":"ok","buildId":"…"}`, prüft nur die Prozess-Liveness und ist `no-store`. Deployments setzen dafür einen nicht sensitiven, commit-eindeutigen `APP_BUILD_ID`; lokal gilt der explizite Fallback `local-development`.
- `GET /health/ready` führt einen auf drei Sekunden begrenzten PostgreSQL-, Schema- und Migrationscheck aus. Die zuletzt erforderliche Migration muss erfolgreich abgeschlossen sein; Pool-Verbindungs- und Query-Timeouts verhindern unbegrenztes Warten. Bei Bereitschaft liefert die Route `200 {"status":"ready"}`, sonst `503 {"status":"unavailable","correlationId":"…"}`. Sie gibt weder URL noch Credentials oder Tabelleninhalte aus und ist ebenfalls `no-store`.

Health-Routen sind Betriebschecks, keine Produktfeatures und keine Autorisierungsgrenze.
Der freigegebene Mock-MVP besitzt neben PostgreSQL keine erforderliche externe
Readiness-Abhängigkeit; Mail, Storage und Payment sind lokale persistente Mocks.

## Security-Maintenance und manueller IDOR-Test

Die idempotente Wartung

```powershell
npm run security:maintenance
```

entfernt nach exakt 30 Tagen nur die versionierten HMAC-IP-Felder aus bestehenden
Audit-Zeilen; die Audit-Ereignisse selbst bleiben erhalten. Der Befehl protokolliert
nur die Anzahl bearbeiteter Zeilen. Ein produktiver Scheduler ist
Deployment-Verantwortung und muss diesen Befehl mindestens täglich seriell ausführen.

Für den manuellen Phase-16-IDOR-Nachweis werden zwei voneinander unabhängige
Demo-Konten und die Browser-Netzwerkanalyse verwendet. IDs dürfen nur zwischen
den beiden eigenen Test-Tenants ausgetauscht werden; nie fremde reale Daten nutzen.

| Versuch | Manipulation im zweiten Konto | Erwartung |
|---|---|---|
| Arbeitgeber/Job | Job-ID eines anderen Unternehmens in `/employer/jobs/[id]` lesen und mutieren | identische sichere 404 wie bei einer zufälligen UUID; keine Jobdetails |
| Kandidat/Bewerbung | fremde Application-ID in `/candidate/applications/[id]` und zugehörigen Aktionen einsetzen | identische sichere 404/Fehlerantwort; keine Statusänderung |
| Nachrichten | fremde Thread-ID in `/candidate/messages/[threadId]` einsetzen | identische sichere 404; weder Teilnehmer noch Nachrichten sichtbar |
| Billing | Invoice-/Order-ID des anderen Unternehmens öffnen | identische sichere 404; keine Beträge, Adressen oder Belege |
| Talent Radar | Opaque Candidate-ID oder Request-ID aus der anderen Firma wiederverwenden | generisches „nicht gefunden“; keine Identitätsauflösung und kein Credit-Verbrauch |
| Admin/Support | als Nicht-Admin `/admin` sowie fremde Support-/Mock-Checkout-ID aufrufen | echtes HTTP 403 am Rollenrand beziehungsweise generische 404 am Objekt; `private, no-store` und `noindex` |

Bei jedem Versuch wird zusätzlich geprüft, dass eine zufällige, nicht vorhandene
UUID dieselbe objektbezogene Antwort liefert und dass Response, Logs und Audit keine
fremden Identifikatoren enthalten.

## Sicherheits- und Scope-Hinweise

- Keine echten Secrets, Provider-Keys, persönlichen Daten oder Produktionsdaten in Repository, Fixtures oder CI.
- Keine automatische oder unbeabsichtigte Verbindung zu einer unbekannten oder Production-Datenbank; Tests verwenden immer die isolierte Testdatenbank. Der Deploy-Migrationspfad benötigt eine ausdrücklich konfigurierte Zielumgebung.
- Keine Real-Provider werden durch Env-Keys automatisch aktiviert; deren Variablen müssen leer bleiben. Mail, AI, Payment, Storage, Jobroom und weitere Integrationen bleiben kontrollierte lokale Mocks.
- Der Logger redigiert sensitive Werte; Stacktraces und Konfiguration gehören nicht in Nutzerantworten.
- Rate-limitierte Route Handler antworten mit HTTP `429` und `Retry-After`. Next Server Actions liefern stattdessen einen typisierten `RATE_LIMITED`-Domänenwert mit Status `429`, freundlicher deutscher Meldung und `RATE_LIMITED`-Audit; Server Actions setzen keinen eigenen Transportstatus.
- Eine per Request erzeugte Nonce schützt Next-Hydration, `next-themes` und geprüftes JSON-LD unter einer strikten CSP ohne `script-src 'unsafe-inline'`. Persönliche Bereiche und personalisierte Jobdetails sind `private, no-store`; `noindex` bleibt davon getrennt.
- HSTS wird nur mit `APP_ENV=production` gesendet. Seine Schutzwirkung setzt voraus, dass der produktive Ingress HTTPS korrekt terminiert und den Header unverändert ausliefert; lokales HTTP kann nur das Vorhandensein, nicht die Browserwirkung prüfen. Der äusserste Ingress muss eingehende, clientseitig gesetzte `X-Forwarded-For`-Werte verwerfen und den Header selbst neu setzen; `TRUSTED_PROXY_HOPS` muss exakt dieser kontrollierten Topologie entsprechen.
- Firmenmedien stammen im Mock-MVP ausschliesslich aus dem versionierten, selbst gehosteten Manifest unter `/assets/company-media/`. Arbeitgeber-URLs, Remote-Fetches und hochgeladene Dateibytes sind dafür nicht freigeschaltet.
- Security-Header, Auth, Rate-Limits und rollen-/ressourcenbasierte Autorisierung sind implementiert und regressionsgetestet.
- Der belegte Phase-16-MVP-Stand ist weder produktionsbereit noch eine vollständige rechtliche, steuerliche oder DSG-Konformitätszusage. Kohorten-, Retention-, Privacy- und Recontact-Werte benötigen vor Produktion eine fachliche/rechtliche Freigabe. Mock Payment ersetzt insbesondere keine Stripe-/Webhook-Integration, und Renewal wird nicht von einem echten autonomen Worker ausgeführt.

## Plan und Evidence

1. [`AGENTS.md`](./AGENTS.md) — Implementierungs- und Evidence-Regeln.
2. [`codex-plan/00-PLAN.md`](./codex-plan/00-PLAN.md) — Masterplan und Status.
3. [`codex-plan/01-setup-foundation.md`](./codex-plan/01-setup-foundation.md) bis [`codex-plan/16-security-hardening.md`](./codex-plan/16-security-hardening.md) — verbindliche Verträge der implementierten Phasen 01–16.
4. [`codex-plan/17-testing.md`](./codex-plan/17-testing.md) — nächster Implementierungsschritt.
5. [`codex-plan/decisions.md`](./codex-plan/decisions.md) — Architekturentscheidungen.
6. [`codex-plan/requirements-matrix.md`](./codex-plan/requirements-matrix.md) — Traceability.
7. [`codex-plan/implementation-plan.md`](./codex-plan/implementation-plan.md) — Ausführungsschritte 01–18.
8. [`codex-plan/evidence/README.md`](./codex-plan/evidence/README.md) — Evidence-Index der abgeschlossenen Phasen.
9. [`codex-plan/evidence/2026-07-19-phase-01.md`](./codex-plan/evidence/2026-07-19-phase-01.md) bis [`codex-plan/evidence/2026-07-23-phase-16.md`](./codex-plan/evidence/2026-07-23-phase-16.md) — reproduzierbare Abnahmenachweise für Phasen 01–16.

Ein Checkbox-Häkchen bedeutet „im Zielrepository implementiert und verifiziert“. Evidence nennt mindestens Datum, Zielcommit, Umgebung, OS, Node/npm-Version, Befehl beziehungsweise manuellen Check, Exit-Code/Ergebnis und bekannte Limitation. Zuerst wird die Detailphase aktualisiert, danach gegebenenfalls der Masterplan.
