# Route- und Rollenmatrix

> **Stand:** Phase-24-Technikbaum, 110 Seiten und 18 Route Handler. Die
> maschinenlesbare Inventarbasis ist
> [`route-inventory.json`](./route-inventory.json); `npm run route:audit`
> vergleicht sie mit dem tatsächlichen `app/`-Baum. Diese Matrix dokumentiert
> Rollen und fachliche Grenzen, ist aber allein kein Browser-/A11y-Beweis.

## Rollen- und Schutzbegriffe

| Begriff | Bedeutung |
| --- | --- |
| Public | ohne Session erreichbar; Public Read Models enthalten nur freigegebene Felder |
| Authenticated | aktive Candidate-/Employer-/Recruiter-/Admin-Session |
| Candidate | globale Rolle `CANDIDATE`; owner-scoped Candidate-Objekte |
| Employer / Recruiter | globale Rolle `EMPLOYER` oder `RECRUITER` plus bei Firmenobjekten eine aktuelle aktive Membership |
| Company Owner/Admin/Recruiter/Viewer | Firmenrolle; jede Query/Mutation prüft zusätzlich Company, Assignment, Entitlement und Status |
| Admin | aktive globale Rolle `ADMIN`; jeder Use Case benennt zusätzlich eine Capability |
| Public Operations | absichtlich minimale Health-Antwort ohne Secrets/Daten |
| Local Ops Token | nur Local/CI, geheimes Bearer-Token; in Production 404 |

Ein Layout- oder Navigationseintrag ist keine Autorisierungsgrenze. Fremde und
nicht existente Tenant-/Candidate-Ressourcen liefern dieselbe sichere 404;
rollenbezogene Seitenfehler ohne Objektbezug dürfen 403 liefern. Private
Layouts sind dynamisch, `noindex` und no-store. Mutationen besitzen kompakte
Pending-Zustände. Über den privaten Root-Segmenten liegt bewusst keine
`loading.tsx`-Streaming-Grenze: Tenant-/Owner-Guards müssen ihren echten
HTTP-404-Status setzen können, bevor Antwort-Header gesendet werden.
Root-Error und Root-404 bleiben generisch.

## Öffentliche und Auth-Seiten — 28

| Route(n) | Eintritt | Server-/Privacy-Grenze |
| --- | --- | --- |
| `/` | Public | freigegebene Demo/LIVE-Provenienz, keine privaten Daten |
| `/jobs` | Public | nur veröffentlichte/aktuelle Jobs; allowlisted Filter, globale Rangfolge |
| `/jobs/[slug]` | Public | Published-only Read Model; Match nur für berechtigten Candidate |
| `/jobs/kanton/[slug]` | Public | Content-/Liquiditätsgate vor Indexierung |
| `/jobs/kategorie/[slug]` | Public | Content-/Liquiditätsgate vor Indexierung |
| `/jobs/kanton/[slug]/kategorie/[category]` | Public | duales Content-/Liquiditätsgate |
| `/companies` | Public | nur ACTIVE/LIVE und öffentliche Allowlist |
| `/companies/[slug]` | Public | keine Membership-/Billingdaten; Abuse-/Claim-CTA |
| `/salary-radar` | Public | versionierter APPROVED-Datensatz, Mindestmenge/Fallback |
| `/guide` | Public | nur freigegebener Content |
| `/guide/[slug]` | Public | Published Revision; sicheres Rendering |
| `/pricing` | Public | aktiver Katalog; keine Clientpreise |
| `/employers` | Public | Arbeitgeber-Marketing, keine Firmenmitgliedschaft nötig |
| `/employers/demo` | Public | rate-limitierter, consent-gebundener Lead |
| `/employers/employer-branding` | Public | ehrliche Marketing-/Mock-Grenzen |
| `/employers/post-job` | Public | CTA in echtes Employer-Onboarding |
| `/employers/talent-radar` | Public | erklärt anonymes/gated Produkt, lädt keine Candidate-Daten |
| `/employers/xml-import` | Public | P1 Employer-Import bleibt nicht kauf-/nutzbar |
| `/login` | Public | Enumeration-safe, sichere `next`-Allowlist |
| `/register` | Public | Rollenwahl |
| `/register/candidate` | Public | Terms zwingend; atomare Candidate-Erstellung |
| `/register/employer` | Public | Terms; atomare New-Company-oder-Claim-Verzweigung |
| `/forgot-password` | Public | generische Antwort, Rate Limit, Mock-Mail |
| `/reset-password` | Public | Fragment-/POST-Token, no-store/noindex/no-referrer |
| `/verify-email` | Public Token | Fragment-Token wird vor Submit aus der URL entfernt; Verify/Resend enumeration-safe, rate-limited, single-use und supersedable |
| `/invite/resume` | Public | kurzlebiger geschützter Resume-Cookie, Revalidierung |
| `/alerts/unsubscribe/[token]` | Public Token | gehashter, begrenzter Token; no-store/noindex |
| `/forbidden` | Public | generische 403-Oberfläche ohne Objektdetail |

