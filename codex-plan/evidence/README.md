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
- [`2026-07-22-phase-11-follow-up.md`](./2026-07-22-phase-11-follow-up.md) — unabhängig bewertete und geschlossene Phase-11-UI-, Audit-, Seed- und Testlücken.
- [`2026-07-22-phase-12.md`](./2026-07-22-phase-12.md) — Entitlements, sicherer Mock-Checkout, Subscriptions, Rechnungen, Credits, Katalog und Finanzmetriken.
- [`2026-07-22-phase-13.md`](./2026-07-22-phase-13.md) — Atomare Job-Boost-Aktivierung, Paid-Fulfillment, Lifecycle, Kündigung, Sponsored-Ranking und transparente Kennzeichnung.
- [`2026-07-22-phase-14.md`](./2026-07-22-phase-14.md) — Privacy-bounded Talent Radar, atomare Kontaktfinanzierung, kandidateninitiierte verschlüsselte Reveal-Snapshots und kontrollierte Datenschutzfälle.
- [`2026-07-22-phase-15.md`](./2026-07-22-phase-15.md) — Datenbankgerankte Keyset-Suche, stabile Slugs, JobPosting-JSON-LD, Canonicals, dynamische Sitemap/Robots und dual freigegebene Content-/Liquiditätsgates.
- [`2026-07-23-phase-16.md`](./2026-07-23-phase-16.md) — Per-request CSP, CSRF-/IDOR-/Cache-Härtung, Audit-Vollständigkeit, redigiertes Logging, Health/Readiness, Abuse-Flows und Security-Maintenance.
- [`2026-07-23-phase-17.md`](./2026-07-23-phase-17.md) — Cross-role E2E-01–07, Desktop-/360px-Quality-Matrix, Zero-Retry-Manifest sowie Linux/PostgreSQL- und Windows-CI.
- [`2026-07-24-phase-18.md`](./2026-07-24-phase-18.md) — Dokumentations-/Release-Audit, vollständige 100-Seiten-Desktop-/360px-Matrix, E2E-08 Clean Clone sowie verschlüsselter Backup-/Restore-Drill.
- [`2026-07-24-commercial-launch-follow-up.md`](./2026-07-24-commercial-launch-follow-up.md) — unabhängig bewertete Commercial-, Cashflow-, Packaging-, Salary-, Worker- und AVG-Befunde samt isolierter Zielcommit-Verifikation.
- [`2026-07-26-phase-19.md`](./2026-07-26-phase-19.md) — aktuelle Remediation-Governance, vollständige Clean-Clone-/Golden-Baseline, 37-ID-Traceability sowie Search-, Fan-out-, Admin-Cap- und Sitemap-Istwerte.
- [`2026-07-26-phase-20.md`](./2026-07-26-phase-20.md) — verifizierte E-Mail-Identität, sicherer Login-E-Mail-Wechsel, atomare Notification-Outbox, bounded Dispatcher, Preferences und fail-closed Resend-Sandboxvertrag.
- [`2026-07-26-phase-21.md`](./2026-07-26-phase-21.md) — quarantänisierter Document-/CV-Vault, immutable Application-Versionen, Single-use-Downloads, Reconciliation und fail-closed Storage-/Scanner-Sandboxvertrag.
- [`2026-07-26-phase-22.md`](./2026-07-26-phase-22.md) — technischer Privacy-/Legal-/Analytics-Sandboxvertrag mit Processor-Reconciliation, Restore-Schutz und explizit offenen Counsel-/Research-Gates.
- [`2026-07-27-phase-23.md`](./2026-07-27-phase-23.md) — commitgebundener Local-/CI-Worker-, Lease-/DLQ-/Replay-, Provider-Ledger-, Capacity- und Ops-Cockpit-Kandidat; reales Staging/Pager/Backup/SLO bleibt blockiert.
- [`2026-07-27-phase-24.md`](./2026-07-27-phase-24.md) — deaktivierter Local-/CI-Zahlungs-, Webhook-, Reconciliation-, Finance- und Service-Recovery-Vertrag; WTP, PSP, Tax/Legal/Finance, Staging und LIVE bleiben blockiert.
- [`2026-07-28-phase-25.md`](./2026-07-28-phase-25.md) — Least-Privilege-Adminrollen, MFA/Recovery, Step-up sowie Trust-&-Safety-Containment und Appeal; Production-RP-ID, Duty-Owner, Risk/DSFA, Pager und LIVE bleiben blockiert.
- [`2026-07-28-phase-26.md`](./2026-07-28-phase-26.md) — strukturierte Company-Trust-Evidence, Providerports, Vault, unabhängige Decisions, Re-review und gemeinsame Badge-/Job-/Radar-Revocation; reale Provider, Legal/Capacity, Staging und Public-Go bleiben blockiert.
- [`2026-07-28-phase-27.md`](./2026-07-28-phase-27.md) — default-off Multi-Persona-/Sessionkontext-Vertrag mit sicherem Portalwechsel, bestehender-Identity-Invitation, identity-weiter Privacy und strikt getrennten Tenant-/Adminrechten; Demand, Staging und LIVE bleiben offen.
- [`2026-07-29-phase-28.md`](./2026-07-29-phase-28.md) — getrennte, default-off Local-/CI-Verträge für candidate-owned externe Bewerbungszustände und persistente Interviewplanung; Demand-, Provider-, Staging- und LIVE-Gates bleiben offen.
- [`2026-07-29-phase-29.md`](./2026-07-29-phase-29.md) — responsive, Cross-Browser- und automatisierte Accessibility-Technikbasis; moderierte Runden und reale NVDA-/VoiceOver-Smokes bleiben offen.
- [`2026-07-29-phase-30.md`](./2026-07-29-phase-30.md) — versionierte de-CH-Search-/Learning-/Cluster-V2-Technik, triggergebundene Scale-/Sitemap-Operations und canonical Job-Freshness; Fachreview, Zielalerts, Moderationskapazität, Staging und LIVE bleiben offen.
- [`2026-07-30-phase-31.md`](./2026-07-30-phase-31.md) — fail-closed Commercial-/WTP-/Delivery-, Capacity-/Cashflow-/Recovery- und Draft-only-Import-Technik; reale Fach-, Markt-, Legal-, Finance- und Operations-Evidence bleibt offen.
- [`2026-07-30-phase-32.md`](./2026-07-30-phase-32.md) — candidate-gebundener LC1-G4-Orchestrator, sechs Launchklassen, 37-Findingsledger und striktes Release-Manifest; Walkthrough, Rollback und unabhängige Approvals fehlen, daher Release `NO_GO` und LC2–LC6 `NOT APPROVED`.
- [`2026-08-01-runtime-findings-follow-up.md`](./2026-08-01-runtime-findings-follow-up.md) — unabhängig klassifizierte Runtime-/Nutzerweg-/Security-/Betriebsbefunde; bestätigte Codefehler geschlossen, bewusste Fail-closed-Verträge abgegrenzt und externe Legal-/Provider-/Scale-Gates weiterhin offen.

