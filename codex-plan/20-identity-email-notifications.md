# Phase 20 — Identität, E-Mail und zuverlässige Benachrichtigungen

> **Planstatus:** ABGESCHLOSSEN
> **Technikstatus:** TECHNISCH ABGESCHLOSSEN auf Candidate
> `59089009f54312a4c10989b7efde2d5fda9a2b8d`
> **Quality-Gate:** BESTANDEN
> **Aktivierung:** `SANDBOX` technisch vorhanden; Standard
> `DISABLED`/`PAUSED`, `LIVE` weiterhin `DISABLED`
>
> Verification, E-Mail-Change, Outbox, bounded Command-Dispatcher,
> Preferences und der fail-closed Resend-Sandboxadapter sind durch den
> [Phase-20-Evidence-Record](./evidence/2026-07-26-phase-20.md) belegt.
> Autonome Ausführung, reale Vendor-/DNS-/DPA-Evidence, Production-Replay,
> MFA/Step-up und jede LIVE-Freigabe bleiben bei Phase 23/25 oder ihrem
> externen Gate offen.

## 1. Status in vier Dimensionen

Die vier Statuswerte werden getrennt geführt. Ein implementierter
Sandbox-Adapter darf den Technikstatus auf `TECHNISCH ABGESCHLOSSEN` und das
Quality-Gate nach vollständigem G3 auf `BESTANDEN` bringen, ohne die
Aktivierung über `SANDBOX` hinauszuheben. `ALLOWLIST` oder `LIVE` benötigen
zusätzlich Provider-, DNS-, Legal-, Security-, Ops- und Cohort-Freigaben.

## 2. Ziel und messbarer Business-/Nutzerwert

Neue Candidate-, Employer- und Invitation-Konten erreichen über einen
single-use Verifikationsweg zuverlässig eine bestätigte E-Mail-Identität.
Jeder freigegebene Domainwrite erzeugt seine Pflichtbenachrichtigung atomar,
optionale Kommunikation respektiert aktuelle Präferenzen und die bestehende
Privacy-Challenge wird über den regulären Registrierungsweg erreichbar.

Messbarer Zielzustand:

- 100 % der erfolgreichen, zustellungspflichtigen Domaincommits besitzen
  genau einen deduplizierten Outbox-Datensatz;
- 0 Vollfreigaben für unverifizierte Konten und 0 Token-Replays;
- 0 dauerhaft verlorene fachliche Benachrichtigungen bei simuliertem
  Prozess-/Providerfehler;
- Pflichtkommunikation wird in 100 % der Preference-Testfälle nicht durch ein
  Marketing-Opt-out unterdrückt;
- Registration → Verify → Privacy Challenge besteht für Candidate und die
  Identity-Basis besteht für Employer und Einladungen.

## 3. Umgesetzter Repositoryzustand

- Zwei additive Migrationen führen explizite Identity-Assurance,
  single-use Verification Challenges, pending Login-E-Mail-Wechsel,
  Security-Evidence/-Events sowie Outbox, Attempts, Suppressions und
  versionierte Preferences ein. LIVE-Bestandsnutzer werden nie still als
  `VERIFIED_EMAIL` klassifiziert.
- Candidate-, Employer- und Invitation-Flows erzeugen Low-Assurance,
  Challenge und Pflicht-Outbox atomar. Verify/Resend/Consume sind
  enumeration-safe, rate-limited, supersedable und race-getestet.
- Der Login-E-Mail-Wechsel hält die alte Adresse bis zum Consume autoritativ,
  wechselt die Address Epoch atomar, widerruft Fremdsessions und erzeugt die
  Pflichtnotice an die alte Adresse.
- Der geschlossene Purpose-/Template-Vertrag, 32-KiB-Payloadlimit,
  verschlüsseltes externes Delivery-Material und stabile Provider-Dedupe-Keys
  schützen die dauerhafte Zustellung. Reale Legacy-Mailpfade werden im
  `resend_sandbox`-Modus fail-closed deaktiviert.
- Der Command-Dispatcher besitzt Batchlimit, Lease/Heartbeat, harte
  Providerdeadline, Retry/Backoff, DLQ, Suppression, Crash-Recovery und
  auditiertes lokales Replay. Autonomes Scheduling bleibt Phase 23.
- `/verify-email`, `/candidate/notifications`,
  `/employer/notifications` und die redigierte `/admin/system`-Sicht sind im
  Routeinventar und in der Desktop-/360-px-Browser-Matrix enthalten.
- Das versiegelte Callsite-/Action-/Purpose-Inventar steht in
  [`phase20-identity-notification-inventory.md`](./phase20-identity-notification-inventory.md).

## 4. Findings und Requirements

