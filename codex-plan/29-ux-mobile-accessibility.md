# Phase 29 — Moderierte UX, Mobile, Cross-Browser und Accessibility

> **Planstatus: GEPLANT. Technikstatus: NICHT IMPLEMENTIERT. Quality-Gate:
> NICHT GELAUFEN. Aktivierung: DISABLED.** Track 29A startet nach Phase 19 als
> moderierte Research-/Trust-Arbeit und darf Feedback an besitzende Fachphasen
> liefern. Track 29B folgt erst auf stabilen, tatsächlich im Launchscope
> enthaltenen Fachverträgen. Automatische Browser-/A11y-Tests sind kein Ersatz
> für beobachtete Verständlichkeit.

Es gilt der vollständige
[`remediation-execution-contract.md`](./remediation-execution-contract.md).

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Track | Plan | Technik | Quality-Gate | Aktivierung |
|---|---|---|---|---|
| 29A moderierte Research | nach bestandener Phase 19 zulässig, noch nicht begonnen | keine Runtimeimplementierung | externe Evidence offen | Research-only |
| 29B UX/Mobile/Cross-Browser/A11y | geplant | nicht implementiert | nicht gelaufen | disabled |

### 2. Ziel und messbarer Nutzerwert

- Kritische Aufgaben werden von realen Kandidat:innen, Employer/Recruiter und
  Admin/Ops verstanden und abgeschlossen.
- LC2-Mindeststichprobe: mindestens fünf Kandidat:innen, fünf
  Employer/Recruiter und drei Admin/Ops in zwei iterativen Runden.
- Allgemeine Kernaufgaben: ≥80 % unassistierter Task-Erfolg und 0 kritische
  Sackgassen. Sicherheitskritische Verständnispunkte – CV-Empfänger,
  Verifizierungsumfang, Radar/Reveal, Preis/Limits/Kündigung – müssen von allen
  Teilnehmenden nach dem Flow korrekt wiedergegeben werden.
- Pro Task werden die messbaren Kennzahlen Task-Success, Task-Time,
  Task-Error, Task-Abandon und Comprehension (einschliesslich
  Median-/p90-Zeit, Fehler, Assistenz, Abbruch und Teach-back) vorab
  definiert; 29B muss gegenüber 29A entweder die Zielschwelle erreichen oder
  eine datierte Go/No-go-Entscheidung auslösen.

### 3. Tatsächlicher Repositoryzustand

- `STH-023`: breite Chromium-Matrix über 100 Seiten, aber kein
  Firefox/WebKit-Gate, kein `serious`-Nullgate und kein finaler dokumentierter
  NVDA-/VoiceOver-Abschluss.
- `STH-025`: Scrollregionen verhindern Dokumentoverflow, breite Employer-/
  Admin-Tabellen bleiben mobil schwer bedienbar.
- `STH-033`: bisher gibt es keinen moderierten Task-/Trust-Vertrag mit echten
  Nutzern.
- Preference Center, Trust, Search und optionale Recruiting-Tracks werden in
  ihren Fachphasen gebaut; Phase 29 prüft und verbessert nur ihren aktivierten
  Scope.

### 4. Findings und Requirements

- `STH-023`, `STH-025`, `STH-033`; UX-Regression für `STH-026`, `STH-030`,
  `STH-031`, `STH-019`, `STH-036`, `STH-037`.
- `REQ-QA-002`, `REQ-REC-029-001` moderierte Kernaufgaben,
  `REQ-REC-029-002` Action-/Information-Parität und
  `REQ-REC-029-003` Cross-Browser-/AT-Gate.

### 5. In Scope

- 29A: Researchplan, Rekrutierung, Einwilligung, Aufgaben, Metriken,
  anonymisierte Beobachtung, Findings, Severity, Owner und Re-Test.
- 29B: JobPass Stepper/Autosave/Resume, mobile Filter/Sticky Actions,
  responsive Cards/progressive Details, Radar-/Reveal-/Verification-/Legal-/
  Pricingverständnis, Firefox/WebKit/Chromium, Keyboard, Zoom, High Contrast,
  Reduced Motion, NVDA/VoiceOver und risikobasierte visuelle Regression.
- Public, Candidate, Employer, Recruiter und Admin/Ops – nur für tatsächlich
  freigegebene Produktpfade.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

- Kein generischer Redesign, keine Native App, keine doppelte mobile
  Businesslogik und keine clientseitige Autorisierung.
