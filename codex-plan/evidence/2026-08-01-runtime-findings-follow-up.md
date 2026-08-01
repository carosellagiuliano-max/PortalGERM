# Runtime-Befundprüfung — Follow-up vom 1. August 2026

## Prüfidentität

| Feld | Wert |
|---|---|
| Datum / Zeitzone | 2026-08-01, Europe/Berlin (UTC+02:00) |
| Scope | Unabhängige Prüfung der nach Phase 32 gemeldeten Runtime-, Nutzerweg-, Security-, Betriebs- und Skalierungsbefunde |
| Branch | `main` |
| Geprüfter Code-Commit | `6934f3fd3872e49825034213771aacf5516191b2` |
| Ausgangs-Commit nach Pull | `0d078dc53b3b078fe977098bf54686f26e507ea3` |
| Betriebssystem | Microsoft Windows NT 10.0.26200.0 |
| Node / npm | Node v24.18.0 / npm 11.16.0 |
| Docker / Compose | Docker 29.5.2 / Compose v5.1.3 |
| PostgreSQL-Testimage | `postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50` |

Der angehängte Fremdbefund war nur Prüfinput und nicht selbst Evidence. Jede
Aussage wurde gegen den aktuellen Code, `AGENTS.md`, die Detailpläne, ADRs und
die vorhandenen Evidence-Records eingeordnet. Historische Phase-01–18-Evidence
wurde nicht verändert.

## Bestätigte und geschlossene Codebefunde

| Befund | Bewertung und Korrektur |
|---|---|
| Prefetch umgeht Proxy-Headerbereinigung | Bestätigt. Prefetch-Anfragen durchlaufen nun ebenfalls den Proxy; interne Pfad-/IP-/CSP-Header werden überschrieben. |
| `TRUSTED_PROXY_HOPS=0` in Preview erzeugt einen globalen Ersatz-IP-Bucket | Bestätigt. Preview verlangt nun wie Staging/Production explizit 1–8 Hops und scheitert bei fehlender Topologie geschlossen. Für direkten Vercel-Ingress ist Hop 1 dokumentiert. |
| Öffentliche Registrierung akzeptiert unveröffentlichte AGB/Privacy | Bestätigt. Preview/Staging/Production registrieren erst, wenn beide exakten, aktuellen de-CH-Publikationen freigegeben sind. Die Consent-Evidence bindet deren IDs, Hashes und Versionen. Local/CI bleibt ausdrücklich synthetisch. |
| Passwort-Reset und Team-Einladung melden nicht belegte Zustellung | Bestätigt. Rückmeldungen unterscheiden jetzt externe Queue, lokale Test-Mailbox, pausierte Queue und fehlenden Versand. Queue-Aufnahme wird nicht als Providerübergabe oder Zustellung bezeichnet. |
| Inserate-Assistent verliert Eingaben bei Navigation | Bestätigt. Geänderte Formulare warnen bei interner Navigation und `beforeunload`; erfolgreiche Speicherung oder bewusstes Verwerfen räumt den Guard auf. |
| Motivationsschreiben verschwindet nach abgelehntem Submit | Bestätigt. Der Server gibt den begrenzten Text und einen neuen Idempotency-Key zurück; das Formular stellt ihn wieder her. |
| Passwort-only-Adminzugriff bleibt in öffentlicher Umgebung möglich, solange MFA default-off ist | Bestätigt. Preview/Staging/Production sperren nun den gesamten Adminbereich bei `ADMIN_MFA_REQUIRED=false`; nach Aktivierung übernimmt der vorhandene AAL2-/Enrollment-Guard. Local/CI behält den isolierten Testvertrag. |
| Startseite erzeugt unnötig hohen gleichzeitigen DB-Fan-out | Bestätigt. Katalog/Aktivierungsstatus und Inhaltsabfragen laufen in zwei begrenzten Wellen; ohne indexierbaren Cluster entfällt der teure Cluster-Scan vollständig. |
| Supavisor-Transaction-Pooling kann Session-Timeouts verwerfen | Bestätigtes Betriebsrisiko. `/health/ready` prüft nun die effektiven PostgreSQL-Werte für `statement_timeout` und `idle_in_transaction_session_timeout` auf 1–5.000 ms. Rollen-/Datenbankpolicy und Monitoring bleiben Deployment-Aufgaben. |
| Request-Logging erklärt Fehler gar nicht | Teilweise bestätigt. Rohmeldung, Stack und Cause bleiben absichtlich geheim; der zentrale Sanitizer erhält jetzt das Error-Objekt und protokolliert sicher die Fehlerklasse. Externes Error-Tracking/Paging bleibt offen. |
| Phase-31-Gates seien vollständig runtimeverdrahtet | Dokumentationsabweichung bestätigt. Der Plan nennt nun ehrlich: Negativpfad grün, positive Production-/Salary-Cutoverpfade noch nicht an ein freigegebenes Release-Read-Model angeschlossen. |