| Finding / Requirement | Verantwortung dieser Phase | Launchpriorität |
| --- | --- | --- |
| `STH-001`, `REQ-ID-005` | Verification, Reverification, Login-E-Mail-Änderung und Recovery-Vertrag | LC1 P2; LC2–LC6 P0 |
| `STH-002`, `REQ-ID-005` | regulärer Verify-Weg macht die bestehende Privacy-Challenge erreichbar | LC1 P2; LC2–LC6 P0 |
| `STH-013`, `REQ-NOT-001` | atomare fachliche Outbox, Attempts, Suppression, DLQ und bounded Dispatcher | LC1 P3; LC2–LC6 P0 |
| `STH-026`, `REQ-NOT-001` | versionierte Pflicht-/Optional-/Kanal-/Frequenz-Präferenzen | LC1 P3; LC2 P1; LC3–LC6 P0 |
| E-Mail-Anteil `STH-004` | realer Adaptervertrag und Sandbox; autonome Ausführung bleibt Phase 23 | je aktiviertem Provider LC2–LC6 P0 |
| Beitrag `STH-030`, `REQ-ID-004` | Assurance-Grundmodell und sicherer E-Mail-Change; risikobasierte MFA-/Step-up-Policy bleibt Phase 25 | LC2–LC6 P0 für aktivierte Hochrisikoaktion |
| Beitrag `STH-031`, `REQ-TRUST-001` | minimale Auth-/ATO-Signale und Session-/Credential-Revocation-Hooks; Risk Decision/Case bleibt Phase 25 | LC2–LC6 P0 |
| `REQ-QA-003` | dieser 28-Punkte- und AC→Test-Vertrag | alle Launchklassen P0 |

Phase 20 schliesst `STH-030` oder `STH-031` ausdrücklich nicht allein.

## 5. In Scope

- Candidate-, Employer- und Invitation-Verifikation samt Resend,
  Supersession, Ablauf, generischen Antworten und Sessionrotation;
- Login-E-Mail-Änderung: neue Adresse bleibt pending, alte Login-Adresse bleibt
  bis erfolgreicher Bestätigung autoritativ, danach atomarer Address-Epoch-
  Wechsel, Benachrichtigung der alten Adresse und Sessionrevocation;
- definierter Low-Assurance-Zustand für unverifizierte Sessions;
- atomare, typisierte Notification-Outbox für alle produktiven Mail-Callsites;
- langlebige Attempts, Provider-Dedupe, Timeout, Retry/Backoff, Bounce,
  Suppression, DLQ und auditiertes Replay;
- bounded, idempotent per Command ausführbarer Dispatcher; autonomes Hosting
  und Scheduling gehören Phase 23;
- reales Providerport, Sandbox-Contract und fail-closed Composition Root;
- zentrale Notification Preferences mit Pflicht-/Optional-Taxonomie;
- Auth-Security-Events für Stuffing-, Resend-, Verify-, Recovery- und
  E-Mail-Change-Anomalien als Phase-25-kompatible ATO-Grundlage;
- Privacy-Journey Registration → Verification → bestehende Challenge.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- MFA, WebAuthn/TOTP, risikobasierte Decision Engine, Recovery-Support und
  allgemeine Hochrisiko-Step-ups: Phase 25;
- autonome Workerplattform, Pager und Production Scheduling: Phase 23;
- SMS, Push, Marketing-Automation, Referral und Newsletter;
- Multi-Persona-Umbau: Phase 27;
- freie Ops-Payloadsicht oder Production-Replay vor Phase-25-Grants/Step-up;
- automatisches Real→Mock-Fallback.

Bis die jeweilige Abhängigkeit grün ist, bleiben optionale LIVE-Kommunikation,
Production-Replay und nicht abgesicherte E-Mail-Change-Aktionen serverseitig
`DISABLED`; Navigation und API dürfen keinen funktionsfähigen Eindruck
erzeugen.

## 7. Benutzerrollen und organisatorische Owner

| Rolle | Erlaubter Zweck | Owner |
| --- | --- | --- |
| Public/Registrant | Verify/Resend generisch starten und Token konsumieren | Identity Engineering |
| Candidate | eigene Adresse/Präferenzen, Privacy-Challenge nach Verify | Candidate + Privacy |
| Employer/Recruiter/Invitee | eigene Identität; Company-Präferenzen nur mit bestehender Membership-Berechtigung | Employer Engineering |
| Support/Ops | redigierter Zustand; kein Token/Payloadinhalt | Ops + Support |
| Security | Rate-/ATO-Signale, Revocation und Incident-Eskalation | Security |
| Privacy/Legal/Finance | Klassifikation verpflichtender Nachrichten freigeben | jeweiliger Fachowner |