- Kein Research mit echten Daten ohne Consent/Privacy-Protokoll.
- Phase 27 und 28A/28B nur bei eigenem Demand-Go; Paid UI nur bei LC5/
  Phase-24-Freigabe, andernfalls vollständig Locked/Unavailable.
- Keine Accessibility-Ausnahme ohne Owner, Reproduktionsfall und Ablaufdatum.

### 7. Rollen und Owner

Research Owner/UX Research, Product Owner, Accessibility Owner, QA,
Privacy Owner und jeweiliger Domain Owner. Teilnehmende werden nach Rolle und
Startcluster rekrutiert. Entwickler moderieren keine Session allein, wenn sie
dadurch Ergebnisse lenken könnten; kritische Findings besitzen einen
unabhängigen Go/No-go-Owner.

### 8. Portale, Routen, Services und Testinfrastruktur

- Kritische Routen: Public Search/Job/Company/Legal/Auth, Candidate JobPass/
  Apply/Documents/Privacy/Radar, Employer Company/Jobs/Pipeline/Billing/Radar,
  Admin Queues/Actions.
- `components/**`, `app/**`, `app/globals.css`, Form/Dialog/Table/Card/
  Navigation/Error-Primitives.
- `playwright.config.ts` erhält risikobasierte Projekte
  `firefox-journeys` und `webkit-journeys`; Chromium-Inventar bleibt.
- Researchartefakte liegen redigiert ausserhalb von Produktanalytics; im Repo
  stehen nur Protokollversion, aggregierte Resultate und freigegebene Evidence.

### 9. Datenmodell, Constraints und Klassifikation

Grundsätzlich keine Fachschemaänderung. Falls JobPass-Checkpoints fehlen, wird
ein additiver owner-scoped Draft mit Version/UpdatedAt und Unique
Candidate×Journey angelegt. Research-PII, Aufnahmen und Rohnotizen gehören
nicht in die Produktdatenbank. Nur anonymisierte/aggregierte Taskresultate mit
Protocol-Version und Cohort-Scope dürfen als Evidence referenziert werden.

### 10. Expand–Migrate–Contract

Responsive Patterns werden routeweise und additive Draft-Checkpoints vor dem
Read-Cutover eingeführt. Desktop-Tabelle bleibt während der Paritätsphase.
Autosave-Backfill darf keinen bestehenden JobPass überschreiben. Alte/new
Writer, Version Conflict, Resume und Rollback werden getestet; Contracting erst
nach G2/G3.

### 11. Serverlogik und Hintergrundprozesse

Serveraction-Verträge, RBAC und Tenantchecks bleiben Domain-Eigentum.
Autosave sendet validierte Teilfelder mit Version/Idempotenz; keine Debounce-
Race darf neuere Daten überschreiben. Research erzeugt keine Produktmutation.
Browser-/A11y-Harnesses laufen deterministisch; pauschale Sleeps und
Assertion-Abschwächungen sind verboten.

### 12. UX-Zustände

Jede Kernreise deckt Loading, Empty, Locked/Unavailable, Pending, Error,
Retry, Conflict, Expired, Cancelled und Success ab. Fehler erhalten
Error-Summary, Feldbezug, Fokus und nächsten Schritt. Trust-/Pricingcopy nennt
Scope, Quelle, Datum, Grenzen und irreversible Folgen.

### 13. Mobile und Accessibility

- Viewports 320, 360, 768 und Desktop; Touchziele mindestens 44×44 CSS-Pixel,
  keine versteckte Hauptaktion oder Dokumentoverflow.
- `critical + serious = 0` in aktivierten Kernreisen. Eine nicht-P0-Ausnahme
  braucht Owner/Ablauf und macht nach Ablauf das Gate rot.
- Keyboard-only, Fokusreihenfolge/Trap/Return, Status-/Error-Ankündigung,
  200/400 % Zoom, High Contrast, Reduced Motion.
- Dokumentierte NVDA/Firefox oder Chrome sowie VoiceOver/Safari-Smokes.

### 14. Authentisierung, Step-up, Autorisierung und Tenant

Responsive Cards/Tables zeigen exakt dieselben erlaubten Felder/Aktionen.
Kein Mobile-/Client-Gate ersetzt serverseitige Auth, Membership, Assignment,
Ownership, Capability, Entitlement oder `STH-030`-Step-up. Researchkonten sind
isoliert; Direct URLs und fremde IDs werden in jeder Oberfläche negativ
geprüft.

