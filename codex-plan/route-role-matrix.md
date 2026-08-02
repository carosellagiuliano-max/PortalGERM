# Route- und Rollenmatrix

> **Stand:** Phase-33-Technikbaum, 129 Seiten, 21 Route Handler und zwei
> öffentliche Metadata-Endpunkte (`/robots.txt`, `/sitemap.xml`). Die
> maschinenlesbare Inventarbasis ist
> [`route-inventory.json`](./route-inventory.json); `npm run route:audit`
> vergleicht sie mit dem tatsächlichen `app/`-Baum. Jeder Route Handler besitzt
> zusätzlich eine exhaustive Policy in `scripts/route-handler-policy.ts`;
> unbekannte Handler fallen niemals auf `PUBLIC` zurück. Diese Matrix
> dokumentiert Rollen und fachliche Grenzen, ist aber allein kein
> Browser-/A11y-Beweis.

## Rollen- und Schutzbegriffe

| Begriff                              | Bedeutung                                                                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                               | ohne Session erreichbar; Public Read Models enthalten nur freigegebene Felder                                                                                                                                                                            |
| Authenticated                        | aktive Candidate-/Employer-/Recruiter-/Admin-Session                                                                                                                                                                                                     |
| Candidate                            | globale Rolle `CANDIDATE`; owner-scoped Candidate-Objekte                                                                                                                                                                                                |
| Employer / Recruiter                 | globale Rolle `EMPLOYER` oder `RECRUITER` plus bei Firmenobjekten eine aktuelle aktive Membership                                                                                                                                                        |
| Company Owner/Admin/Recruiter/Viewer | Firmenrolle; jede Query/Mutation prüft zusätzlich Company, Assignment, Entitlement und Status                                                                                                                                                            |
| Admin                                | aktive globale Rolle `ADMIN` öffnet nur das Portal; jeder Read/Use Case benötigt zusätzlich aktuell persistierte Capabilities                                                                                                                            |
| Public Operations                    | absichtlich minimale Health-Antwort ohne Secrets/Daten                                                                                                                                                                                                   |
| Local Ops Token                      | nur Local/CI, geheimes Bearer-Token; in Production 404                                                                                                                                                                                                   |
| Public Token                         | keine Session, aber ein begrenzter, nicht im Klartext persistierter Capability-Token                                                                                                                                                                     |
| Payment Provider Signature           | keine Userrolle; Raw Body, Providerkennung, Account, Environment und Signatur werden gemeinsam geprüft                                                                                                                                                   |
| Email Provider Signature             | keine Userrolle; `/api/webhooks/email/resend` akzeptiert ausschließlich einen aktivierten, versionsgebundenen Resend-Adapter sowie einen begrenzten Roh-Body mit gültiger Svix-Signatur; Replay/Out-of-order werden über die PII-freie Inbox verarbeitet |

Ein Layout- oder Navigationseintrag ist keine Autorisierungsgrenze. Fremde und
nicht existente Tenant-/Candidate-Ressourcen liefern dieselbe sichere 404;
rollenbezogene Seitenfehler ohne Objektbezug dürfen 403 liefern. Private
Layouts sind dynamisch, `noindex` und no-store. Mutationen besitzen kompakte
Pending-Zustände. Über den privaten Root-Segmenten liegt bewusst keine
`loading.tsx`-Streaming-Grenze: Tenant-/Owner-Guards müssen ihren echten
HTTP-404-Status setzen können, bevor Antwort-Header gesendet werden.
Root-Error und Root-404 bleiben generisch.

## Öffentliche und Auth-Seiten — 32