Produktowner ist Identity/Notifications; technische Zustellung gehört gemeinsam
Identity und Ops, rechtliche Purpose-Klassifikation Legal/Privacy.

## 8. Portale, Routen, Services, Provider und Worker

Bestehende Einstiege sind `/register/candidate`, `/register/employer`,
Invitation-/Login-/Reset-Flows sowie
`/candidate/privacy/requests/[id]/verify`. Geplantes, noch nicht im
`route-inventory.json` geführtes Delta:

- `/verify-email` und `/verify-email/resend`;
- konsolidierte Security Settings für Login-E-Mail und Recovery;
- `/candidate/notifications` und `/employer/notifications` oder eine
  rollenkorrekt konsolidierte Preference-Route;
- capability-geschützte, redigierte Delivery-Ansicht unter `/admin/system`.

Neue Services: Verification Service, Email-Change Service, Notification
Classifier, Outbox Repository, bounded Dispatcher und Provider Adapter.
Phase 20 liefert Handler/Command und Sandbox-Smoke; Phase 23 registriert ihn
später als autonomen Worker.

## 9. Datenmodelle, Constraints, Indizes und Klassifikation

Die ADR-031-konformen Namen werden vor Migration finalisiert. Mindestens:

- `EmailVerificationChallenge`: `userId`, `purpose`, `addressEpoch`,
  `targetNormalizedHash`, `tokenHash`, `expiresAt`, `usedAt`,
  `supersededAt`, `createdAt`; partiell eindeutig höchstens ein aktueller
  Challenge je `(userId,purpose,addressEpoch)`;
- pending Login-E-Mail-Change mit normalisiertem Ziel, Epoch, Initiator,
  Challenge und Konfliktconstraint gegen bestehende `emailNormalized`;
- `AuthAssuranceEvidence`/gleichwertige zweck-, actor-, session-,
  action- und optional tenantgebundene Evidence ohne Faktor-Secret;
- `NotificationOutbox`: fachlicher Dedupe-Key, Purpose, Template-/Payload-
  Schema-Version, Empfängerreferenz, `availableAt`, Status und minimale
  verschlüsselte Delivery-Material-Referenz;
- `NotificationDeliveryAttempt`: append-only Attempt, Lease Owner/Expiry,
  Providerklasse, redigierter Outcome, nächste Fälligkeit;
- `NotificationSuppression` und versionierte Preference-/Consent-Events;
- minimierte, retention-bound `AuthSecurityEvent`-Signale.

Tokens bleiben nur gehasht. Falls ein identischer Einmallink nach Restart
erneut zugestellt werden muss, ist ausschliesslich envelope-verschlüsseltes,
kurzlebiges Delivery-Material mit Key-Version zulässig. `EmailLog` wird
kompatibel als Projektion migriert, nicht still umgedeutet.

## 10. Expand–Migrate–Contract und Datenprüfung

1. Additive Tabellen/Enums/Indizes auf leerer und Phase-19-Bestandsdatenbank.
2. TEST/DEMO-Fixtures erhalten explizite Verifikationszustände; keine
   fiktive LIVE-Verifikation.
3. Bestehende LIVE-Nutzer werden nach schriftlicher Übergangspolicy als
   `LEGACY_ASSURANCE` klassifiziert, nie still massenverifiziert.
4. Alte Mail-Callsites dual-observe: Domainwrite erzeugt Outbox; alter
   direkte Send bleibt in Production aus und wird nur in kontrollierter
   Vergleichsumgebung beobachtet.
5. Backfill ist batchweise, restartbar und dedupliziert; Null-/Orphan-/
   Duplicate-/Tenant-/Purpose-Counts werden vor Cutover verglichen.
6. Read-Cutover und Pflichtklassifikation vor Provideraktivierung; Contract
   alter Pfade erst nach Replay- und Golden-Evidence.

Migrationstests decken leere DB, Bestand, abgebrochenen Backfill,
Wiederholung, Parallelwriter und Roll-forward nach Contract ab.

## 11. Serverlogik, Queue, Lease, Retry und Providervertrag

- Registrierung, Einladung oder anderer fachlicher Write und Outbox-Insert
  liegen in derselben PostgreSQL-Transaktion. Rollback erzeugt weder User-
  Vollfreigabe noch Message.
- Verify/Resend sind enumeration-safe, rate-limited, single-use,
  zeitgebunden und supersedable. Concurrency bewirkt genau eine Transition.
- E-Mail-Change verlangt mindestens frische Credential-Bestätigung; ein
  Phase-25-`StepUpGrant` ist die spätere strengere Autorität. Vor Verify wird
  die Login-Adresse nicht gewechselt. Beim Commit werden andere Sessions
  widerrufen und die aktuelle rotiert.
