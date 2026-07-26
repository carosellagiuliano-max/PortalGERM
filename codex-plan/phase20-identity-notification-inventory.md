# Phase 20 — versiegeltes Identity-/Notification-Inventar

> **Stand:** Phase-20-Abschlussbaum, 26. Juli 2026
> **Aktivierung:** Identity-/Outbox-Produzenten standardmässig `DISABLED`,
> Dispatcher `PAUSED`, realer Adapter höchstens isolierte `SANDBOX`.

Dieses Inventar ist die versiegelte Grundlage für
[`20-identity-email-notifications.md`](./20-identity-email-notifications.md).
Es trennt fachliche Outbox-Produzenten, weiterhin explizite Mockpfade und
spätere Phase-23-Aktivierung. Ein direkter Altpfad darf niemals den
`resend_sandbox`-Adapter erreichen: Der Legacy-Composition-Root bricht dort
mit `LEGACY_EMAIL_PATH_DISABLED` ab; es gibt kein Real→Mock-Fallback.

## 1. Identitäts- und Action-Matrix

| Zustand | Erlaubt | Fail-closed gesperrt |
| --- | --- | --- |
| `LOW_ASSURANCE` | Logout, Verify, Resend, begrenzte Security-/Supporthilfe und expliziter Onboarding-Draft | Bewerbung, Saved Jobs, Radar-Writes, Company-/Job-Publish, Billing, Team-/Rollenwrite, Privacy-Vollzug, Login-E-Mail-Change und optionale Notification-Präferenz |
| `LEGACY_ASSURANCE` | Login und Weg zur Reverification; keine stille Migration zu `VERIFIED_EMAIL` | dieselben vollwertigen Domainwrites wie bei `LOW_ASSURANCE`, sobald Enforcement aktiv ist |
| `VERIFIED_EMAIL` + `emailVerifiedAt` | reguläre rollen- und tenantgebundene Aktionen | alles, was die vorhandene Rollen-/Tenant-/Capability-Policy weiterhin verbietet |

Die Policy steht in `lib/auth/email-verification-policy.ts`; Page-Guards,
Candidate-Direktaktionen und der zentrale Employer-Context setzen sie
serverseitig durch. E-Mail-Verifikation ist weder MFA noch alleinige
Autorisierung. Phase 25 ergänzt frische Step-up-Evidence.

## 2. Fachliche Outbox-Produzenten

| Domaincommit | Template / Purpose | Atomarer Vertrag |
| --- | --- | --- |
| Candidate-/Employer-Registrierung | `identity_verification` / `IDENTITY_VERIFICATION` | User, Low-Assurance, Challenge und deduplizierte Outbox in einer Transaktion |
| Verification-Resend | `identity_verification` / `IDENTITY_VERIFICATION` | bisheriger Challenge wird superseded; genau ein aktueller Challenge plus Outbox |
| Login-E-Mail-Change | `login_email_change_verification`, danach `login_email_changed_notice` | Pending-Ziel bleibt bis Consume nicht autoritativ; Epochwechsel, Sessionrevocation, Evidence/Audit und Altadress-Notice atomar |
| Password Reset | `password_reset_mock` / `PASSWORD_RESET` | gehashter Token und Outbox atomar; Bearer wird erst beim Dispatch deterministisch rehydriert |
| Company Invitation | `company_invitation` / `COMPANY_INVITATION` | Invitation und verschlüsselter externer Empfänger atomar; Bearer wird erst beim Dispatch rehydriert |
| Bewerbung eingereicht | `application_submitted` / `APPLICATION_SUBMITTED` | Application-Commit und Candidate-Pflichtnachricht atomar |
| Bewerbungsstatus geändert | `application_status_changed` / `APPLICATION_STATUS_CHANGED` | Statusevent und Candidate-Pflichtnachricht atomar |
| Employer-Nachricht | `employer_message_received` / `EMPLOYER_MESSAGE` | Message-Commit und Candidate-Pflichtnachricht atomar |

Die Outbox akzeptiert nur geschlossene Template-/Purpose-Zuordnungen,
Payload-Schemaversionen und deduplizierte Schlüssel. Payloads über 32 KiB,
URLs, bearer-/secret-förmige Werte, freie Messages, CVs und Ciphertexte werden
vor jedem Write abgewiesen. Externe Adressen liegen nur envelope-verschlüsselt
mit Key-Version vor.

## 3. Geschlossene Purpose-/Preference-Taxonomie

- Veränderbar und optional: `JOB_ALERT`, `COMMERCIAL_OPTIONAL`.
- Alle Identity-, Invitation-, Application-, Employer-Message-, Privacy-,
  Billing-, Subscription-, Usage-, Moderation-, Abuse- und
  Company-Verification-Zwecke sind `MANDATORY`.
- Unbekanntes Template oder ein Purpose ohne eindeutige Klassifikation ist
  fail-closed.
- Optionale Zustellung benötigt gleichzeitig aktuelles Opt-in und
  `OPTIONAL_EMAIL=true`; der Dispatcher prüft die Präferenz vor Send erneut.
- Pflichtkommunikation wird durch Marketing-/Job-Alert-Opt-out nie
  unterdrückt.

Die vollständige, compile-time geschlossene Zuordnung steht in
`lib/notifications/purpose-policy.ts`.

## 4. Legacy-/Mock-Callsites

Bestehende Job-Alert-, Lead-, Abuse-, Moderations-, Privacy-, Billing-,
Subscription-, Boost-, Talent-Radar- und weitere Phase-01–18-Mailpfade bleiben
für LC1 als deterministische `MockEmailProvider`-Verträge erhalten. Sie sind
keine reale Zustellung:

- `EMAIL_PROVIDER_MODE=resend_sandbox` deaktiviert den gemeinsamen
  Legacy-Root serverseitig;
- direkt instanziierte Mockprovider besitzen keinen realen Netzwerkadapter;
- optionale externe Kommunikation bleibt mit `OPTIONAL_EMAIL=false`
  deaktiviert;
- UI und Admin-Systemstatus weisen auf `PAUSED`/Mock/Sandbox hin.

Phase 23 darf diese Pfade erst nach atomarem Produzentenumbau, Worker-/Pager-,
Retention- und Provider-Aktivierungsledger in autonome Zustellung übernehmen.

## 5. Provider-, Dispatcher- und Replay-Grenze

| Schalter | Phase-20-Zulässigkeit |
| --- | --- |
| `EMAIL_PROVIDER_MODE=disabled` | Standard; kein Send |
| `EMAIL_PROVIDER_MODE=local_mock` | nur Local/Test, kontrollierter Vergleich |
| `EMAIL_PROVIDER_MODE=resend_sandbox` | nur isolierte Sandbox und ausschliesslich `@resend.dev`; vollständige Konfiguration erforderlich |
| `NOTIFICATION_DISPATCH=paused` | Standard/Kill Switch; Outbox bleibt erhalten |
| `NOTIFICATION_DISPATCH=command` | bounded Batch 1–100, 60-s-Lease, Heartbeat ≤20 s, harter 10-s-Providerdeadline |
| `DELIVERY_REPLAY=true` | nur Local + `local_mock`, Admin-Capability und ausdrückliche Sandbox-Bestätigung; Production bleibt gesperrt |

Autonomes Scheduling, Production-Replay, Pager/SLO und LIVE-Aktivierung bleiben
ausdrücklich Phase 23 beziehungsweise Phase 25.