## Auth-/Session-Handler — 4

| Handler | Rolle | Grenze |
| --- | --- | --- |
| `/invite/[token]` | Public Token | Roh-Token wird nicht in Query/Referrer weitergetragen; Resume-Cookie |
| `/logout` | Authenticated | Session wird widerrufen und Cookie entfernt |
| `/session/clear` | Authenticated/abgelaufene Session | ungültigen Cookie sicher entfernen, erlaubtes `next` |
| `/session/refresh` | Authenticated | rotierter gehashter Sessiontoken, Parallelitätsgrenze |

## Dokumenten-Tresor-Handler — 9

Die Dokumenten-API ist nur für den Local-/CI-Sandbox-Adapter aktiviert.
Production und ein externer Objekt-Storage bleiben fail-closed. Ein Objekt-Key
ist niemals ein Berechtigungsnachweis; Reads benötigen ein maximal 60 Sekunden
gültiges, actor-gebundenes und einmalig konsumierbares Grant.

| Handler | Rolle | Grenze |
| --- | --- | --- |
| `/api/documents/status` | Candidate | nur eigener CV-Slot und redigierter Versions-/Scanstatus |
| `/api/documents/upload-intents` | Candidate | Origin-, Rate-, Typ-, Größen- und Actor-Limit vor Intent; maximal zehn Minuten |
| `/api/documents/upload-intents/[id]/body` | Candidate | eigener Intent; Streaming-Limit, Byte-Limit und verschlüsselte Sandbox-Ablage |
| `/api/documents/upload-intents/[id]/finalize` | Candidate | eigener vollständiger Intent; Hash-/Größenabgleich vor Quarantäne |
| `/api/documents/versions/[id]/scan` | Candidate | eigene Version; deny-by-default Content- und Malware-Prüfung |
| `/api/documents/versions/[id]/delete-request` | Candidate | eigene Version; Legal-Hold-/Application-Lifecycle-Grenze |
| `/api/documents/versions/[id]/read-grants` | Candidate, Employer, Recruiter | Candidate-Eigentum oder exakt autorisierte Application+Company+Assignment; Recent-Auth und CLEAN-Version |
| `/api/documents/read` | Authenticated | actor-gebundenes Single-use-Grant; Provider-Hash erneut geprüft; private/no-store |
| `/api/documents/read-grants/[id]/revoke` | Authenticated | nur eigenes, noch nicht konsumiertes Grant; idempotenter Widerruf |

## Candidate — 17

Alle Routen verlangen eine aktive `CANDIDATE`-Session. Detailobjekte werden
bereits in der ersten Query auf Candidate/User/Conversation-Eigentum
eingeschränkt.

| Route(n) | Zusätzliche Grenze |
| --- | --- |
| `/candidate/dashboard` | eigenes Profil, Bewerbungen und nächste Aktionen |
| `/candidate/jobpass` | eigenes draftfähiges Profil; Zod/Onboarding-Version |
| `/candidate/saved-jobs` | eigene SavedJobs; unique Candidate×Job |
| `/candidate/applications` | eigene Applications |
| `/candidate/applications/[id]` | Candidate-scoped Safe 404; Timeline/Withdraw/Message |
| `/candidate/alerts` | eigene Alerts und separater Delivery-Consent |
| `/candidate/notifications` | Low-Assurance-Security-Einstieg oder eigenes Preference Center; Pflichtzwecke unveränderbar, optionale Zustellung separat gegatet |
| `/candidate/messages` | participant-scoped Conversations |
| `/candidate/messages/[threadId]` | Participant-Query; no-store, Abuse-Pfad |
| `/candidate/talent-radar` | COMPLETE + aktueller Opt-in; Default off |
| `/candidate/talent-radar/requests` | eigene ContactRequests |
| `/candidate/talent-radar/requests/[id]` | Candidate owner; Accept/Decline/Reveal getrennt |
| `/candidate/talent-radar/requests/[id]/report` | Candidate owner; bounded Abuse-Intake |
| `/candidate/privacy` | eigene Consents, Contacts, Reveals und Cases |
| `/candidate/privacy/requests/[id]` | eigener Privacy Case |
| `/candidate/privacy/requests/[id]/verify` | eigener Case plus Recent-Password-Challenge |
| `/candidate/support` | Candidate-Entry; leitet in requester-scoped Support |