## Nicht bestätigte oder bewusst fail-closed gehaltene Aussagen

| Aussage | Tatsächlicher Vertrag |
|---|---|
| „Der Worker existiert als Prozess überhaupt nicht.“ | Falsch. `scripts/phase23-worker.ts` und `npm run worker:start` existieren. Richtig ist: Es gibt noch keinen freigegebenen, überwachten Zielhost, und Vercel allein hostet keinen dauerhaften Worker. |
| „Datenschutzanfragen werden nie bearbeitet.“ | Zu absolut. Manuelle Admin-Triage und Abschlussaktionen existieren; autonome Ausführung braucht den noch nicht deployten Worker und benannte Owner. Öffentlicher unbeaufsichtigter Self-Service bleibt deshalb nicht freigegeben. |
| „Arbeitgeber erhalten bei Bewerbungen keine Benachrichtigung.“ | Falsch. Der Bewerbungspfad schreibt eine persistente `APPLICATION_SUBMITTED`-In-App-Notification für die berechtigten Firmenempfänger. Eine echte E-Mail-Zustellung ist bewusst nicht behauptet. |
| „CV-Upload ist strukturell unmöglich und scheitert erst am Ende.“ | Falsch für den implementierten Local-/CI-Vertrag. Vault, Upload-Intent, Scanstatus und Vorprüfung existieren; ausserhalb davon bleibt der Providerpfad absichtlich geschlossen, bis Storage/Scanner freigegeben sind. |
| „Nichts läuft ab.“ | Falsch. Read-Model-Freshness und Worker-Handler existieren. Richtig ist: Ohne deployten Worker werden materialisierte Übergänge nicht autonom ausgeführt; das ist ein offenes Betriebs-Gate. |
| „Job-Alerts tun heimlich nichts.“ | Die lokale UI kennzeichnet den Pfad ausdrücklich als Mock. Reale Alerts bleiben bis Worker-/Provideraktivierung gesperrt; die Mock-Kennzeichnung darf nicht in eine falsche Live-Behauptung umgeschrieben werden. |
| „E-Mail-Adresse lässt sich nicht ändern.“ | Veraltet. Phase 20 implementiert den verifizierten Wechsel; Aktivierung bleibt provider- und gategebunden. |
| „Preview-Behandlung fehlt generell bei Verification, Vault und Worker.“ | Die Verweigerung ist überwiegend bewusst: diese Providerverträge sind nur für isoliertes Local/CI freigegeben. Ein stiller Preview-Fallback wäre unsicherer als der aktuelle Fail-closed-Zustand. |
| „Zwei Ranking-Implementierungen sind ein versehentlicher Fehler.“ | Falsch. ADR-003 verlangt den strikten SQL-/JS-Paritätswächter. Eine Abweichung blockiert absichtlich die Ausgabe; sie darf nicht durch Entfernen eines Evaluators kaschiert werden. |
| „ADR-014 und eine neuere Regel widersprechen sich bindend.“ | Falsch. ADR-031 ersetzt ADR-014 für die spätere, weiterhin gategebundene Providerentscheidung. |
| „Admin-MFA ist nicht implementiert.“ | Falsch. WebAuthn/AAL2, Enrollment, Recovery und Step-up existieren. Offen sind reale RP-ID/HTTPS-, Recovery-Owner-, Pager- und Drill-Evidence; bis dahin ist der öffentliche Adminbereich nun vollständig zu. |
| „Antwortmetriken werden öffentlich als reale Werte behauptet.“ | Zu absolut. Seed/Test kann Werte schreiben; bei unzureichender Live-Stichprobe fällt die Projektion auf unbekannt/null zurück. Ein echter updater bleibt trotzdem vor einer belastbaren Kennzahl nötig. |
| „Kommerzielle Gates schalten aktuell heimlich echte Angebote frei.“ | Falsch. Die Runtime zeigt fest verdrahtete Research-/Noindex-Zustände und die kommerziellen Env-Flags sind ausserhalb Local/CI verboten. Der fehlende positive Runtime-Cutover ist nun im Plan ausdrücklich offen. |

## Bewusst offene Risiken und externe Gates

- Migrationen bleiben zu Recht ein eigener Release-Schritt und dürfen nicht im
  Next.js-Build oder Request-Pfad laufen. Ein echter Staging-/Production-
  Release-Controller sowie ein externer `/health/ready`-Monitor fehlen.