### 15. Datenschutz, Retention, Export, Löschung und Audit

Research Consent, Aufzeichnung, Speicherort, Zugriff, Löschdatum und Widerruf
werden vor Session festgelegt. Screenshots/Video nutzen DEMO/TEST-Daten; keine
Tokens, CVs, Nachrichten oder Revealwerte in Artefakten. Consent-/Trust-/Legal-
Copy bleibt aus derselben serverseitigen Policy-/Dokumentversion abgeleitet.

### 16. Abuse-, Fraud- und Missbrauchsszenarien

Research Social Engineering, Testaccount-Übernahme, Screenshot-/PII-Leak,
mobile Action-Bypasses, Clickjacking/Focus-Stealing, irreführende Dark Patterns
und manipulierte Pricing-/Reveal-UI werden geprüft. Visuelle Änderungen dürfen
keine Rate-, Step-up-, Fraud- oder Tenant-Grenze umgehen.

### 17. Externe und organisatorische Voraussetzungen

Recruiting-Budget/Teilnehmende, Research-/Privacy-Consent, Accessibility Owner,
NVDA-/VoiceOver-Geräte, Firefox/WebKit-CI und freigegebene deutsche Copy.
Preis-, Trust-, Radar- und Legal-Verständnistests warten auf die jeweilige
fachliche Copy, nicht auf einen Fake-Prototyp.

### 18. Abhängigkeiten

- 29A: Phase 19; danach parallel zu technischen Kernphasen.
- 29B: nur zielrelevante stabile Phasen 20–26, grüne 30A-/30D-Verträge und
  umgesetzte kritische Researchfindings; 24 nur für Paid, 27/28 nur bei Scope.
- 30B-Admin-UI wird mit 29B sequenziert, nicht gleichzeitig breit refactored.

### 19. Geordnete Implementierungsschritte

1. Researchfragen, Tasks, Schwellen und Consent vorregistrieren.
2. Runde 1 durchführen, Findings nach Severity/Owner/Gate triagieren.
3. Domain Owner korrigiert Fachvertrag; keine isolierte UI-Kosmetik.
4. Shared responsive/A11y-Primitives und routeweise Migration.
5. JobPass/Filters/Trust/Preference/Queue-Journeys.
6. Cross-Browser-/A11y-Harness.
7. Runde 2 und dieselben Tasks erneut.
8. G2/G3, AT-Smokes und launchklassenspezifischer Go/No-go.

### 20. Feature-Flags und Aktivierung

Routeweise responsive Flags, versionierter Autosave-Flag und getrennte
Browserprojekte. Aktivierung erfolgt Canary→Rollen-Allowlist→vollständiger
Scope. Rollback darf niemals Serverpolicy/Consent abschwächen. Researchfindings
P0/P1 bleiben als Releaseblocker, nicht als UI-Featureflag.

### 21. Akzeptanzkriterien und vollständige Testmatrix

- `AC-29-01`: moderierte Runde 1 besitzt gültige Stichprobe und Baseline.
- `AC-29-02`: allgemeine Tasks ≥80 %, kritisches Verständnis 100 %, keine
  kritische Sackgasse.
- `AC-29-03`: Tabelle/Card und Desktop/Mobile besitzen Feld-/Action-Parität.
- `AC-29-04`: JobPass Autosave/Resume ist konflikt- und datenschutzsicher.
- `AC-29-05`: kritische Reisen laufen in Chromium/Firefox/WebKit.
- `AC-29-06`: critical/serious Axe, Keyboard, Zoom und AT erfüllen das Gate.
- `AC-29-07`: Trust/Consent/Price/Cancel-Copy entspricht Fachpolicy.
- `AC-29-08`: Runde 2 belegt Verbesserung oder erzeugt No-go.