- Dispatcher claimt bounded Batches mit Lease; Crash vor/nach Providerannahme
  führt durch stabilen Provider-Dedupe-Key zu at-least-once Delivery, aber
  höchstens einer fachlichen Wirkung. Exactly-once Netzwerkzustellung wird
  nicht behauptet.
- Retryklassen unterscheiden Timeout/429/5xx von permanentem 4xx,
  Hard Bounce und Suppression. Max Attempts führt in DLQ, nie in Endlosschleife.
- Optionale Nachricht wird bei Enqueue und erneut vor Send gegen die aktuelle
  Preference geprüft. Pflichtkommunikation kann nicht als Marketing
  umklassifiziert werden.
- Auth-Security-Events sind typisiert/minimiert; Phase 20 blockiert bekannte
  Abusegrenzen, Phase 25 entscheidet später über risikobasierte Holds/Cases.

## 12. UI-Zustandsvertrag

Verification, E-Mail-Change, Preferences und Delivery-Cockpit besitzen
Loading, Empty, Locked, Pending, Provider-Degraded, Rate-limited, Error,
Retry, Conflict, Expired, Superseded, Cancelled, Suppressed, Bounced, DLQ und
Success. Generische öffentliche Antworten verraten nicht, ob eine Adresse
existiert. Ein unverifizierter Nutzer sieht konkrete erlaubte nächste Schritte
statt einer Redirectschleife.

## 13. 360 px, Touch, Keyboard, Screenreader und Accessibility

- Verify-, Resend-, Change- und Preference-Flows funktionieren bei 360×800
  ohne horizontales Clipping;
- Statusänderungen nutzen `aria-live`, Fokus landet nach Submit am
  Ergebnis-/Fehlerkopf und Rate-/Expiry-Texte sind programmatisch zugeordnet;
- Pflichtzwecke sind nicht als deaktivierbare Checkbox missverständlich;
- Keyboard-only deckt Dialog, Cancel, Retry und Konfliktauflösung;
- Axe `critical` und `serious` sind 0 oder eine befristete, ownergebundene
  Ausnahme blockiert die Aktivierung.

## 14. Authentisierung, Step-up, Autorisierung und Tenantgrenzen

Eine versionierte Action-Matrix definiert je Rolle, Verifikations- und
Assurancezustand die erlaubten Reads/Writes. Unverifiziert zulässig sind nur
Logout, Verify/Resend, begrenzte Security-/Supporthilfe und explizit
freigegebene Onboarding-Schritte. Bewerbung, Company-Publish, Billing, Radar,
Privacy-Vollzug und Rollenänderung bleiben fail-closed.

E-Mail-Change-Evidence ist actor-, session-, purpose- und actiongebunden;
stale, replay, cross-purpose und cross-user ergeben 0 Wirkung.
Company-Präferenzen beachten Membership/Tenant. Ops-Replay verlangt
Capability plus Phase-25-Step-up; ausserhalb isolierter Sandbox bleibt die
Action bis dahin gesperrt. Verifizierte E-Mail ist weder MFA noch alleinige
Autorisierung.

## 15. Datenschutz, Zweck, Retention, Export, Löschung und Audit

Outboxpayloads sind allowlisted, versioniert und enthalten keine Passwörter,
Klartexttokens, freien Domainobjekte, CVs, Messages oder Reveal-Ciphertexte.
Empfänger, Bounce und Security-Events besitzen getrennte, von Phase 22
freizugebende Retention. Preference- und Pflichtklassifikationsänderungen sind
append-only auditiert. Phase 22 inventarisiert Export/Erasure/Legal Hold für
alle neuen Tabellen; bis dahin gilt ein konservativer kurzer Retention-
Vertrag und optionales LIVE-Messaging bleibt aus.

## 16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien

- Credential Stuffing, Resend-/Verify-Flood, Address-Enumeration,
  Token-Bruteforce und paralleler Consume;
- gestohlene Session versucht Login-E-Mail-Change, Recovery oder Preference-
  Manipulation;
- alter Token nach Resend/Adresswechsel, cross-purpose Token und
  Provider-Callback-Replay;
- Queue-Flood, poison payload, manipulierter Template-/Purpose-Key und
  Support-Replay ohne Capability;
- kompromittierte verifizierte Firma erzeugt ungewöhnliches Mailvolumen.

Phase 20 liefert Rate Limits, Audit, Sessionrevocation, Signale und
fail-closed Hooks. Gesamt-Fraud-Case, False-positive/Appeal und
firmenübergreifende Risk Decision bleiben `STH-031`/Phase 25.

## 17. Externe und organisatorische Voraussetzungen