- Es fehlen weiterhin ein produktiver E-Mail-/Storage-/Scannervertrag, ein
  dauerhaft gehosteter Worker, Error-Tracking, Pager, SLO-Owner und
  Restore-/Incident-Evidence im Zielsystem.
- Reale AGB, Datenschutz, Impressum, DPA/Processor-Liste, Steuer-/Finance-
  Freigaben und die AVG/SECO-Einordnung müssen durch benannte Fachpersonen
  veröffentlicht beziehungsweise entschieden werden. Der Code kann diese
  Freigaben nicht ersetzen.
- Die exakte Clusterzählung scannt bei aktivierten Clustern weiterhin in
  500er-Batches und wendet die kanonische Eligibility-/Moderationslogik an.
  Eine semantisch gleichwertige Aggregation ist ein offenes Phase-30-
  Skalierungsthema; sie wurde nicht durch eine unbewiesene SQL-Abkürzung
  ersetzt.
- Die Stichwortsuche verwendet weiterhin nicht-indexierbare Teilstringsuche.
  Ein de-CH-Fachreview, FTS-/Rankingmigration und ein echter 50k-Lastnachweis
  bleiben offen.
- Positive Phase-31-Production-/Salary-Angebotspfade, reale Response-Metriken,
  WTP, Capacity und Delivery-Evidence fehlen weiterhin. Kein Go-live- oder
  Umsatzclaim wird durch diesen Follow-up erteilt.

## Ausgeführte Verifikation

| Befehl | Arbeitsverzeichnis | Exit | Ergebnis / Beobachtung |
|---|---|---:|---|
| `git pull --ff-only origin main` | Repository-Root | 0 | Bereits aktuell; `main` und `origin/main` waren auf `0d078dc53b3b078fe977098bf54686f26e507ea3`. |
| `npx vitest run` mit 12 geänderten Unit-/UI-Dateien | Repository-Root | 0 | 12 Dateien, 115 Tests bestanden. |
| `npm run typecheck` | Repository-Root | 0 | Next-Routentypen und `tsc --noEmit` bestanden. |
| `npm run lint` | Repository-Root | 0 | ESLint vollständig bestanden. |
| `npm run build` | Repository-Root | 0 | Prisma Generate und Next.js-Production-Build bestanden; 149 App-Routen gebaut. |
| erster `npm test` | Repository-Root | 1 | 313 Dateien/2.406 Tests bestanden; fünf Tests in `employer-claim-page.test.tsx` deckten die neue Env-Abhängigkeit im isolierten Test nicht ab. Kein Produktcodefehler wurde verschwiegen. |
| `npx vitest run tests/unit/ui/employer-claim-page.test.tsx --reporter=verbose` | Repository-Root | 0 | Nach explizitem Mock des unabhängigen Legal-Gates alle fünf Seitentests bestanden. |
| zweiter `npm test` | Repository-Root | 0 | 314 Dateien und 2.411 Tests vollständig bestanden. |
| `npx vitest run --config vitest.integration.config.ts tests/integration/database-health.test.ts tests/integration/legal/legal-publication-postgres.test.ts --reporter=verbose` | Repository-Root | 0 | Zwei Dateien, drei reale PostgreSQL-Tests bestanden: Readiness/Timeoutvertrag und Legal-Publikation→Registrierung. |
| `git diff --check` | Repository-Root | 0 | Keine Whitespace-/Patchfehler. |

## Nicht ausgeführte Prüfungen und Reproduzierbarkeit

- Kein vollständiger Integration-, HTTP-, Browser- oder Staging-Lauf wurde für
  diesen begrenzten Follow-up wiederholt. Daher ändert dieser Record keine
  historische Phasen-Checkbox und erteilt keine LC-/Go-live-Freigabe.
- Es wurde kein Clean Clone angelegt. Die Prüfungen liefen auf dem gepullten
  Zielbaum mit vorhandenen, lockfilegebundenen Dependencies und dem isolierten
  PostgreSQL-Testdienst auf `127.0.0.1:5435`. Das ungetrackte lokale
  `.vercel/project.json` wurde weder gelesen noch gestaged und ist keine
  Voraussetzung des geprüften Codes.
- Für Vercel/Supabase wurden keine Zielvariablen oder Datenbankrollen mutiert.
  Vor einem Deployment müssen insbesondere `TRUSTED_PROXY_HOPS=1`, wirksame
  Datenbanktimeouts, Legal-Publikationen und die übrigen G4-Owner-/Provider-
  Gates im Zielsystem separat belegt werden.
