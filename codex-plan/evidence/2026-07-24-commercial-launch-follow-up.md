# Evidence — Commercial-, Salary- und AVG-Follow-up

> **STATUS: TECHNISCHE KORREKTUREN ABGESCHLOSSEN; EXTERNE GATES OFFEN.**
> Die gemeldeten Aussagen wurden einzeln gegen Repository, Rechenmodell und
> amtliche Quellen geprüft. Bestätigte Code-/Dokumentationswidersprüche wurden
> im unveränderlichen Commit
> `22ea4516b2481ed6f3dc6537ab9c8a8d1c6aa670` korrigiert. Dieser Record ist
> weder Zahlungsbereitschaftsnachweis noch Finance-, Rechts- oder
> Produktionsfreigabe.

## Identität und Umgebung

- **Datum:** 24. Juli 2026, Europe/Berlin (UTC+02:00)
- **Branch:** `codex/phase-18-release-audit`
- **Geprüfter Code-Commit:** `22ea4516b2481ed6f3dc6537ab9c8a8d1c6aa670`
- **Commit-Identität:** `Giuliano Carosella <carosellagiuliano@gmail.com>`
- **Runtime:** Windows x64; Node `24.18.0`; npm `11.16.0`
- **Container:** Docker `29.5.2`; Compose `5.1.3`
- **PostgreSQL-Testziel:** `postgres:16.13-alpine` mit Digest
  `sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50`
- **Isolierung:** temporärer detached Git-Worktree direkt auf dem Zielcommit;
  keine uncommittete `brand-link.tsx`-Änderung, kein lokales `.claude/` und
  keine Quelländerung im Worktree. Der Worktree wurde nach Exit-0-Verifikation
  kontrolliert entfernt.

## Bewertung der Aussagen

| Aussage | Urteil | Konsequenz |
|---|---|---|
| Mock Payment prüft Zahlungsbereitschaft nicht | **hoch und korrekt** | Admin-Funnel, Metrikvertrag, ADR und Dokumentation nennen nur noch Mock-Bestätigung. Echte Zahlungsbereitschaft bleibt ein vorab definierter Real-Money-KMU-Test. |
| ADR-014 widerspricht der Playground-`CLAUDE.md` | **falsch durch Repo-Verwechslung** | `Portal.git` und das verschachtelte `PortalGERM.git` sind getrennte Repositories. Die neue lokale `CLAUDE.md` grenzt den Scope ab; PortalGERM bleibt gemäss ADR-014/016 Mock-only. |
| CHF 400–600k Burn fehlt | **starke Modelllücke; Betrag plausibel, nicht bewiesen** | Die lineare Sensitivität ergibt rund CHF 387k/423k beziehungsweise CHF 552k–588k bei zusätzlich separat bezahltem CAC. Ein echtes 18-/24-Monatsmodell bleibt offen. |
| Break-even bei 42–90 Kunden | **nicht aus dem Basismodell ableitbar** | Basisrelationen ergeben ungefähr 203 Recurring-only beziehungsweise 153 inklusive proportionalem Einmalumsatz. 42–90 benötigt einen explizit kleineren Kostenblock. |
| Monatsabo erzeugt bei episodischem Hiring Churn | **hohe, noch unbewiesene Hypothese** | Monatsmodell, Hiring-Sprint und Retainer/Credits werden mit echtem Geld verglichen; Pause/Reaktivierung wird nicht als dauerhafter Logo-Churn vermischt. |
| CHF 149 ist gegenüber jobs.ch massiv unterpreist | **Risiko real, Schluss zu stark** | Produkte und Reichweite sind nicht einheitengleich; jobs.ch bietet auch kostenlosen Start und Produkte ab CHF 290. Kein Preis wird ohne bezahlten Angebotsversuch geändert. |
| Talent Radar kam erst in Phase 14 und ist der einzige Moat | **historisch teilweise; „einziger Moat“ unbelegt** | Der vollständige Flow kam in Phase 14, Vorarbeiten ab Phase 02. Radar wird als Wedge gemessen, nicht vorab als Moat behauptet. |
| Kein Background-Worker ist Launch-Blocker | **hoch für unbeaufsichtigten öffentlichen Self-Service; bereits offen** | Worker/Outbox mit Retry, DLQ, Monitoring und Failure-Recovery bleibt hartes Gate. Ein beaufsichtigter Design-Partner-Test ist davon begrifflich getrennt. |
| Salary Radar hat keine reale Datenquelle | **hoch und korrekt** | LIVE/Staging zeigt keine Werte, bleibt `noindex`, fehlt in der Sitemap und wird dort nicht mehr in Homepage, Header, Footer oder Kandidaten-Cockpit beworben. |
| BFS/LSE kann direkt den aktuellen Vertrag ersetzen | **nein** | Grossregion/CH-ISCO, Alter, Monatswert, Quantile und Stichprobennachweis müssen quellengetreu geprüft werden. Keine Alter→Seniorität-, Kanton-, Jahreswert- oder Sample-Erfindung; eine neue Policy-/Schema-/DTO-/UI-Version ist gegatet. |
| Google for Jobs kam erst in Phase 15 | **falsch** | `JobPosting`-JSON-LD entstand in Phase 07; Phase 15 härtete und validierte es. Kein Codefix. |
| AVG fehlt | **kritisches externes Go-live-Gate** | Der konkrete Stellenmarkt-/Radar-/Kontakt-/Reveal-/Entgeltflow benötigt vor realem Betrieb eine flowspezifische behördliche/fachjuristische Beurteilung und gegebenenfalls Bewilligung. |