E-Mail-Vendor und Sandbox, AVV/DPA, Datenregion/Subprozessoren,
Absenderdomain, SPF/DKIM/DMARC, Secret-/KMS-Verwaltung, Bounce-Domain,
Template- und Purpose-Freigabe, Security Owner, Zustell-/Reputationsowner und
Incidentkontakt. Jedes Gate besitzt im Evidence-Record Owner, Datum,
Dokumentversion und Entscheidung. Ohne diese Voraussetzungen bleibt
Aktivierung `DISABLED` oder höchstens `SANDBOX`.

## 18. Harte Abhängigkeiten

- grüne Phase-19-Evidence auf dem tatsächlichen Implementierungscommit;
- ADR-031 und Migration-/Kryptovertrag;
- Phase 22 für finale Legal-/Retention-/Consent-Freigabe;
- Phase 23 für autonome Production-Ausführung, Monitoring und Pager;
- Phase 25 für risikobasierte Step-up-, Admin-Replay- und Fraud-Entscheidung.

Phase 21 und 22 dürfen fachlich parallel vorbereitet werden; gemeinsame
Migrationen werden nacheinander integriert. Phase 20 darf einen bounded
Dispatcher testen, aber keinen unbeaufsichtigten Productionbetrieb behaupten.

## 19. Geordnete Implementierungsschritte

1. Callsite-/Template-/Purpose-/Preference-/Auth-Action-Inventar versiegeln.
2. ADR-031, Low-Assurance- und E-Mail-Change-Policy freigeben.
3. Additive Identity-, Outbox-, Attempt-, Suppression- und Preference-
   Migration samt Upgrade-/Backfill-Test.
4. Verify/Resend/Consume und E-Mail-Change ohne Provider implementieren.
5. Action-Matrix, Sessionrotation/-revocation, ATO-Events und Privacy-Brücke.
6. Alle Mailproduzenten atomar auf typisierte Outbox umstellen oder im
   Realmodus serverseitig deaktivieren.
7. Bounded Dispatcher, Lease, Retry, Dedupe, DLQ und Replay implementieren.
8. Mock- und realen Adaptervertrag trennen; Sandbox-Failure-Suite ausführen.
9. Preference Center und alle UX-/A11y-Zustände implementieren.
10. Migration, Owning-Suites, Provider-Smoke, vollständiges G3 und Evidence.
11. Erst danach Cohort-Allowlist; Production Scheduling bleibt bis Phase 23
    aus.

## 20. Feature-/Provider-/Cohort-Flags und Aktivierungsreihenfolge

Serverseitige, auditierte Flags werden getrennt geführt:
`IDENTITY_VERIFICATION_ENFORCEMENT`, `LOGIN_EMAIL_CHANGE`,
`NOTIFICATION_OUTBOX_PRODUCERS`, `EMAIL_PROVIDER_MODE`,
`NOTIFICATION_DISPATCH`, `OPTIONAL_EMAIL`, `DELIVERY_REPLAY` und Cohort.

Reihenfolge: Schema → Producers/dispatch paused → Low-Assurance UI → Sandbox
Provider → interne Cohort → Design-Partner-Allowlist → nach Phase 22/23/25
gegebenenfalls LIVE. Kill Switch setzt Dispatch `PAUSED`, bewahrt Outbox und
zeigt Degraded-State. Er darf weder auf Mock umschalten noch verifizierte
Identität zurücksetzen.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle als „anzulegen“ bezeichneten Dateien sind geplante Deliverables und
dürfen erst nach Existenz und Exit Code `0` als Evidence gelten.