## Gemeinsamer Support — 2

| Route | Rolle | Grenze |
| --- | --- | --- |
| `/support` | Authenticated | nur eigene Cases; Company-Auswahl nur aus aktiven Memberships |
| `/support/[id]` | Authenticated | requester-scoped Safe 404; Reply nur im erlaubten Status |

## Employer und Recruiter — 24

Das `/employer`-Layout akzeptiert globale Rollen `EMPLOYER` und `RECRUITER`.
Firmenbezogene Daten verlangen eine aktive Membership im aktuell
servervalidierten Kontext. Owner/Admin verwalten; Recruiter benötigen für
Job-/Pipelineobjekte die passende Assignment; Viewer bleiben read-only oder
erhalten einen sicheren Locked/404-Zustand.

| Route(n) | Company-Rolle / zusätzliche Grenze |
| --- | --- |
| `/employer/dashboard` | aktive Membership; tenant-scoped Read Model |
| `/employer/company` | Recruiter/Viewer read; Writes Owner/Admin |
| `/employer/company/claim-pending` | aktueller anfragender Employer ohne vorweggenommene Membership |
| `/employer/team` | Owner/Admin; letzter Owner und Seat-Gate |
| `/employer/team/invitations` | Owner/Admin; hashed/single-use/Seat-Gate |
| `/employer/jobs` | Membership; Recruiter nur zugewiesener Ausschnitt, Viewer read-only |
| `/employer/jobs/new` | Owner/Admin oder Recruiter; Viewer erhält Locked State |
| `/employer/jobs/[id]` | tenant-/assignment-scoped; Rollen×Assignment-Matrix |
| `/employer/jobs/[id]/boost` | Owner/Admin, eigener publizierter Job, Produkt-/Credit-Gate |
| `/employer/applicants` | Job-/Assignment-scope; Viewer ohne Mutation |
| `/employer/applicants/[id]` | Company+Assignment Safe 404; Application/Reveal-PII-Regeln |
| `/employer/talent-radar` | ACTIVE+VERIFIED+Entitlement vor Candidate-Query; Viewer locked |
| `/employer/talent-radar/requests` | Owner/Admin/Recruiter; Viewer 404 |
| `/employer/talent-radar/requests/[id]` | Company-scoped Request; Identität nur nach gültigem Reveal |
| `/employer/analytics` | Company scope, Planlevel und Small-count-Suppression |
| `/employer/notifications` | Low-Assurance-Security-Einstieg oder eigenes Preference Center; keine fremden Company-/User-Präferenzen |
| `/employer/billing` | Owner/Admin read; Planwechsel/Kündigung Owner |
| `/employer/billing/profile` | Owner/Admin; vollständiges Billingprofil |
| `/employer/billing/checkout` | Plan Owner; One-time Product Owner/Admin |
| `/employer/billing/success` | gespeicherte Order + gleiche Autorisierung |
| `/employer/billing/invoices` | Owner/Admin, tenant-scoped |
| `/employer/billing/invoices/[id]` | Owner/Admin; fremd/nicht existent gleiche 404 |
| `/employer/billing/usage` | Owner/Admin; Ledger-/Entitlement-Summaries |
| `/employer/billing/subscription` | Owner; read-only Real-Payment-Gatestatus, kein Kauf-CTA vor WTP-/Provider-/Phase-25B-Step-up-Freigabe |

## Lokaler Mock-Checkout — 1

| Route | Rolle | Grenze |
| --- | --- | --- |
| `/mock/checkout/[orderId]` | Employer mit aktiver Company-Membership | gespeicherte Order/Company; Plan nur Owner, One-time Product Owner/Admin; Production-Provider bleibt Mock |

## Admin — 34

Alle Routen verlangen eine aktive globale Adminrolle. Die Server-Use-Cases
prüfen zusätzlich die genannte Capability; sensible Reads sind begrenzt und
Audit-Metadaten redigiert.