| Criterion / Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC-29-01 / STH-033 | P0 ab LC2 | Moderiert | vorregistrierte Runde 1 je Rolle | Zielsegment löst reale Tasks | fehlender Consent, falsches Segment oder Moderatorhilfe wird nicht als Erfolg gezählt | Candidate, Employer/Recruiter, Admin/Ops | alle kritischen Portale | ≥5/≥5/≥3, zwei Clusterfälle nur falls im Scope | isolierte Researchumgebung | Protokoll `codex-plan/research/phase29-moderated-protocol-v1.md`: Consent→Task ohne Hilfe→Teach-back→Debrief; Rohdaten extern löschen | 100 % gültige Consents; Stichprobe erreicht; jede Hilfe/Abbruch erfasst | anonymisierter Researchreport | UX Research + Privacy | PLANNED |
| AC-29-02 / REQ-REC-029-001 | P0 | Moderiert | Search/Apply/JobPass, Verify/Publish/Pipeline, Admin-Triage | Nutzer schliessen Task ab und erklären Wirkung | CV-/Reveal-/Badge-/Price-/Cancel-Missverständnis blockiert | alle | Public/Candidate/Employer/Admin | realistische TEST-Szenarien | Runde 1/2 | gleicher manueller Ablauf aus Protocol v1; keine spontane Umformulierung zwischen Kohorten | ≥80 % allgemeiner unassistierter Erfolg; 0 kritische Sackgassen; 100 % korrektes Teach-back bei Sicherheits-/Paid-Themen | Taskmatrix, Zeiten, Fehler, Abbruch | Product + Domain Owner | PLANNED |
| AC-29-03 / STH-025 | P1/P0 häufige Mobiletasks | Component + Browser | Desktop-Tabelle ↔ mobile Card | identische Felder/Aktionen | versteckte Action, falsche Capability, doppelter DOM drift | Employer, Admin | Jobs/Billing/Queues | alle Rollen/Zustände | jsdom + 320/360/Desktop | `npx vitest run --config vitest.config.ts tests/unit/ui/phase29-responsive-parity.test.tsx && npx playwright test --config=playwright.config.ts tests/e2e/quality/phase29-responsive-operations.spec.ts --project=chromium-mobile-360` | Paritätsmanifest 100 %; Dokumentoverflow 0; Hauptaktion sichtbar | Unit/Playwright/Clippingreport | UI + QA | PLANNED |
| AC-29-04 | P1 | Unit + PostgreSQL | Autosave v1/v2, Offline/Resume | neueste Version bleibt | stale tab, Replay, fremder Candidate, partial invalid field denied | Candidate | JobPass | zwei Tabs, Offline, Candidate A/B | jsdom + PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/candidate/jobpass-stepper.test.tsx && npx vitest run --config vitest.integration.config.ts tests/integration/candidate/jobpass-autosave-postgres.test.ts` | stale Write 0; Resume exakt letzte bestätigte Version; Cross-user 0 | Versiontimeline + DB report | Candidate Engineering | PLANNED |
| AC-29-05 / STH-023 | P0 LC3+ | Cross-Browser E2E | freigegebene Kernreisen in 3 Engines | identischer fachlicher Abschluss | Enginefehler, Consoleerror, unerreichbare Aktion macht Gate rot | alle | kritische Portale | deterministische Fixtures | Chromium/Firefox/WebKit | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase29-critical-journeys.spec.ts --project=chromium-journeys && npx playwright test --config=playwright.config.ts tests/e2e/quality/phase29-critical-journeys.spec.ts --project=firefox-journeys && npx playwright test --config=playwright.config.ts tests/e2e/quality/phase29-critical-journeys.spec.ts --project=webkit-journeys` | Fail/Skip/Retry 0 in allen Engines | drei HTML-Reports | QA Owner | PLANNED |
| AC-29-06 / REQ-REC-029-003 | P0 | Automated + manuell AT | Axe/Keyboard/Zoom/NVDA/VoiceOver | alle Aufgaben ohne Maus | Fokusverlust, unbenannter Fehler, serious/critical violation | alle | kritische Portale | Loading/Error/Locked/Success | Browser + reale AT | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase29-accessibility.spec.ts --project=chromium-journeys`; danach Checkliste NVDA+Firefox/Chrome und VoiceOver+Safari | critical+serious=0; Keyboardtask 100 %; 200/400 % ohne Funktionsverlust | Axe JSON, AT-Protokoll, Screens | Accessibility Owner | PLANNED |
| AC-29-07 / STH-026/030/037 | P0 Trust/Paid | Contract + moderiert | Policyversion ↔ sichtbare Copy | Scope/Empfänger/Preis/Kündigung korrekt | veraltete Copy, Fake Social Proof, Client-only Lock | Candidate, Employer | Radar/Verify/Pricing/Privacy | aktuelle Policy-/Dokumentversion | Test + Runde 2 | `npx vitest run --config vitest.config.ts tests/unit/ui/phase29-policy-copy-contract.test.tsx`; moderierter Teach-back nach Protocol v1 | 0 Policy-Diffs; 100 % kritisches Teach-back | Contractdiff + Researchreport | Product/Legal/Privacy | PLANNED |
| AC-29-08 / STH-033 | P0 | Moderiert | gleiche Tasks nach Korrekturen | Ziele erreicht | P0/P1 Finding offen oder Ergebnis verschlechtert | alle | Zieljourneys | vergleichbare Kohorte | Runde 2 | Protocol v1 unverändert ausführen; Findings nach Severity vergleichen | alle P0 geschlossen; Zielschwellen erreicht; andernfalls dokumentiertes No-go | Vorher/Nachher-Matrix | UX Research + Release Owner | PLANNED |
| AC-29-03–07 | G2/G3 | Vollregression | 100-Routen-Inventar + Kernreisen | Bestand und neue Scope-Routen grün | Skip/Retry/anderer Commit rot | alle | Repository | isolierte DB/Browser | CI/PostgreSQL 16 | `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e:http && npm run test:e2e:browser` | Exit 0; Retry/Skip 0; Routeinventar vollständig | Phase-29-Evidence | Release Owner | PLANNED |

### 22. Performance- und Skalierungsgrenzen

- Core Web Vitals/Serverbudgets werden vor 29B pro kritischer Route auf
  Phase-19-Baseline eingefroren; keine p95-Verschlechterung >10 % ohne
  verantworteten Produktentscheid.
- Mobile Hauptaktion bis interaktiv innerhalb des freigegebenen p95-Budgets;
  Autosave maximal ein Request je 750 ms und bounded Payload.
- Firefox/WebKit/Chromium-Gate Retry 0; Visual Baselines nur für stabile,
  risikoreiche Komponenten, kein flächendeckendes blindes Snapshotting.

### 23. Geschützte Phase-01–18-Invarianten

100-Routen-Inventar, Tenant-/Capability-/Assignment-Grenzen, Apply, Job
Publish, Billing/Radar-Gates, no-store/noindex, Score-/Boost-Semantik und
alle serverseitigen Actions. Bestehende all-routes-, critical-routes-,
phase17-journey- und Unit-A11y-Suites bleiben Owning-Regressionen.

### 24. Rollback / Roll-forward

Routeweise Rollback auf letzte action-paritätische Darstellung. Autosave-Flag
kann neue Writes stoppen, vorhandene Drafts bleiben lesbar. Ein Rollback darf
kein P0-Researchfinding oder A11y-/Policyproblem wieder aktivieren; dann wird
die betroffene Journey geschlossen oder roll-forward korrigiert.

### 25. Evidence

Vorregistriertes Protokoll, Consent-/Löschbestätigung, anonymisierte Kohorten,
Task Success/Time/Error/Assist/Abandon/Teach-back, Findingregister,
Before/After, drei Browserreports, Axe/Keyboard/Zoom, NVDA/VoiceOver,
responsive Parität, Performance und Zielcommit/-digest.

### 26. Definition of Done

29A ist abgeschlossen, wenn zwei gültige Runden mit Schwellen und owner-
gebundenen Entscheidungen dokumentiert sind. 29B ist technisch fertig, wenn
AC-29-03–07, G2/G3 und der Zielscope grün sind. LIVE bleibt blockiert, solange
ein P0-Research-, A11y-, Trust- oder Policyfinding offen ist.

### 27. Folgephasen-Gate

Phase 30B darf breite Admin-UI erst nach dem gemeinsamen Responsive Pattern
integrieren. Phase 31B darf Pricing/Trust-Claims erst nach 29A/29B-Freigabe
aktivieren. Phase 32 verlangt für LC2–LC6 die relevante moderierte Evidence;
LC4–LC6 zusätzlich Cross-Browser/AT auf dem Releaseartefakt.

### 28. Ausdrücklich nicht bewiesen

Ein grüner Axe-/Browserlauf beweist keine Verständlichkeit, Zufriedenheit,
Marktnachfrage oder Zahlungsbereitschaft. Kleine moderierte Stichproben sind
qualitative Gate-Evidence, keine repräsentative Schweizer Marktstatistik.
Phase 29 beweist keine native App, keine vollständige Browserfreiheit und keine
fachliche Korrektheit eines ungeprüften Domainvertrags.