| Route(n)                                   | Eintritt      | Server-/Privacy-Grenze                                                                                                         |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                        | Public        | freigegebene Demo/LIVE-Provenienz, keine privaten Daten                                                                        |
| `/account/portal`                          | Authenticated | genau ein servervalidierter Persona-/Company-Kontext; Wechsel erteilt keine Rolle oder Membership                              |
| `/jobs`                                    | Public        | nur veröffentlichte/aktuelle Jobs; allowlisted Filter, globale Rangfolge                                                       |
| `/jobs/[slug]`                             | Public        | Published-only Read Model; Match nur für berechtigten Candidate                                                                |
| `/jobs/kanton/[slug]`                      | Public        | Content-/Liquiditätsgate vor Indexierung                                                                                       |
| `/jobs/kategorie/[slug]`                   | Public        | Content-/Liquiditätsgate vor Indexierung                                                                                       |
| `/jobs/kanton/[slug]/kategorie/[category]` | Public        | duales Content-/Liquiditätsgate                                                                                                |
| `/companies`                               | Public        | nur ACTIVE/LIVE und öffentliche Allowlist                                                                                      |
| `/companies/[slug]`                        | Public        | keine Membership-/Billingdaten; Abuse-/Claim-CTA                                                                               |
| `/salary-radar`                            | Public        | versionierter APPROVED-Datensatz, Mindestmenge/Fallback                                                                        |
| `/guide`                                   | Public        | nur freigegebener Content                                                                                                      |
| `/guide/[slug]`                            | Public        | Published Revision; sicheres Rendering                                                                                         |
| `/legal/imprint`                           | Public        | exakt veröffentlichte, versionierte Rechtsseite                                                                                |
| `/legal/privacy`                           | Public        | exakt veröffentlichte Datenschutzfassung und Zweckinformationen                                                                |
| `/legal/terms`                             | Public        | exakt veröffentlichte, versionierte Nutzungsbedingungen                                                                        |
| `/pricing`                                 | Public        | aktiver Katalog; keine Clientpreise                                                                                            |
| `/employers`                               | Public        | Arbeitgeber-Marketing, keine Firmenmitgliedschaft nötig                                                                        |
| `/employers/demo`                          | Public        | rate-limitierter, consent-gebundener Lead                                                                                      |
| `/employers/employer-branding`             | Public        | ehrliche Marketing-/Mock-Grenzen                                                                                               |
| `/employers/post-job`                      | Public        | CTA in echtes Employer-Onboarding                                                                                              |
| `/employers/talent-radar`                  | Public        | erklärt anonymes/gated Produkt, lädt keine Candidate-Daten                                                                     |
| `/employers/xml-import`                    | Public        | P1 Employer-Import bleibt nicht kauf-/nutzbar                                                                                  |
| `/login`                                   | Public        | Enumeration-safe, sichere `next`-Allowlist                                                                                     |
| `/register`                                | Public        | Rollenwahl                                                                                                                     |
| `/register/candidate`                      | Public        | Terms zwingend; atomare Candidate-Erstellung                                                                                   |
| `/register/employer`                       | Public        | Terms; atomare New-Company-oder-Claim-Verzweigung                                                                              |
| `/forgot-password`                         | Public        | generische Antwort, Rate Limit, Mock-Mail                                                                                      |
| `/reset-password`                          | Public        | Fragment-/POST-Token, no-store/noindex/no-referrer                                                                             |
| `/verify-email`                            | Public Token  | Fragment-Token wird vor Submit aus der URL entfernt; Verify/Resend enumeration-safe, rate-limited, single-use und supersedable |
| `/invite/resume`                           | Public        | kurzlebiger geschützter Resume-Cookie, Revalidierung                                                                           |
| `/alerts/unsubscribe/[token]`              | Public Token  | gehashter, begrenzter Token; no-store/noindex                                                                                  |
| `/forbidden`                               | Public        | generische 403-Oberfläche ohne Objektdetail                                                                                    |

## Auth-/Session-Handler — 4

| Handler            | Rolle                             | Grenze                                                               |
| ------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `/invite/[token]`  | Public Token                      | Roh-Token wird nicht in Query/Referrer weitergetragen; Resume-Cookie |
| `/logout`          | Authenticated                     | Session wird widerrufen und Cookie entfernt                          |
| `/session/clear`   | Authenticated/abgelaufene Session | ungültigen Cookie sicher entfernen, erlaubtes `next`                 |
| `/session/refresh` | Authenticated                     | rotierter gehashter Sessiontoken, Parallelitätsgrenze                |

## Dokumenten-Tresor-Handler — 9

Die Dokumenten-API ist nur für den Local-/CI-Sandbox-Adapter aktiviert.
Production und ein externer Objekt-Storage bleiben fail-closed. Ein Objekt-Key
ist niemals ein Berechtigungsnachweis; Reads benötigen ein maximal 60 Sekunden
gültiges, actor-gebundenes und einmalig konsumierbares Grant.

| Handler                                       | Rolle                          | Grenze                                                                                                   |
| --------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `/api/documents/status`                       | Candidate                      | nur eigener CV-Slot und redigierter Versions-/Scanstatus                                                 |
| `/api/documents/upload-intents`               | Candidate                      | Origin-, Rate-, Typ-, Größen- und Actor-Limit vor Intent; maximal zehn Minuten                           |
| `/api/documents/upload-intents/[id]/body`     | Candidate                      | eigener Intent; Streaming-Limit, Byte-Limit und verschlüsselte Sandbox-Ablage                            |
| `/api/documents/upload-intents/[id]/finalize` | Candidate                      | eigener vollständiger Intent; Hash-/Größenabgleich vor Quarantäne                                        |
| `/api/documents/versions/[id]/scan`           | Candidate                      | eigene Version; deny-by-default Content- und Malware-Prüfung                                             |
| `/api/documents/versions/[id]/delete-request` | Candidate                      | eigene Version; Legal-Hold-/Application-Lifecycle-Grenze                                                 |
| `/api/documents/versions/[id]/read-grants`    | Candidate, Employer, Recruiter | Candidate-Eigentum oder exakt autorisierte Application+Company+Assignment; Recent-Auth und CLEAN-Version |
| `/api/documents/read`                         | Authenticated                  | actor-gebundenes Single-use-Grant; Provider-Hash erneut geprüft; private/no-store                        |
| `/api/documents/read-grants/[id]/revoke`      | Authenticated                  | nur eigenes, noch nicht konsumiertes Grant; idempotenter Widerruf                                        |