| Route(n) | Capability / Zweck |
| --- | --- |
| `/admin` | `ADMIN_OVERVIEW_READ`; Queues, SLA und letzte Audits |
| `/admin/analytics` | `ADMIN_ANALYTICS_READ`; suppressierte Funnels/Finanzen |
| `/admin/audit` | `ADMIN_AUDIT_READ`; max. 100, geschlossene Filter/Correlation |
| `/admin/system` | `ADMIN_COCKPIT_READ` plus `ADMIN_OPS_READ`; Health, SystemTasks sowie redigierte read-only Queue-/DLQ-/Worker-/Provider-/Capacity-Zustände; keine Mutation vor Phase 25 |
| `/admin/business-cockpit` | `ADMIN_COCKPIT_READ`; Evidenz/Aktion/Owner/Outcome |
| `/admin/jobs` | `ADMIN_JOB_REVIEW`; Reviewqueue |
| `/admin/jobs/[id]` | Review/Publish-Capabilities; Reason/Confirmation/Quota |
| `/admin/companies` | `ADMIN_COMPANY_REVIEW`; bounded Filter |
| `/admin/companies/[id]` | Company/Claim/Verification/Moderation/Billing-Capabilities |
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
| `/admin/billing` | `ADMIN_BILLING_READ`; Mock-Finanzübersicht |
| `/admin/finance/reconciliation` | `ADMIN_BILLING_READ`; redigierte Inbox-/Attempt-/Mismatch-/Run-Ansicht, Phase 24 read-only |
| `/admin/finance/service-recovery` | `ADMIN_BILLING_READ`; Dunning-/Refund-/Service-Assessment-Status, Remedy-Ausführung standardmässig gesperrt |
| `/admin/orders` | Billing-Read/Mutation je Aktion |
| `/admin/orders/[id]` | gespeicherte Order/Payment/Fulfillment-Evidence |
| `/admin/invoices` | Billing-Read |
| `/admin/invoices/[id]` | `ADMIN_INVOICE_MUTATE` für erlaubte Transition |
| `/admin/plans` | `ADMIN_CATALOG_READ|MUTATE`; versioniert |
| `/admin/products` | `ADMIN_CATALOG_READ|MUTATE`; Release-Permits |
| `/admin/privacy-requests` | `PRIVACY_CASE_READ`; minimale Queue |
| `/admin/privacy-requests/[id]` | Read/Verify/Process getrennt, Need-to-know |

## Operations-Handler — 3

| Handler | Rolle | Antwortgrenze |
| --- | --- | --- |
| `/health/live` | Public Operations | Prozessstatus + Build-ID, `no-store`, keine Abhängigkeiten/Secrets |
| `/health/ready` | Public Operations | begrenzter DB-/Schema-/Migrationscheck, 200/503 + Correlation ID |
| `/dev/mailbox` | Local Ops Token | Local/CI plus Bearer-Secret; Production 404, no-store/noindex/no-referrer |

## Payment-Provider-Handler — 1

| Handler | Autorität | Antwortgrenze |
| --- | --- | --- |
| `/api/webhooks/payments/[provider]` | keine Userrolle; exakte Providerkennung, Raw-Body-Signatur, Testaccount/-environment und Ingestion-Flag | durable, deduplizierte Inbox vor Antwort; keine Domainwirkung bei ungültiger Signatur/Account/Environment; keine Raw-Payload-Ausgabe |

## Nicht vorhandene/deferred Routen

- `/employer/mandates` und `/employer/mandates/[id]` bleiben zusammen mit
  REQ-REC-002 als separat gegatetes P1-Paket absent.
- Referral-Routen für REQ-GRW-003 bleiben bis Legal-/Fraud-/Consent-Gate
  absent.
- Es gibt keine öffentlichen oder LIVE-fähigen Datei-URLs, PDF-Invoice-,
  Scraping- oder Success-Fee-Routen. Der Payment-Webhook ist technisch nur für
  den explizit gegateten Stripe-Testadapter implementiert und kein
  LIVE-Paymentbeleg. Der Dokumenten-Read ist ausschließlich grant-gebunden und
  Sandbox-only.

## Verbleibendes geplantes Route-/Prozessdelta Phase 22–32

> Diese Tabelle ist ein Zielregister. Phase-22-Routen sind inzwischen im
> maschinenlesbaren Ist-Inventar enthalten und automatisiert verifiziert,
> bleiben aber wegen externer Gates deaktiviert; die übrigen Zeilen sind
> weiterhin nicht implementiertes Delta. Eine neue Zeile wird erst nach
> vorhandener Route, serverseitigem Guard, UX-/A11y-Abnahme und grünem
> Owning-Test in das Ist-Inventar übernommen. Der genaue Pfad darf die Phase
> per ADR konsolidieren, solange Rollen, Guard und Zustand erhalten bleiben.

