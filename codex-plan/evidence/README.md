# Evidence-Vertrag

Evidence belegt ausschliesslich den Zustand des Zielrepositories. Historische
Quellnotizen, nicht reproduzierbare Behauptungen und reine Implementierungsabsicht
gelten nicht als Nachweis.

## Ablage und Benennung

- Pro abgeschlossener Phase entsteht mindestens ein datierter Record unter
  `codex-plan/evidence/YYYY-MM-DD-phase-NN.md`.
- Der Record nennt den unveränderlichen Ziel-Commit, gegen den alle automatischen
  und manuellen Prüfungen ausgeführt wurden. Ein späterer Evidence-Commit darf
  diesen geprüften Code-Commit referenzieren.
- Secrets, vollständige Verbindungs-URLs, personenbezogene Daten und rohe
  Fehlerobjekte werden weder im Record noch in angehängten Logs gespeichert.

## Records

- [`2026-07-19-phase-01.md`](./2026-07-19-phase-01.md) — Foundation und Governance.
- [`2026-07-19-phase-02.md`](./2026-07-19-phase-02.md) — Prisma-Domänenvertrag und PostgreSQL-Migration.
- [`2026-07-19-phase-03.md`](./2026-07-19-phase-03.md) — Core Policies, Scoring, Privacy und Analytics.
- [`2026-07-20-phase-04.md`](./2026-07-20-phase-04.md) — Provider Ports, lokale Mocks und geschützte Mailbox.
- [`2026-07-20-phase-05.md`](./2026-07-20-phase-05.md) — Deterministischer Schweizer Demo-Seed und Test-Harness.
- [`2026-07-20-phase-06.md`](./2026-07-20-phase-06.md) — Authentifizierung, Sessions, RBAC, Firmenkontext und sicheres Onboarding.
- [`2026-07-20-phase-07.md`](./2026-07-20-phase-07.md) — Öffentliche Jobsuche, Firmen, Lohn-Radar, Ratgeber und Auth-Polish.
- [`2026-07-20-phase-08.md`](./2026-07-20-phase-08.md) — Fail-closed Pricing, Arbeitgeber-Marketing und idempotente Demo-/Sales-Lead-Erfassung.
- [`2026-07-20-phase-09.md`](./2026-07-20-phase-09.md) — Candidate-Core mit SwissJobPass, Saved Jobs, Bewerbungen, Jobabos, Messaging, Talent-Radar-Consent und Privacy-Cases.
- [`2026-07-21-phase-10.md`](./2026-07-21-phase-10.md) — Arbeitgeber- und Recruiter-Core mit Firma, Team, Einladungen, Job-Wizard, Bewerber:innen-Pipeline und ehrlichen Radar-/Analytics-Grenzen.
- [`2026-07-21-phase-11.md`](./2026-07-21-phase-11.md) — Admin-Operations mit Moderation, Imports, Support, Content, Leads und evidenzbasiertem Business Cockpit.
- [`2026-07-22-phase-12.md`](./2026-07-22-phase-12.md) — Entitlements, sicherer Mock-Checkout, Subscriptions, Rechnungen, Credits, Katalog und Finanzmetriken.
- [`2026-07-22-phase-13.md`](./2026-07-22-phase-13.md) — Atomare Job-Boost-Aktivierung, Paid-Fulfillment, Lifecycle, Kündigung, Sponsored-Ranking und transparente Kennzeichnung.
- [`2026-07-22-phase-14.md`](./2026-07-22-phase-14.md) — Privacy-bounded Talent Radar, atomare Kontaktfinanzierung, kandidateninitiierte verschlüsselte Reveal-Snapshots und kontrollierte Datenschutzfälle.
- [`2026-07-22-phase-15.md`](./2026-07-22-phase-15.md) — Datenbankgerankte Keyset-Suche, stabile Slugs, JobPosting-JSON-LD, Canonicals, dynamische Sitemap/Robots und dual freigegebene Content-/Liquiditätsgates.

## Pflichtfelder eines Records

1. Datum, Zeitzone, Phase, Branch und vollständiger Ziel-Commit.
2. Betriebssystem sowie exakte Node-, npm-, Docker-/Compose- und
   PostgreSQL-Image-Versionen, soweit für die Phase relevant.
3. Kurzbeschreibung des geprüften Scopes und ausdrücklich ausgeschlossener
   Funktionen.
4. Tabelle jedes ausgeführten Befehls mit Arbeitsverzeichnis, Ergebnis,
   Exit-Code und einer knappen, redigierten Beobachtung.
5. Manuelle Prüfungen mit Viewport, Eingabemethode und konkretem Resultat.
6. Bekannte Limitationen, übersprungene Prüfungen und offene Risiken. Eine
   übersprungene Pflichtprüfung verhindert den Abschluss der betroffenen
   Checkbox.
7. Bestätigung, dass der Arbeitsbaum des Ziel-Commits reproduzierbar installiert
   wurde und keine fremden oder generierten lokalen Artefakte als Voraussetzung
   dienten.

## Checkbox-Regel

Zuerst wird der Detailplan anhand eines verlinkten, erfolgreichen Records
aktualisiert. Erst wenn sämtliche Definition-of-Done-Punkte der Detailphase
belegt sind, darf danach die zugehörige Phase in `00-PLAN.md` auf `[x]` wechseln.
Ein fehlgeschlagener oder nur lokal vermuteter Check bleibt `[ ]` und wird im
Record als Limitation benannt.