## Candidate — 22

Alle Routen verlangen eine aktive `CANDIDATE`-Session. Detailobjekte werden
bereits in der ersten Query auf Candidate/User/Conversation-Eigentum
eingeschränkt.

| Route(n)                                       | Zusätzliche Grenze                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/candidate/dashboard`                         | eigenes Profil, Bewerbungen und nächste Aktionen                                                                                                |
| `/candidate/jobpass`                           | eigenes draftfähiges Profil; Zod/Onboarding-Version                                                                                             |
| `/candidate/saved-jobs`                        | eigene SavedJobs; unique Candidate×Job                                                                                                          |
| `/candidate/applications`                      | eigene Applications                                                                                                                             |
| `/candidate/applications/[id]`                 | Candidate-scoped Safe 404; Timeline/Withdraw/Message                                                                                            |
| `/candidate/applications/external`             | eigener, candidate-bestätigter externer Tracker; Flag fail-closed                                                                               |
| `/candidate/applications/external/[id]`        | Candidate owner; immutable Quelle/Snapshot, versionierte Status-/Reminderaktionen                                                               |
| `/candidate/interviews`                        | nur eigene Participant-Termine; Zeitzone und Status getrennt vom Pipelinewert                                                                   |
| `/candidate/interviews/[id]`                   | Candidate participant; RSVP/Reschedule/Cancel versioniert und fremde ID als Safe 404                                                            |
| `/candidate/alerts`                            | eigene Alerts und separater Delivery-Consent                                                                                                    |
| `/candidate/notifications`                     | Low-Assurance-Security-Einstieg oder eigenes Preference Center; Pflichtzwecke unveränderbar, optionale Zustellung separat gegatet               |
| `/candidate/messages`                          | participant-scoped Conversations                                                                                                                |
| `/candidate/messages/[threadId]`               | Participant-Query; no-store, Abuse-Pfad                                                                                                         |
| `/candidate/talent-radar`                      | COMPLETE + aktueller Opt-in; Default off                                                                                                        |
| `/candidate/talent-radar/requests`             | eigene ContactRequests                                                                                                                          |
| `/candidate/talent-radar/requests/[id]`        | Candidate owner; Accept/Decline/Reveal getrennt                                                                                                 |
| `/candidate/talent-radar/requests/[id]/report` | Candidate owner; bounded Abuse-Intake                                                                                                           |
| `/candidate/privacy`                           | eigene Consents, Contacts, Reveals und Cases                                                                                                    |
| `/candidate/privacy/requests/[id]`             | eigener Privacy Case                                                                                                                            |
| `/candidate/privacy/requests/[id]/verify`      | eigener Case plus Recent-Password-Challenge                                                                                                     |
| `/candidate/settings/security`                 | eigene Session/Faktoren/Recovery und ausschließlich eigene Trust-Fälle; Hochrisikoaktionen über actor-/session-/purpose-/resource-bound Step-up |
| `/candidate/support`                           | Candidate-Entry; leitet in requester-scoped Support                                                                                             |

## Gemeinsamer Support — 2

| Route           | Rolle         | Grenze                                                        |
| --------------- | ------------- | ------------------------------------------------------------- |
| `/support`      | Authenticated | nur eigene Cases; Company-Auswahl nur aus aktiven Memberships |
| `/support/[id]` | Authenticated | requester-scoped Safe 404; Reply nur im erlaubten Status      |

## Employer und Recruiter — 28

Das `/employer`-Layout akzeptiert globale Rollen `EMPLOYER` und `RECRUITER`.
Firmenbezogene Daten verlangen eine aktive Membership im aktuell
servervalidierten Kontext. Owner/Admin verwalten; Recruiter benötigen für
Job-/Pipelineobjekte die passende Assignment; Viewer bleiben read-only oder
erhalten einen sicheren Locked/404-Zustand.

| Route(n)                                             | Company-Rolle / zusätzliche Grenze                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/employer/dashboard`                                | aktive Membership; tenant-scoped Read Model                                                                        |
| `/employer/company`                                  | Recruiter/Viewer read; Writes Owner/Admin                                                                          |
| `/employer/company/claim-pending`                    | aktueller anfragender Employer ohne vorweggenommene Membership                                                     |
| `/employer/team`                                     | Owner/Admin; letzter Owner und Seat-Gate                                                                           |
| `/employer/team/invitations`                         | Owner/Admin; hashed/single-use/Seat-Gate                                                                           |
| `/employer/jobs`                                     | Membership; Recruiter nur zugewiesener Ausschnitt, Viewer read-only                                                |
| `/employer/jobs/new`                                 | Owner/Admin oder Recruiter; Viewer erhält Locked State                                                             |
| `/employer/jobs/[id]`                                | tenant-/assignment-scoped; Rollen×Assignment-Matrix                                                                |
| `/employer/jobs/[id]/boost`                          | Owner/Admin, eigener publizierter Job, Produkt-/Credit-Gate                                                        |
| `/employer/applicants`                               | Job-/Assignment-scope; Viewer ohne Mutation                                                                        |
| `/employer/applicants/[id]`                          | Company+Assignment Safe 404; Application/Reveal-PII-Regeln                                                         |
| `/employer/applicants/[id]/interviews`               | Company Membership plus Application-/Job-Assignment; Viewer read-only                                              |
| `/employer/applicants/[id]/interviews/[interviewId]` | gleicher Tenant/Assignment; Proposal/Reschedule/Cancel versioniert                                                 |
| `/employer/talent-radar`                             | ACTIVE+VERIFIED+Entitlement vor Candidate-Query; Viewer locked                                                     |
| `/employer/talent-radar/requests`                    | Owner/Admin/Recruiter; Viewer 404                                                                                  |
| `/employer/talent-radar/requests/[id]`               | Company-scoped Request; Identität nur nach gültigem Reveal                                                         |
| `/employer/analytics`                                | Company scope, Planlevel und Small-count-Suppression                                                               |
| `/employer/notifications`                            | Low-Assurance-Security-Einstieg oder eigenes Preference Center; keine fremden Company-/User-Präferenzen            |
| `/employer/settings/security`                        | eigene Session/Faktoren/Recovery; Appeals nur zu Firmen mit eigener aktiver Membership, ohne interne Risk-Evidence |
| `/employer/verification`                             | Owner/Admin; versionierte Company-Evidence, Challenge und Re-review ohne Public-Trust-Vorwegnahme                  |
| `/employer/billing`                                  | Owner/Admin read; Planwechsel/Kündigung Owner                                                                      |
| `/employer/billing/profile`                          | Owner/Admin; vollständiges Billingprofil                                                                           |
| `/employer/billing/checkout`                         | Plan Owner; One-time Product Owner/Admin                                                                           |
| `/employer/billing/success`                          | gespeicherte Order + gleiche Autorisierung                                                                         |
| `/employer/billing/invoices`                         | Owner/Admin, tenant-scoped                                                                                         |
| `/employer/billing/invoices/[id]`                    | Owner/Admin; fremd/nicht existent gleiche 404                                                                      |
| `/employer/billing/usage`                            | Owner/Admin; Ledger-/Entitlement-Summaries                                                                         |
| `/employer/billing/subscription`                     | Owner; read-only Real-Payment-Gatestatus, kein Kauf-CTA vor WTP-/Provider-/Phase-25B-Step-up-Freigabe              |