| Phase / Requirement | Geplanter Einstieg | Rollen / Capability und Tenantgrenze | Zustände / Datenklasse | Flag, Test und Aktivierung |
| --- | --- | --- | --- | --- |
| 25 · `REQ-ID-004` | gemeinsame `/security`-/Step-up-Challenge; Phase-20-E-Mail-Assurance bleibt Basis, keine Query-Token-Weitergabe | Candidate, Employer Owner, Billing, Admin; purpose/action/tenant/resource/session-bound | challenge, success, stale, cancelled, recovery, revoked; Security-sensitive | risk/assurance policy; direct-action/tenant/replay tests; High-risk actions fail-closed |
| 22 · `REQ-PRIV-004` | **Technischer Ist-Stand:** `/legal/privacy`, `/legal/terms`, `/legal/imprint`, `/admin/legal`, bestehende Privacy Cases plus expiring `/api/privacy/exports/[id]` | Public nur exakte Publication; Candidate owner; Privacy Read/Verify/Process getrennt; Nicht-Kontoinhaber fail-closed | versioned/pending/hold/partial/retry/ready/expired/erased; PII/Legal | Candidate `0636a875`, automatisiertes G3 `PASS`; Counsel/Phase-25-Step-up/Research `BLOCKED`, Activation `DISABLED`; [Evidence](./evidence/2026-07-26-phase-22.md) |
| 23 · `REQ-OPS-005` | **Technischer Ist-Stand:** `/admin/system`, Phase-23-Worker-/DLQ-/Provider-/Health-Vertrag; keine Public Controls | Operationsmutationen bleiben Phase 25; Local Token nicht Production-Ersatz | healthy/degraded/paused/backpressured/DLQ/replay; redigierte Opsdaten | Candidate `d16a2d9`, Local-/CI-G3 `PASS`; Staging/Pager/Provider/LIVE `DISABLED` |
| 24 · `REQ-PAY-001` | **Technischer Ist-Stand:** `/employer/billing/subscription`, `/api/webhooks/payments/[provider]`, `/admin/finance/reconciliation` plus bestehende Billing-/Invoice-Routen | Owner-Guard; Webhook-Signatur+Inbox; Finance read-only, Mutationen zusätzlich Capability/Step-up/SoD | locked/pending/paid/failed/refunded/disputed/reconciled; financial | Local-/CI-Sandboxvertrag; LC5 WTP, PSP/Tax/Legal/Finance/Phase-25-Step-up und LIVE bleiben `BLOCKED` |
| 24 · `REQ-BIL-010` | **Technischer Ist-Stand:** `/admin/finance/service-recovery`, bestehende Order-/Boost-/Radarobjekte und ServiceDelivery-Worker | gleiche Company-/OrderLine-/Serviceinstanz; Finance/Support-Ausführung fail-closed | assessed, extended, credit-restored, escalated/refund; exactly-once | Policy-/PostgreSQL-/Replaytests technisch; konkrete Paid-Servicepolicy, Support-SLA und LIVE-Aktivierung offen |
| 25 · `REQ-ADM-007` | `/admin/security`, role/assignment, dual-approval and break-glass oversight | Security Admin distinct from Support/Moderation/Finance/Privacy; SoD enforced server-side | enroll/recover/pending-second-approval/expired/revoked/break-glass | Admin RBAC/MFA flag; cross-capability/direct-action/E2E; no global fallback |
| 25/26 · `REQ-TRUST-001` | risk-based Trust-&-Safety queues/details, possibly consolidated with existing reports | Trust & Safety/Security/Finance scoped by case type; subjects see bounded appeal | open/held/revoked/appealed/false-positive/resolved; secret signal details hidden | risk-policy version; fraud/ATO/incident drill; rapid kill switch |
| 26 · `REQ-EMP-008` | existing Company verification plus structured evidence/re-review | Company Owner submits; independent reviewers approve; no self-approval | draft/pending/needs-info/verified/expiring/expired/revoked/appealed | evidence provider + dual review; Badge/Job/Radar same-read revocation |
| 30D · `REQ-JOB-007` | Employer reconfirm/fill action; public/candidate „nicht verfügbar“ report | own Company Job; public bounded report; Trust/Moderation review | due/grace/reconfirmed/filled/expired/duplicate-review/appeal | freshness policy+worker; Search/Sitemap/Alert/Recommendation parity tests |

Conditional routes:

- Phase 27 Multi-Persona routes remain P3/deferred until an explicit
  `REQ-PER-001` scope decision.
- Phase 28A external tracker and 28B full scheduler remain absent until
  separate `REQ-REC-003` moderated-demand gates.
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

Für Phase 19+ gilt zusätzlich
[`remediation-execution-contract.md`](./remediation-execution-contract.md):
Das geplante Delta ist keine Route-Evidence, und jede spätere Promotion in
`route-inventory.json` benötigt einen passierenden `npm run route:audit` auf
dem Abschlusscommit.