- [`2026-08-05-phase-33.md`](./2026-08-05-phase-33.md) — technischer
  exact-candidate-G4 für LC4 Public Free und LC5 Paid Self-Service
  Configuration mit 38/38 Pflichtbefehlen, 11/11 Gates, drei Browsern,
  Production-Contract-, Provider-, Worker-, Recovery- und Artefaktbindung.
  Technik und Quality sind bestanden; reale Aktivierung bleibt
  `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`.
- [`2026-08-07-phase-34.md`](./2026-08-07-phase-34.md) — abgeschlossener,
  Digest- und commitgebundener unabhängiger Re-Audit mit 106 final
  klassifizierten Findings, 74/74 Migrationen, 18 `COVERED`-/2
  `EXTERNAL`-Pflichtreisen und grünen Unit-, PostgreSQL-, Build-, Runtime-,
  Security-, Supply-Chain- und Browser-Suites. Technik lautet `GO`, Quality
  `PASSED`; die Aktivierung bleibt wegen echter externer Gates `NO_GO`.

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

Für Phase 33 zusätzlich verpflichtend:

8. SHA-256 aller vor Phase 33 vorhandenen SQL-Migrationen vor und nach der
   Änderung sowie jede neue Migration und alle Fresh-/Upgrade-/Legacy-/
   Partial-/Restart-/Concurrency-Zustände.
9. getrennte `local/mock`- und `production-contract`-Profile, Service-/Image-
   Versionen, Netz-/Volume-Isolation und Healthchecks; Contract-Stubs und
   synthetische Receipts sind ausdrücklich `CONTRACT_ONLY`.
10. Environment-/Feature-/Provider-/Workerinventare und ihre Config-/Ledger-/
    Migration-/Standalone-/OCI-Artefaktdigests.
11. jede Phase-33-AC-Zeile, Rollen-/Journey-/Browser-/Viewport-/A11y-/
    Provider-/Worker-/Failurematrix, Exit/Dauer/Pass/Fail/Skip/Retry sowie alle
    initialen Root Causes, Fixes und Re-Runs.
12. getrenntes technisches Urteil und Aktivierungsurteil. Zulässig sind
    `TECHNICALLY_READY_FOR_LC4` beziehungsweise
    `TECHNICALLY_READY_FOR_LC5_CONFIGURATION`; ohne sämtliche reale External-
    und Approval-Evidence bleibt die Aktivierung
    `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`. `GO_LIVE_APPROVED` darf kein
    lokaler Contractlauf begründen.
13. für `AC-33-05` das vollständige Notification-Delivery-/Recipient-Hash-
    Key-Version-Inventar, getrennte Resend-API-/Webhook-Secret-Versionen,
    gelaufene 23-h-/31-d-/exakt-400×24-h-Grenztests, minutenbasierte
    providerunabhängige Retention, Activation-TX-Lock, append-only/monotone
    Inbox-/Suppression-Evidence sowie alle network/5xx/408/malformed-2xx/
    concurrent-idempotency-Pfade bis bounded Same-Key-Retry→`PAUSED`/manueller
    Reconciliation. Es dürfen nur tatsächlich ausgeführte Testpfade mit
    exaktem Befehl, Exit, Zählung und Artefakt als Resultat eingetragen werden.

## Checkbox-Regel

Zuerst wird der Detailplan anhand eines verlinkten, erfolgreichen Records
aktualisiert. Erst wenn sämtliche Definition-of-Done-Punkte der Detailphase
belegt sind, darf danach die zugehörige Phase in `00-PLAN.md` auf `[x]` wechseln.
Ein fehlgeschlagener oder nur lokal vermuteter Check bleibt `[ ]` und wird im
Record als Limitation benannt.