## Lokaler Mock-Checkout — 1

| Route                      | Rolle                                   | Grenze                                                                                                    |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/mock/checkout/[orderId]` | Employer mit aktiver Company-Membership | gespeicherte Order/Company; Plan nur Owner, One-time Product Owner/Admin; Production-Provider bleibt Mock |

## Admin — 45

Alle Routen verlangen eine aktive globale Adminrolle. Diese globale Rolle
gewährt selbst `0` Fachcapabilities. Die Server-Use-Cases lösen aktuelle,
persistierte und zeitlich begrenzte Rollen/Grants auf und prüfen zusätzlich
die genannte Capability; sensible Reads sind begrenzt und Audit-Metadaten
redigiert.

| Route(n) | Capability / Zweck |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/admin` | `ADMIN_OVERVIEW_READ`; Queues, SLA und letzte Audits |
| `/admin/analytics` | `ADMIN_ANALYTICS_READ`; suppressierte Funnels/Finanzen |
| `/admin/audit` | `ADMIN_AUDIT_READ`; max. 100, geschlossene Filter/Correlation |
| `/admin/system` | `ADMIN_COCKPIT_READ` plus `ADMIN_OPS_READ`; Health, SystemTasks sowie redigierte read-only Queue-/DLQ-/Worker-/Provider-/Capacity-Zustände |
| `/admin/system/notification-reconciliation` | `ADMIN_OPS_READ` plus `ADMIN_SYSTEM_TASK_MANAGE`; redigierte unklare E-Mail-Outcomes, resolutionsgebundener Step-up, Evidence-Digest, atomarer Audit/Fencing; kein direkter Provideraufruf |
| `/admin/business-cockpit` | `ADMIN_COCKPIT_READ`; Evidenz/Aktion/Owner/Outcome |
| `/admin/jobs` | `ADMIN_JOB_REVIEW`; Reviewqueue |
| `/admin/jobs/[id]` | Review/Publish-Capabilities; Reason/Confirmation/Quota |
| `/admin/companies` | `ADMIN_COMPANY_REVIEW`; bounded Filter |
| `/admin/companies/[id]` | Company/Claim/Verification/Moderation/Billing-Capabilities |
| `/admin/company-verification` | persistierte Verification-Read/Review-Capability; bounded Queue |
| `/admin/company-verification/[id]` | Review/Approve/Revoke mit Step-up, SoD und aktueller Evidence |
| `/admin/users` | `ADMIN_USER_MODERATE`; bounded Userliste |
| `/admin/users/[id]` | Suspend/Reaktivieren/Session-Revoke; globale Rolle read-only |
| `/admin/taxonomy` | `ADMIN_TAXONOMY_MANAGE`; referenzsichere Änderungen |
| `/admin/reports` | `ADMIN_REPORT_REVIEW`; Severity/SLA/Assignment |
| `/admin/reports/[id]` | Report/Restriction/Resolution-Capabilities |
| `/admin/imports` | `ADMIN_LICENSED_IMPORT`; parse/preview, kein Auto-Publish |
| `/admin/imports/[id]` | Decision/Commit/Rollback mit Provenienz |
| `/admin/support` | `ADMIN_SUPPORT_MANAGE`; Need-to-know/SLA |
| `/admin/support/[id]` | Triage/Assign/Request/Resolve/Reopen |
| `/admin/content` | `ADMIN_CONTENT_MANAGE`; Draft-/Reviewqueue |
| `/admin/content/[id]` | Revision/Preview/Publish; SEO-Gate separat |
| `/admin/content/clusters/[id]` | Product-/Ops-Dual-Approval und Launchstatus |
| `/admin/leads` | `ADMIN_LEAD_MANAGE`; consent-/purpose-bounded |
| `/admin/leads/[id]` | Assignment/Notiz/Status/Follow-up |
| `/admin/legal` | getrennte Legal-Read/Publish-Capabilities und versionierte Freigabe |
| `/admin/billing` | `ADMIN_BILLING_READ`; Mock-Finanzübersicht |
| `/admin/finance/reconciliation` | `ADMIN_BILLING_READ` für redigierte Inbox-/Attempt-/Mismatch-/Run-Ansicht; Phase-33-Held-Settlement-Freigabe zusätzlich `ADMIN_BILLING_MUTATE`, exakte Ressource, frisches AAL2, aktuelle Authority und Audit |
| `/admin/finance/service-recovery` | `ADMIN_BILLING_READ`; Dunning-/Refund-/Service-Assessment-Status, Remedy-Ausführung standardmässig gesperrt |
| `/admin/orders` | Billing-Read/Mutation je Aktion |
| `/admin/orders/[id]` | gespeicherte Order/Payment/Fulfillment-Evidence |
| `/admin/invoices` | Billing-Read |
| `/admin/invoices/[id]` | `ADMIN_INVOICE_MUTATE` für erlaubte Transition |
| `/admin/plans` | `ADMIN_CATALOG_READ                                                                                                                                                                                           | MUTATE`; versioniert |
| `/admin/products` | `ADMIN_CATALOG_READ                                                                                                                                                                                           | MUTATE`; Release-Permits |
| `/admin/privacy-requests` | `PRIVACY_CASE_READ`; minimale Queue |
| `/admin/privacy-requests/[id]` | Read/Verify/Process getrennt; Verifier→Processor-Handoff, zwei unabhängige action-/resource-bound Step-ups und genau eine Approval→WorkItem-Wirkung; Need-to-know |
| `/admin/security` | aktive Adminsession; serverseitiger Redirect auf den eigenen Authenticator-Einstieg, keine Capability-Erweiterung |
| `/admin/security/authenticators` | eigener Passkey-/TOTP-/Recovery-Lifecycle; Admin-Mutationswirkung erst mit frischer Assurance |
| `/admin/security/roles` | `ADMIN_SECURITY_READ`; Antrag/Freigabe zusätzlich `ADMIN_SECURITY_GRANT                                                                                                                                       | APPROVE`, unterschiedliche Actors und konfliktfreie Duties |
| `/admin/security/grants` | `ADMIN_SECURITY_READ`; bounded Direktgrant und Geräte-Reset mit SoD, AAL2, Revoke und Audit |
| `/admin/security/break-glass` | `ADMIN_SECURITY_READ`; Mutation nur `ADMIN_BREAK_GLASS_MANAGE                                                                                                                                                 | APPROVE`, anderem Actor, Incident-ID, TTL und aktivem Gate |
| `/admin/trust-safety` | `TRUST_SAFETY_READ`; keyset-bounded, minimale Fall-/SLA-/Assignee-Daten ohne geheime Evidenz |
| `/admin/trust-safety/[id]` | `TRUST_SAFETY_READ                                                                                                                                                                                            | REVIEW                                                     | RESTORE` je Aktion; Assignment, fallgebundenes AAL2, SoD-Appeal und versionierter Conflict-Schutz |

