# Phase 29 — UX, Mobile, Accessibility und Conversion

> **Status: GEPLANT / NICHT BEGONNEN.** Phase 18 besitzt eine starke
> Chromium-Matrix über 100 Seiten und kontrolliert Dokument-Overflow. Firefox,
> WebKit, `serious` Axe, echte Screenreader-Flows und mehrere mobile
> Operationsansichten bleiben unvollständig.

## Ziel

Kritische Public-, Candidate-, Employer-, Recruiter- und Adminreisen auf kleinen
Bildschirmen, mit Tastatur, Screenreader und den relevanten Browserengines
vollständig nutzbar und verständlich machen.

## Ausgangslage und Problem-IDs

- `STH-023` teilweise bestätigt: gute Chromium-/Critical-Axe-Abdeckung, aber
  kein Firefox/WebKit- und kein dokumentierter NVDA/VoiceOver-Abschluss.
- `STH-025` bestätigt mit Mitigation: Tabellen sind eingegrenzt scrollbar,
  bleiben mobil jedoch schwer bedienbar.
- Preference-/Consent-UX aus `STH-026` wird in Phase 20 fachlich gebaut und hier
  als Conversion-/Accessibility-Regression geschützt.
- Die fachliche Startcluster-Suche aus `STH-019` gehört Track 30A; diese Phase
  übernimmt nur die verbindliche Mobile-/Browser-/Assistive-Technology-
  Regression ihrer Search-/Alert-/Recommendation-Journey.

## In Scope

- Candidate Onboarding/JobPass als klarer Schrittprozess mit Autosave/Resume.
- Mindestprofil versus optionale Optimierung.
- Mobile Sticky Primary Actions und Filter Drawer.
- Responsive Cards/progressive Details für kritische breite Tabellen.
- Radar „Wer sieht was?“, Reveal- und Consent-Erklärung.
- Firmenbadge-/Trust- und reale Legal Links; kein Fake Social Proof.
- Firefox, WebKit und Chromium für kritische Journeys.
- `critical + serious = 0` nach versionierter, begründeter Baseline.
- vollständige Keyboard-/Focus-/Dialog-/Error-Summary-Flows.
- dokumentierte NVDA- und VoiceOver-Smokes; visuelle Regression dort, wo sie
  echten Schutz bietet.

## Out of Scope

- Native Apps, allgemeiner Design-Rewrite oder Marketing-Fake-Daten.
- Doppelte mobile Businesslogik oder separate clientseitige Autorisierung.
- Accessibility-Ausnahmen ohne Owner, Ablauf und Begründung.
- Produktionscopy ohne Phase-22-/26-/31-Freigaben.

## Rollen und Prozesse

Alle fünf sichtbaren Kontexte: Public, Candidate, Employer, Recruiter und
Admin. Fokus liegt auf Registrierung/Verification, Search/Apply/JobPass,
Documents/Privacy/Radar, Company/Jobs/Pipeline/Interview/Billing und Admin
Queues/Actions.

## Betroffene Dateien und Module

- `components/**`, `app/**`, `app/globals.css`
- Form-, Dialog-, Table-, Navigation- und Error-State-Primitives
- `playwright.config.ts`, E2E Fixtures/Quality Suites und A11y Unit Tests
- Route Inventory/Role Matrix und manuelle QA-Checklisten

## Datenmodell und Migration

Grundsätzlich keine fachliche Schemaänderung. Autosave/Resume darf vorhandene
Draft-/Version-/Idempotenzmodelle nutzen; falls ein neues Draftcheckpoint nötig
ist, erfolgt er additiv und wird vorab im Owning-Phase-Vertrag dokumentiert.

## Sicherheits- und Datenschutzfolgen

- Mobile Cards dürfen keine zusätzlichen privaten Felder oder versteckte
  Action-Bypasses rendern.
- Clientautosave sendet nur validierte, zweckgebundene Teilfelder.
- Consent-/Trust-Copy bleibt mit serverseitiger Policy und Dokumentversion
  synchron.
- Screenshots/Visual-Artefakte verwenden ausschließlich DEMO/TEST-Daten.

## Implementierungsschritte

- [ ] UX-/A11y-Baseline mit realen kritischen Aufgaben und Abbruchpunkten.
- [ ] Gemeinsames Responsive List/Card Pattern mit Action-Parität.
- [ ] Admin-, Billing- und Employer-Tabellen nach Priorität migrieren.
- [ ] JobPass Stepper/Autosave/Resume und klare Minimalprofile.
- [ ] Mobile Search Filter/Sticky Apply sowie Radar/Privacy/Verification Trust.
- [ ] serious-Axe-Triage und schrittweise Gate-Aktivierung.
- [ ] Firefox/WebKit-Projekte und stabile Cross-browser-Fixtures.
- [ ] vollständige Keyboard-/Focus-/Dialog-/Error-Flows.
- [ ] NVDA/VoiceOver-Manuellmatrix und visuelle Regression.
- [ ] Analytics misst nur freigegebene Conversionevents aus Phase 22.