Die vollständige Rechen- und Gate-Begründung steht in
[`../commercial-go-live-gates.md`](../commercial-go-live-gates.md).

## Verifikation auf dem isolierten Zielcommit

| Gate | Ergebnis |
|---|---|
| `npm ci` | Exit 0; 786 Pakete strikt aus dem Lockfile installiert, Prisma Client erzeugt |
| `npm test` | Exit 0; 246/246 Dateien, 1.974/1.974 Tests |
| `npm run lint` | Exit 0; vollständiger Repository-Lint |
| `NODE_ENV=production npm run build` | Exit 0; Next.js-Production-Build, TypeScript und Seitengenerierung erfolgreich |
| `npm run test:integration -- --run tests/integration/analytics/admin-funnels-postgres.test.ts` | Exit 0; 1/1 Datei, 5/5 PostgreSQL-Tests |
| `npm run plan:audit` | Exit 0; 18 Phasen, 1.087 Items und 278 lokale Links |
| `npm run route:audit` | Exit 0; 100 Seiten, 7 Handler und Rollenlayouts bestätigt |
| `npm run security:release-scan` | Exit 0; 1.120 getrackte Dateien, kein privater Schlüssel, Provider-Token, Backup-Artefakt oder exaktes konfiguriertes Secret |
| `git status --short` / `git diff --check` / `git rev-parse HEAD` | Exit 0; sauberer Worktree, keine Whitespacefehler, exakt der dokumentierte Zielcommit |

Ein erster isolierter Buildversuch erbte versehentlich
`NODE_ENV=development` aus der lokalen Konfiguration. Next.js warnte vor dem
nicht standardkonformen Buildmodus und der Versuch endete beim Prerendern mit
Exit 1. Er zählt ausdrücklich **nicht** als Gate. Der anschliessende, identische
Build mit erzwungenem `NODE_ENV=production` bestand vollständig.

Die servergerenderten LIVE-/Demo-Zustände wurden automatisiert in den
öffentlichen Page-, Shell-, Homepage- und Sitemap-Tests geprüft. Eine
zusätzliche manuelle LIVE-Browserprüfung wurde nicht behauptet und ist für
diesen Follow-up-Record kein Phasen-Checkbox-Nachweis.

## Geprüfte externe Primärquellen

- [SECO — Private Arbeitsvermittlung und Personalverleih](https://www.seco.admin.ch/de/private-arbeitsvermittlung-und-personalverleih)
- [AVG](https://www.fedlex.admin.ch/eli/cc/1991/392_392_392/de),
  [AVV](https://www.fedlex.admin.ch/eli/cc/1991/408_408_408/de) und
  [GebV-AVG](https://www.fedlex.admin.ch/eli/cc/1991/425_425_425/de)
- [BFS/LSE PxWeb-API](https://www.pxweb.bfs.admin.ch/api/v1/de/px-x-0304010000_205/px-x-0304010000_205.px)
- [jobs.ch für Arbeitgeber](https://b2b.jobs.ch/de-arbeitgeber-stelle-job-inserieren)

Die Quellen stützen Risikoklassifizierung und offene Fachgates. Sie ersetzen
keine schriftliche Einzelfallbeurteilung.

## Bewusste Grenzen und offene Risiken

- Kein echter Geldfluss, kein Stripe-LIVE-/Testmode und kein
  Zahlungsbereitschaftsnachweis wurden erzeugt.
- AVG/AVV-, Steuer-, Vertrags-, Datenschutz- und Bewilligungsfragen bleiben
  extern offen.
- Cashflow/Runway, Packaging-Experiment, fachlich freigegebener
  LIVE-Lohndatensatz und autonomer Worker bleiben offene Owner-Gates.
- `npm ci` meldete drei moderate Dependency-Hinweise. Sie wurden in diesem
  fachlich begrenzten Follow-up weder automatisch noch mit Breaking Updates
  verändert und bleiben ein separater Dependency-Auditpunkt.
- Der versiegelte Phase-18-Buildreport bleibt auf seinem damaligen Codecommit;
  dieser Record dokumentiert ausschliesslich den späteren Follow-up-Commit.