## Operations-Handler — 3

| Handler         | Rolle             | Antwortgrenze                                                             |
| --------------- | ----------------- | ------------------------------------------------------------------------- |
| `/health/live`  | Public Operations | Prozessstatus + Build-ID, `no-store`, keine Abhängigkeiten/Secrets        |
| `/health/ready` | Public Operations | begrenzter DB-/Schema-/Migrationscheck, 200/503 + Correlation ID          |
| `/dev/mailbox`  | Local Ops Token   | Local/CI plus Bearer-Secret; Production 404, no-store/noindex/no-referrer |

## Payment-Provider-Handler — 1

| Handler                             | Autorität                                                                                                            | Antwortgrenze                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/webhooks/payments/[provider]` | Payment Provider Signature; exakte Providerkennung, Raw Body, Account, Environment/Mode und aktuelle Providerbindung | durable, semantisch deduplizierte Inbox vor Antwort; keine Domainwirkung bei ungültiger Signatur/Account/Mode/Binding; keine Raw-Payload-Ausgabe |

## Privacy-, Verification- und Recruiting-Handler — 3

| Handler                                              | Autorität                                                                                            | Antwortgrenze                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/privacy/exports/[id]`                          | verifizierter Case-Owner mit kurzlebigem, Candidate-/Artifact-/Action-bound Single-use-Step-up       | CAS-Downloadlease; vollständige bounded SHA-/Size-/Body-Prüfung vor atomarem Consume; Fehler löst Lease, zweiter Download/falsches Artefakt/fremder Candidate liefert keine Bytes |
| `/api/company-verification/documents/upload-intents` | Employer/Recruiter plus Company Owner/Admin im exakten Tenant                                        | private Evidence, Typ-/Größen-/Vault-/Step-up-Grenze                                                                                                                              |
| `/api/recruiting/interviews/[id]/calendar`           | Candidate/Employer/Recruiter; Candidate participant oder aktuelle Company Membership plus Assignment | minimale ICS-Datei; Flag/Owner/Tenant/Version geprüft, keine Providerbehauptung                                                                                                   |