## Abhängigkeiten

Die zielrelevanten fachlichen Kernphasen aus 20–28, damit UX keine
Fake-Aktionen vorwegnimmt. Phase 24 ist bei Paid Scope Pflicht; im kostenlosen
Scope werden Kauf-CTAs und Billing-Pfade stattdessen fail-closed/locked
geprüft. Phase 27 ist nur bei Multi-Persona-Scope erforderlich. Hinzu kommen
der fachlich grüne Phase-30A-Vertrag vor der finalen
Search-/Alert-/Recommendation-Abnahme, Browser-/CI-Kapazität, Accessibility
Owner und Geräte/AT für manuelle Smokes.

## Risiken und Regressionen

- Desktop-/Mobile-DOM driftet oder Actions unterscheiden sich.
- Cross-browser-Gate wird durch pauschale Sleeps statt Ursachen stabilisiert.
- Autosave überschreibt neuere Serverversionen.
- Horizontal Scroll wird entfernt, ohne alle Daten/Aktionen erreichbar zu
  halten.
- Bestehende 100-Seiten-Inventar- und Tenant-Guards bleiben Pflicht.

## Abwärtskompatibilität und Rollback

Responsive Patterns werden routeweise ausgerollt. Desktop-Tabelle bleibt
während Paritätsphase; der Serveraction-Vertrag ändert sich nicht. Autosave ist
versioniert und feature-gegatet. Browserprojekte werden nicht durch Abschwächen
der Assertions „grün“ gemacht.

## Akzeptanzkriterien und Tests

### Component / Unit

- [ ] Table/Card Action-/Field-Parität.
- [ ] Stepper/Autosave Version Conflict und Resume.
- [ ] Labels, Description, Error Summary, Focus Return und reduced motion.

### Browser

- [ ] kritische E2E-Reisen in Chromium, Firefox und WebKit.
- [ ] zentrale Startcluster-Berufsvariante/Tippfehler → relevantes Resultat →
  Detail/Apply sowie Search→Alert/Recommendation ist in der kritischen
  Browsermatrix enthalten; die fachlichen Urteile stammen unverändert aus 30A.
- [ ] alle 100 Routes weiter in Chromium Desktop/360 px.
- [ ] `critical + serious = 0`; eine eng begrenzte Ausnahme ist nur mit
  dokumentiertem Owner, Begründung und noch nicht erreichtem Ablaufdatum
  zulässig. Eine abgelaufene Ausnahme macht das Gate rot; keine pauschale
  Allowlist.
- [ ] 320/360/768/Desktop ohne versteckte Hauptaktion.
- [ ] Keyboard-only Dialogs, Drawers, Menus, Tabellen/Cards und Forms.

### Manuell

- [ ] NVDA/Firefox oder Chrome und VoiceOver/Safari Kernmatrix.
- [ ] Zoom 200/400 %, High Contrast, Reduced Motion und Touch.
- [ ] reale deutsche Copy, Empty/Loading/Locked/Error/Retry.

## Evidence und Definition of Done

- [ ] Kritische mobile Flows benötigen keine unbeschriftete horizontale
  Tabellenjagd.
- [ ] Firefox/WebKit und serious-A11y sind echte Gates.
- [ ] Screenreader-/Keyboard-Smokes sind auf dem Zielcommit dokumentiert.
- [ ] Autosave/Resume ist konflikt- und datenschutzsicher.
- [ ] Trust-/Consent-/Legal-Copy entspricht Serverpolicy.
- [ ] Loading-, Empty-, Locked-, Error-, Retry-, Conflict- und Success-Zustände
  sind in der Browser-/Viewport-/Assistive-Technology-Matrix enthalten.
- [ ] Keine Route, Action, Rolle oder Tenant-Grenze regressiert.

## Offene externe Voraussetzungen

Accessibility Owner, reale AT-Geräte/Browser, gegebenenfalls externe
Accessibility-Prüfung und juristisch/kommerziell freigegebene Trust-Copy.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Weniger Abbruch und echte Nutzbarkeit auf Mobile und mit Assistive Technology. |
| Problem-IDs | STH-023, STH-025; UX-Regression von STH-026. |
| Prerequisites | Zielrelevante 20–28; 30A vor Search-Abnahme; 24 nur bei Paid Scope, sonst Billing locked; 27 nur bei Multi-Persona. |
| Deliverables | Step UX, responsive Cards, Cross-browser, serious-A11y, AT evidence. |
| Security / Privacy | Keine Client-Gates/PII-Mehrprojektion; DEMO-only QA-Artefakte. |
| Tests | Component parity, 3 engines, 100 routes, keyboard, NVDA/VoiceOver. |
| Expected Result | Kritische Aufgaben sind unabhängig von Viewport/Browser/AT abschließbar. |
| Risks / Limits | Kein pauschaler Redesign; manuelle AT-Prüfung bleibt menschliche Evidence. |