| Criterion | Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `20-AC-01` | `STH-001`, `REQ-ID-005` | unverifizierte Vollfreigabe, LC2+ P0 | Unit + PostgreSQL | Candidate-/Employer-/Invite-Registrierung erzeugt Low-Assurance + Verify-Outbox atomar | Commit erzeugt User, Challenge und genau eine Outboxmessage | Rollback, Duplicate Submit oder unbekannte Rolle erzeugt keine Vollsession/Doppelmessage | Public/Invitee | Auth/DB/Outbox | je Rolle, gleiche E-Mail und idempotency keys | jsdom + isoliertes PostgreSQL 16 | `npx vitest run --config vitest.config.ts tests/unit/auth/email-verification-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/auth/email-verification-postgres.test.ts` | 3/3 Rollen low-assurance; je Commit 1 Message; Rollback 0; Duplicate fachlich 1 | Vitest JSON/SQL Count | Identity + QA | PASS |
| `20-AC-02` | `STH-001`, `REQ-ID-005` | Tokenübernahme/Replay, P0 | Unit + PostgreSQL Security | TTL, Resend, Supersession und konkurrierender Consume | aktueller Token bestätigt einmal und rotiert Session | expired, used, alter Resend-Token, cross-user/purpose und 20 parallele Consumes wirken 0/1 | Public/Registrant | Verify Service/PostgreSQL | logische Uhr, zwei Nutzer, 20 konkurrierende Clients | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.config.ts tests/unit/auth/email-verification-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/auth/email-verification-races-postgres.test.ts` | exakt 1 `usedAt`/Verify-Transition; 19 Konflikte; kein Rohtoken in DB/Log | Race-Manifest, Redaction-Scan | Identity + Security | PASS |
| `20-AC-03` | `REQ-ID-005`, Beitrag `REQ-ID-004`/`STH-030` | ATO/Lockout durch E-Mail-Change, P0 | Unit + PostgreSQL + E2E | pending neue Adresse → Verify → atomarer Epochwechsel | neue Adresse wird Login, alte erhält Pflichtnotice, andere Sessions revoked | Passwort falsch, Ziel belegt, stale/replay/cross-session/cross-user bewirken 0 Änderung | Candidate/Employer | Security Settings/Auth | zwei Accounts, aktive Sessions, kollidierende Adresse | PostgreSQL + Production Browser | `npx vitest run --config vitest.config.ts tests/unit/auth/email-change-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/auth/email-change-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase20-identity-email.spec.ts --project=chromium-journeys` | vor Verify alte Adresse autoritativ; danach genau 1 Epochwechsel; alle Fremdsessions revoked; 1 Altadress-Notice | DB-Diff, Playwright-Trace, Audit | Identity + Security | PASS |
| `20-AC-04` | `STH-013`, `REQ-NOT-001` | verlorene/doppelte Kernmail, P0 | PostgreSQL + Failure Injection | Crash vor/nach Claim und Providerannahme, Retry, Lease-Takeover, DLQ/Replay | Restart liefert über stabilen Dedupe-Key ohne fachliche Doppelwirkung | 429/5xx/timeout retry; permanent 4xx/poison bounded DLQ; unberechtigtes Replay 0 | System/Ops | Outbox/Dispatcher/Provider | 100 Messages, Fake Clock, zwei Dispatcher, Failure Provider | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/notifications/outbox-delivery-postgres.test.ts` | 0 verlorene Outboxrows; je Dedupe-Key 1 fachlicher Delivery-Receipt; Lease-Takeover nach Ablauf; spätestens Max Attempt DLQ | Attempt-/Lease-Timeline | Notifications + Ops | PASS |
| `20-AC-05` | `STH-026`, `REQ-NOT-001` | Pflichtmail unterdrückt/Marketing unerlaubt, P0 | Unit + PostgreSQL | Purpose×Channel×Role×Consent inklusive Preference-Änderung während Queueing | optionales Opt-in sendet; Pflichtzweck sendet unabhängig vom Marketingopt-out | optionales Opt-out vor Dispatch suppressiert; unbekannter Purpose fail-closed | Candidate/Employer/System | Preferences/Outbox | vollständige geschlossene Purpose-Matrix | jsdom + PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/notifications/notification-preference-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/notifications/preferences-outbox-postgres.test.ts` | 100 % Matrixfälle erwartungsgleich; unbekannt 0 Sends; Pflichtfälle nie Marketingklassifikation | Matrixreport, Audit Events | Notifications + Legal/Privacy | PASS |
| `20-AC-06` | `STH-002`, `REQ-ID-005`, `REQ-PRIV-004` | unerreichbares Betroffenenrecht, P0 | PostgreSQL + E2E | Registration → Verify → Privacy Request → bestehende Challenge | eigener Candidate erreicht und besteht Challenge | unverifiziert, fremder User, abgelaufene Challenge und Direkt-Action bleiben denied | Candidate | Candidate Privacy/Auth | neuer Candidate + Foreign Canary | PostgreSQL + Production Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/privacy/privacy-verified-identity-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase20-identity-email.spec.ts --project=chromium-journeys` | positiver Flow 1 verifizierter Case; vier Negativfälle 0 fremde Reads/Writes; sichere 404 | Case-/Audit-Diff, Trace | Identity + Privacy | PASS |
| `20-AC-07` | Beitrag `STH-031`, `REQ-TRUST-001` | Credential Stuffing/Enumeration/Insider, P0 LC2+ | Security + PostgreSQL | Login-, Verify-, Resend-, Recovery- und Change-Rate/Signal-Matrix | legitimer begrenzter Flow bleibt nutzbar und emittiert minimales Audit | verteilte/burst Wiederholung, unbekannte Adresse, Support-Direct-Replay blockiert ohne Informationsleck | Public/User/Support | Auth/Rate Store/Audit | bekannte/unbekannte Adresse, IP-/Actor-Buckets, Capability-Denial | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/auth/identity-abuse-postgres.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/auth/rate-limit-postgres.test.ts` | definierte Bucketgrenzen exakt; gleiche öffentliche Antwort; 0 Secret/Adresse im Audit; Denial vor Payloadread | Rate-/Audit-Manifest | Security | PASS |
| `20-AC-08` | E-Mail-Anteil `STH-004`, `REQ-NOT-001` | falscher Provider-/LIVE-Modus, P0 | Provider Contract + Sandbox | deliver, duplicate idempotency, bounce, suppression, 429, 5xx, timeout, bad secret | freigegebene Sandbox quittiert korrelierbaren redigierten Receipt | ungültige Konfiguration bootet fail-closed; kein Real→Mock; Failure bleibt durable | System/Ops | Provider Adapter/Env | Vendor-Sandbox-Adressen, keine realen Personen | isolierte Sandbox mit Testdomain | `npx vitest run --config vitest.integration.config.ts tests/integration/providers/email/email-provider-contract.test.ts`; `npx tsx --conditions react-server scripts/phase20-email-provider-smoke.ts --mode=sandbox --scenario=deliver,duplicate,bounce,429,500,timeout,bad-config` | alle Contractfälle pass; Duplicate 1 Provider-Dedupewirkung; bad config Exit ≠0; 0 Secrets im Artefakt | Provider Receipt/Redaction Report | Notifications + Ops + Security | PASS |
| `20-AC-09` | `REQ-QA-002`, `REQ-QA-003` | unbedienbarer/irreführender Flow, P0/P1 | E2E + Mobile + A11y | Verify, Resend, Email Change, Preferences in allen Zuständen | Keyboard/Touch/Screenreader erreicht jede erlaubte Action | Locked/rate/expired/conflict/bounce erzeugt Fokus- und Klartextzustand, keine Enumeration | Public/Candidate/Employer | Browserportale | deterministische Mailbox/Sandboxfixtures | Production Build, Desktop 1440×900 und 360×800 | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase20-identity-email-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase20-identity-email-quality.spec.ts --project=chromium-mobile-360` | 0 horizontal clipping; 0 critical/serious Axe; sichtbarer Fokus; alle definierten States besucht | HTML-/Axe-/Screenshot-Report | UX + QA | PASS |
| `20-AC-10` | `REQ-QA-003`, ADR-031 | Lock/Orphan/gefälschte Legacy-Verifikation, P0 | Migration/PostgreSQL | leer, Phase-19-Bestand, unterbrochener Backfill, Wiederholung, Parallelwriter | additive Migration + deduplizierter Backfill | Partial run, Null-/Duplicate-/Tenantfehler blockiert Cutover | System/Data | Prisma/PostgreSQL | leere DB + realistische Legacyzustände | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase20-identity-outbox-migration-postgres.test.ts`; `npm run db:migrate`; `npm run db:migrate:status` | Exit 0; Wiederholung 0 Doppelrows; 0 Orphans; Legacy nie still VERIFIED; Lockbudget dokumentiert | Migration-/Countmanifest | Data + Identity | PASS |
| `20-AC-11` | `REQ-QA-001`, `REQ-QA-003` | Regression Auth/Tenant/Privacy/Mail, P0 | G3 Portal-Golden | neue Owning-Suites plus geschützte Altverträge | gesamtes Repository-Gate auf demselben Commit | `.skip`, Retry, anderer Commit oder flakiger Test blockiert | alle | Repository/alle Portale | deterministischer Seed | Clean Clone, PostgreSQL 16, Production Browser | nacheinander `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e:http`, `npm run test:e2e:browser`, `npm run test:e2e:hsts` | alle Exit `0`; Retry `0`; keine unerklärten Skips; gleicher Commit/Digest | G3-Testmanifest | QA | PASS |

## 22. Performance-, Query-, Queue-, Datei-, Latenz- und Lastgrenzen

- Verify/Resend-/Preference-DB-Command p95 ≤250 ms bei 50 parallelen
  Requests in der isolierten Referenzumgebung; Providerlatenz separat;
- Dispatcher-Batch maximal 100, Lease 60 s, Heartbeat spätestens alle 20 s;
  Werte werden per ADR konfigurierbar und per Fake Clock getestet;
- Outbox-Allowlist-Payload maximal 32 KiB; kein Domainobjekt als Blob;
- öffentliche Verify-/Resend-Rategrenzen liegen im PostgreSQL Rate Store und
  sind je Actor/IP/Purpose messbar;
- Sandbox-Ziel: 99 % der nicht absichtlich verzögerten Pflichtmessages
  innerhalb 120 s im Providerreceipt; dies ist noch kein Production-SLO;
- Backlog-, Bounce-, Suppression-, DLQ- und oldest-age-Metriken besitzen
  Warn-/Pause-Schwellen, deren Productionwerte Phase 23 freigibt.

## 23. Geschützte Phase-01–18-Invarianten und Owning-Regressionen

Mindestens erneut:

```powershell
npx vitest run --config vitest.config.ts tests/unit/auth tests/unit/providers/email tests/unit/security/rate-limit-audit.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/auth/auth-service-postgres.test.ts tests/integration/auth/rate-limit-postgres.test.ts tests/integration/employer/team-invitations-postgres.test.ts tests/integration/providers/email/mock-email-provider-postgres.test.ts tests/integration/privacy/privacy-case-service.test.ts tests/integration/candidate/job-alerts-postgres.test.ts tests/integration/employer/applications-postgres.test.ts
npx playwright test --config=playwright.config.ts tests/e2e/flows/phase17-journeys.spec.ts --project=chromium-journeys
```

Geschützt bleiben Password Reset, safe-next, Session-, Invite-, Candidate-/
Employer-Tenant-, Application-, Alert-, Privacy-Challenge-, Audit-/Redaction-
und explizite Mock-Copy-Verträge. Der Mock bleibt LC1-Testadapter, nicht
Productionfallback.

## 24. Rollback oder Roll-forward-only

Vor Read-Cutover sind additive Tabellen/Flags rückschaltbar. Nach bestätigtem
Address-Epoch-Wechsel, extern angenommener Mail oder Contract alter Pfade gilt
Roll-forward: Identität, Zustellreceipt und Audit werden nicht per DB-Rollback
erfunden oder gelöscht. Kill Switch pausiert Dispatch; Pending-Outbox bleibt
erhalten. Keykompromittierung rotiert/invalidiert Delivery-Material nach
Runbook und erzwingt neuen Challenge, statt Klartext wiederherzustellen.

## 25. Benötigte Evidence und Artefakte

`evidence/YYYY-MM-DD-phase-20.md` enthält Start-/Endcommit und Digest,
Migration-/Backfill-Counts, Action-/Purpose-Matrix, alle Befehle/Exitcodes,
Race-/Crash-/DLQ-Timeline, Provider-Contract-/Sandboxreceipts, DNS-/DPA-/
Secret-/Key-Versionstatus, Redaction-Scan, Desktop-/Mobile-/A11y-Berichte,
Privacy-E2E, aktivierte Flags, Kill-Switch-Probe, offene Phase-23/25-Gates und
den G3-Entscheid. Keine Adresse, Tokens, Providersecrets oder vollständigen
URLs gelangen in Evidence.

Der ausgeführte Record ist
[`evidence/2026-07-26-phase-20.md`](./evidence/2026-07-26-phase-20.md) und
referenziert den unveränderlichen Candidate
`59089009f54312a4c10989b7efde2d5fda9a2b8d`.

## 26. Definition of Done für Technik und Quality-Gate

Technikstatus darf erst `TECHNISCH ABGESCHLOSSEN` werden, wenn alle
Migrationen, Verification-/E-Mail-Change-Flows, atomaren Produzenten, bounded
Dispatcher, Preference- und Providerverträge implementiert sind. Das
Quality-Gate darf erst `BESTANDEN` werden, wenn `20-AC-01` bis `20-AC-11` auf
demselben Commit `PASS` sind, G3 grün ist und kein Pflichtfall `N/A`, Skip oder
Retry besitzt. Aktivierung bleibt separat und kann weiterhin `SANDBOX` oder
`BLOCKED BY EXTERNAL GATE` sein.

## 27. Gate für abhängige Folgephasen

Phase 21/22 dürfen ihre fachlichen Adapter parallel entwickeln, aber kein
Identity-/Outbox-abhängiger LIVE-Flow aktiviert werden, bevor Phase 20 G3
bestanden hat. Phase 23 übernimmt nur versionierte, bounded und idempotent
getestete Handler. Phase 25 muss die Phase-20-Assurance-Evidence übernehmen
und ihre stale/replay/cross-purpose-Invarianten erweitern, nicht ersetzen.

## 28. Ausdrücklich nicht bewiesene Aussagen und Referenzen

Diese Phase beweist noch keine autonome Productionzustellung, kein Provider-
SLO, keine Inboxplatzierung, keine MFA, keinen vollständigen Fraud-/ATO-Case,
keine Rechtsfreigabe optionaler Kommunikation und keine LIVE-Freigabe.
Verifizierte E-Mail beweist nicht die reale Person oder Firmenberechtigung.

Verbindlich ergänzend gelten
[`remediation-execution-contract.md`](./remediation-execution-contract.md),
ADR-031/034/036 in [`decisions.md`](./decisions.md),
[`requirements-matrix.md`](./requirements-matrix.md),
[`remediation-traceability.md`](./remediation-traceability.md) und
[`route-role-matrix.md`](./route-role-matrix.md).