## Nicht vorhandene/deferred Routen

- `/employer/mandates` und `/employer/mandates/[id]` bleiben zusammen mit
  REQ-REC-002 als separat gegatetes P1-Paket absent.
- Referral-Routen für REQ-GRW-003 bleiben bis Legal-/Fraud-/Consent-Gate
  absent.
- Es gibt keine öffentlichen Datei-URLs, PDF-Invoice-, Scraping- oder
  Success-Fee-Routen. Phase 33 enthält fail-closed Live-Adaptercode für
  Payment, Dokumente/Privacy und E-Mail, aktiviert ihn aber nicht. Payment-
  Webhook und Dokumenten-Read benötigen exakte persistierte Providerautorität;
  lokale Contract-Stubs und synthetische Receipts sind ausschließlich
  `CONTRACT_ONLY` und kein LIVE-Payment-/Storage-/Zustellbeleg.

## Technischer Ist-Stand und verbleibendes Route-/Prozessdelta Phase 22–33

> Diese Tabelle trennt implementierten Technikstand von geplantem Delta.
> Routen der Phasen 22 bis 28 sind im maschinenlesbaren Ist-Inventar enthalten
> und automatisiert verifiziert, bleiben aber je nach externem Gate
> deaktiviert. Nicht implementierte Zeilen ab Phase 30D bleiben geplantes Delta. Eine
> neue Zeile wird erst nach vorhandener Route, serverseitigem Guard,
> UX-/A11y-Abnahme und grünem Owning-Test in das Ist-Inventar übernommen.

| Phase / Requirement     | Geplanter Einstieg                                                                                                                                                                                                                    | Rollen / Capability und Tenantgrenze                                                                                                                                                                                                           | Zustände / Datenklasse                                                                                                                           | Flag, Test und Aktivierung                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 · `REQ-ID-004`       | **Technischer Ist-Stand:** `/candidate/settings/security`, `/employer/settings/security`, `/admin/security/authenticators` und eingebettete Step-up-Challenge; keine Query-Token-Weitergabe                                           | Candidate, Employer Owner, Billing, Admin; purpose/action/tenant/resource/session-bound                                                                                                                                                        | challenge, success, stale, cancelled, recovery, revoked; Security-sensitive                                                                      | Phase-25-Unit/PostgreSQL/Desktop/360 `PASS`; Enforcement und Production-RP-ID bleiben `DISABLED`                                                                                                                                            |
| 22/33 · `REQ-PRIV-004`  | **Technischer Ist-Stand:** `/legal/privacy`, `/legal/terms`, `/legal/imprint`, `/admin/legal`, Privacy Cases plus expiring `/api/privacy/exports/[id]`; Phase 33 ergänzt persistente Approval→WorkItem→Worker→Artifact/Outbox-Wirkung | Public nur exakte Publication; Candidate owner; Privacy Read/Verify/Process getrennt; zwei unabhängige action-/resource-bound Admin-Step-ups; Candidate-Download zusätzlich artifact-bound; Nicht-Kontoinhaber fail-closed                     | versioned/pending/approved/queued/running/partial/retry/ready/expired/erased; PII/Legal                                                          | Phase-22-G3 historisch `PASS`; Phase-33-Closure `PENDING`; Counsel/Nicht-Kontoinhaber-Identity/Research/Provider/Staging extern, Aktivierung `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`; [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md) |
| 23/33 · `REQ-OPS-005`   | **Technischer Ist-Stand:** `/admin/system`, Worker-/DLQ-/Provider-/Health-Vertrag und Phase-33-App-/Worker-/Scheduler-Runtime; keine Public Controls                                                                                  | Operationsmutation nur mit exakter Capability/Authority; Executable und manueller Pfad teilen denselben Service; lokaler Token ist kein Production-Ersatz                                                                                      | healthy/degraded/paused/backpressured/DLQ/replay/revoked; redigierte Opsdaten                                                                    | Phase-23-G3 historisch `PASS`; Phase-33-Production-Contract/G4 `PENDING`; Staging/Pager/Provider/LIVE extern                                                                                                                                |
| 24/33 · `REQ-PAY-001`   | **Technischer Ist-Stand:** `/employer/billing/subscription`, `/api/webhooks/payments/[provider]`, `/admin/finance/reconciliation` plus bestehende Billing-/Invoice-Routen                                                             | Owner-Guard; exakte Checkout-/Webhook-/Providerautorität; Finance read-only, Held-Settlement-/Refund-Mutationen zusätzlich Capability, resource-bound AAL2 und SoD                                                                             | locked/pending/paid/failed/refunded/disputed/reconciled/held/released; financial                                                                 | Phase-24-Sandboxvertrag historisch `PASS`; Phase-33-Live-Adapter-Contract/G4 `PENDING`; LC5 WTP, PSP/Tax/Legal/Finance/Staging und Aktivierung extern blockiert                                                                             |
| 24 · `REQ-BIL-010`      | **Technischer Ist-Stand:** `/admin/finance/service-recovery`, bestehende Order-/Boost-/Radarobjekte und ServiceDelivery-Worker                                                                                                        | gleiche Company-/OrderLine-/Serviceinstanz; Finance/Support-Ausführung fail-closed                                                                                                                                                             | assessed, extended, credit-restored, escalated/refund; exactly-once                                                                              | Policy-/PostgreSQL-/Replaytests technisch; konkrete Paid-Servicepolicy, Support-SLA und LIVE-Aktivierung offen                                                                                                                              |
| 25 · `REQ-ADM-007`      | **Technischer Ist-Stand:** `/admin/security/{authenticators,roles,grants,break-glass}`                                                                                                                                                | Security Admin getrennt von Support/Moderation/Finance/Privacy; SoD serverseitig                                                                                                                                                               | enroll/recover/pending-second-approval/expired/revoked/break-glass                                                                               | deny-by-default RBAC/MFA/Recovery/SoD PostgreSQL und Browser `PASS`; Production-Owner/RP-ID/On-call `BLOCKED`                                                                                                                               |
| 25/26 · `REQ-TRUST-001` | **Technischer Ist-Stand:** `/admin/trust-safety`, `/admin/trust-safety/[id]` plus bounded Appeal in Candidate-/Employer-Security und Company-Reverification                                                                           | Trust & Safety/Security/Finance scoped je Fall; Subjects sehen nur sicheren Grund und Appeal; Restore verlangt frische starke Evidence und unabhängigen Entscheider                                                                            | open/held/revoked/appealed/false-positive/resolved; interne Evidence verborgen                                                                   | Phase-25/26 Policy/PG/E2E/Worker-Failure `PASS`; externe Risk-/DSFA-/Provider-/Capacity-Freigabe `BLOCKED`                                                                                                                                  |
| 26 · `REQ-EMP-008`      | **Technischer Ist-Stand:** `/employer/verification`, `/admin/company-verification`, `/admin/company-verification/[id]`, `/api/company-verification/documents/upload-intents` plus Public-Company-/Job-/Radar-Consumer                 | Company Owner/Admin submitten nur im eigenen Tenant; Reviewer benötigt persistierte Verification-Capability und Step-up; Self-Approval/SoD fail-closed; Upload-Handler erzwingt Owner-Auth trotz generischer Dateisystemklassifikation         | draft/pending/needs-info/verified/expiring/expired/revoked/appealed; private Evidence bleibt aus Public DTOs entfernt                            | Candidate `96933aa`, Unit/PostgreSQL/HTTP/Desktop/360 `PASS`; reale Provider, Legal/DPA/Region, Capacity, Staging/Pager und Public-Flags `BLOCKED`; [Evidence](./evidence/2026-07-28-phase-26.md)                                           |
| 27 · `REQ-PER-001`      | **Technischer Ist-Stand:** `/account/portal` plus eingebettete Candidate-/Employer-Context-Switcher und bestehender `/invite/resume`-Flow                                                                                             | aktuelle Identity plus aktive PersonaAssignment; Employer zusätzlich exakte aktive CompanyMembership; Admin ausschließlich persistierte Admin-Grants; Candidate-Self-Service und erste Existing-Identity-Employer-Persona action-bound step-up | loading/empty/locked/pending/error/retry/conflict/expired/cancelled/success; Identity/Persona/Company-Kontext und Privacy-sensitive              | Phase-27-Unit/PostgreSQL/Migration/Desktop/360 `PASS`; `IDENTITY_PERSONA_V2`, Invitation, Switch, Privacy und Legacy-Cutover default `DISABLED`; Demand/Canary/Staging/G4 offen; [Evidence](./evidence/2026-07-28-phase-27.md)              |
| 28 · `REQ-REC-003`      | **Technischer Ist-Stand:** `/candidate/applications/external/**`, `/candidate/interviews/**`, `/employer/applicants/[id]/interviews/**` und `/api/recruiting/interviews/[id]/calendar`                                                | Tracker ausschließlich Candidate owner; Scheduler Candidate participant oder aktuelle Company Membership plus Application-/Job-Assignment; Viewer read-only; ein Portalwechsel erteilt keine Autorität                                         | loading/empty/locked/pending/error/retry/conflict/expired/cancelled/success; candidate-confirmed Trackerdaten sowie private Interview-/ICS-Daten | Phase-28-Unit/PostgreSQL/Migration/Desktop/360/A11y technisch verifiziert; beide Flags default `DISABLED`; Demand/Privacy/Ops/Support/Provider/Staging/G4 offen; [Evidence](./evidence/2026-07-29-phase-28.md)                              |
| 30D · `REQ-JOB-007`     | Employer reconfirm/fill action; public/candidate „nicht verfügbar“ report                                                                                                                                                             | own Company Job; public bounded report; Trust/Moderation review                                                                                                                                                                                | due/grace/reconfirmed/filled/expired/duplicate-review/appeal                                                                                     | freshness policy+worker; Search/Sitemap/Alert/Recommendation parity tests                                                                                                                                                                   |

Conditional routes:

- Phase 27 market/cohort activation remains P3/deferred until the moderated
  `REQ-PER-001` demand decision; the owner-activated technical route remains
  default disabled and does not satisfy that gate.
- Phase 28A external tracker and 28B full scheduler are technically present
  behind independent default-off gates. Their market/cohort activation remains
  absent until separate `REQ-REC-003` moderated-demand decisions and the
  documented Privacy/Ops/Support gates pass.
- Phase 30C sitemap index/shards remain absent until the documented
  Count-/Byte-/Forecast trigger; the current single sitemap continues to
  fail closed without truncation.

## Evidence-Grenze

`npm run route:audit` beweist Vollständigkeit und Rollenklassifikation des
Dateibaums, nicht jeden UX-Zustand. Phase 17 prüft eine kritische Desktop-/
360px-Stichprobe; Phase 18 muss zusätzlich den Vier-Rollen-Walkthrough,
Pending-/Loading-Zustände nach den Sicherheits-Gates, lokale Links sowie
Requirement → Test → Evidence im datierenden Abschlussrecord dokumentieren.
Eine fehlende Route oder ein nicht gelaufener State bleibt sichtbar und darf
nicht durch diese Matrix als „bestanden“ ausgegeben werden.

Phase 33 ergänzt das maschinenlesbare Route-, Server-Action- und Runtime-
Control-Inventar sowie drei Rollen-/Failure-/Browserreisen. Auch diese gelten
erst nach `plan:audit`, `route:audit`, `phase33:audit`, vollständigem
exact-candidate-G4 und datiertem Phase-33-Evidence-Record als Nachweis; der
aktuelle Arbeitsbaum bleibt `PENDING`.

Für Phase 19+ gilt zusätzlich
[`remediation-execution-contract.md`](./remediation-execution-contract.md):
Das geplante Delta ist keine Route-Evidence, und jede spätere Promotion in
`route-inventory.json` benötigt einen passierenden `npm run route:audit` auf
dem Abschlusscommit.
