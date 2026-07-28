# Phase 26 — Firmen-Trust, belastbare Verifizierung und schnelle Revocation

## 1. Status

| Dimension | Status |
| --- | --- |
| Planstatus | `GEPLANT` |
| Technikstatus | `NICHT IMPLEMENTIERT` |
| Quality-Gate | `NICHT GELAUFEN` |
| Aktivierung | `DISABLED` |

Der vorhandene Company-Verification-Lifecycle ist historische Mock-MVP-
Vorarbeit. Er belegt keine echte Register-/Domain-/Dokumentprüfung. Für LC3–LC6
bleiben ein starkes öffentliches Badge, öffentliche „verifizierte“ Stellen und
Talent-Radar-Zugriff deaktiviert, bis Phase 26 technisch, qualitativ,
organisatorisch und providerseitig freigegeben ist.

## 2. Ziel und messbarer Business-/Nutzerwert

„Verifiziert“ soll einen klar benannten, aktuellen und tatsächlich geprüften
Umfang bedeuten. Kandidaten sehen keine stärkere Trustbehauptung als die
zugrundeliegende Evidence; Arbeitgeber erhalten einen nachvollziehbaren
Antrags-, Re-review- und Appealprozess; kompromittierte oder abgelaufene Firmen
verlieren Badge, öffentliche Jobs und Radar-Berechtigung unmittelbar
fail-closed.

Messbare Ziele:

- `0` starke `VERIFIED`-Projektionen ohne aktuelle gültige Evidence;
- Expiry, Revoke oder bestätigter Compromise bewirkt beim nächsten Public-,
  Job- und Radar-Read `0` Eligibility;
- Public DTO enthält `0` private Dokumente, Providerrohantworten, Challenge-
  Secrets oder Reviewer-Notizen;
- jede Entscheidung besitzt Scope, Methode, Policy-Version, Prüfer, Zeit,
  Validity, Reason und Audit;
- Reviewer-Queue und Handling Capacity decken die freigegebene Launchkohorte
  plus dokumentierten Puffer oder stoppen neue Aufnahmen.

## 3. Tatsächlicher Repositoryzustand

- `STH-014` ist bestätigt: UID und Registrierungsdomain existieren als Signale,
  aber kein realer Registerabgleich, keine Domain-Control-Challenge, keine
  Vault-Evidence und kein durchgängiger Expiry-/Re-review-Vertrag.
- Bestehende Submit/Review/Verify/Reject/Revoke-, Lock-, Supersession-,
  Notification- und Radar-Widerrufsketten sind wertvolle Vorarbeit.
- Die heutige Evidence besteht im Kern aus Beschreibung/freier Referenz und
  darf nicht als starke UID-/Domain-/Vertretungsprüfung reklassifiziert werden.
- Der aktuelle öffentliche Company-/Job-/Radar-Vertrag und seine historischen
  Tests bleiben Regression, aber keine reale Provider- oder LIVE-Evidence.
- Trust-&-Safety-Fall, kompromittierte Company, Risk Hold, schnelle
  cross-domain Revocation und Appeal entstehen in Phase 25C und sind noch
  nicht implementiert.
- Reale Reviewerzeit, Queue-Alter, Staffing und Unit Cost sind nicht gemessen.

Vor Codebeginn inventarisiert Phase 26 aktuelle Modelle, Commands, Public DTOs,
Eligibility-Konsumenten, Migrationen und Owning Tests auf dem grünen
Phase-19-Commit.

## 4. Findings und Requirements

| ID | Phase-26-Vertrag |
| --- | --- |
| `STH-014` / `REQ-EMP-008` | strukturierte aktuelle Firmen-Evidence, Expiry, Re-review, Revocation |
| `STH-031` / `REQ-TRUST-001` | compromised Company, Scam/Fraud, Rapid Hold/Revoke und Appeal |
| `STH-034` / `REQ-OPS-004` | Reviewerzeit, Queue, Personal, Coverage und Unit Cost |
| `REQ-DOC-002` | private Nachweisdokumente nur über Phase-21-Vault |
| `REQ-OPS-005` | autonome Expiry-/Reminder-/Re-review-/Alert-Worker |
| `REQ-ID-004` | Owner-/Reviewer-Hochrisikoactions mit Step-up |
| `REQ-JOB-007` | Trustverlust wirkt konsistent mit Job-Freshness/Eligibility |
| `REQ-QA-003` | vollständiger 28-Punkte- und Testvertrag |

ADR-036 liefert Risk/Trust-Safety und ADR-037 die unabhängigen
Freshness-/Cluster-Gates. Phase 26 besitzt die fachliche Autorität für
Verification Evidence, Level, Scope, Validity, Badge und Company-Trustwirkung.

## 5. In Scope

- versionierte Evidence-Typen wie `UID_REGISTER`, `DOMAIN_CHALLENGE`,
  `DOCUMENT` und eng begrenzte `MANUAL_EXCEPTION`;
- UID-/Registerabgleich mit Quelle, Query/Response-Zeit, Matchdimensionen,
  Ergebnis und redigiertem Digest;
- Domain-Control-Challenge mit gehashtem Token, Ablauf, Company-/Domainbindung,
  Supersession und Domainwechsel;
- optionales Nachweisdokument mit Verification-Purpose im Phase-21-Vault;
- getrennte Trustlevel/-scopes, Risk Level, `verifiedAt`, `expiresAt`,
  Re-review, Changes Requested, Reject und Revoke;
- Vertretungs-/Ownership-Grenze: Domainkontrolle allein beweist keine
  juristische Vertretungsbefugnis;
- Legacy-Policy und Reverification für bestehende textuell `VERIFIED` Firmen;
- präzise Public-Badge-Copy mit Methode/Scope/Datum/Validity, ohne private
  Evidence;
- Trust-/Moderation-Queue mit Assignment, SLA, Handling Time und Capacity;
- compromised-company Hold/Revoke/Appeal über Phase 25C;
- atomare/fail-closed Wirkung auf Badge, Public Job, Companyprofil, Radar und
  riskante Employeraktionen.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- Behauptung, Zefix/UID oder ein anderer Registerprovider sei freigegeben, bevor
  Vertrag, Nutzungsrecht, DPA, Region und Testevidence vorliegen;
- öffentlich sichtbare Nachweisdokumente, Providerrohantworten oder interne
  Reviewer-/Fraudnotizen;
- generisches KYC/KYB, wirtschaftlich Berechtigte, Kreditprüfung oder
  Rechtsberatung;
- automatische Verifizierung allein anhand E-Mail-Domain, UID-Text, Dokument-
  Dateiname oder bezahltem Plan;
- automatisches Publish allein wegen schwacher/Legacy-Evidence;
- Ersetzung von Jobmoderation, Job-Freshness, Content-/Cluster- oder
  Recruitinggates;
- Multi-Persona, ATS, SSO, Success Fee oder externe Agenturmandate.

Ohne Phase-26-Go zeigen Public/Marketing keine starke Verifikationsbehauptung.
Der betroffene Badge-/Public-Job-/Radar-Scope bleibt serverseitig deaktiviert.

## 7. Benutzerrollen und organisatorische Owner

- **Company Owner/Admin:** darf für die eigene Firma Antrag, Evidence,
  Challenge, Changes und Appeal bedienen; Recruiter/Viewer nicht.
- **Trust Reviewer:** prüft zugewiesene Fälle mit enger Capability und Step-up.
- **Trust Approver:** getrennte Person bei High Risk/Manual Exception/Revoke-
  Restore.
- **Trust & Safety:** bearbeitet Compromise-/Scam-/Fraud-Fälle aus Phase 25C.
- **Support:** sieht Status/SLA und sichere nächste Schritte, nicht die
  vollständige Evidence.
- **System Worker:** Expiry, Reminder, Re-review, Provider Retry und
  Revocation-Projektion.
- **Visitor/Candidate:** sieht nur sicheren Badge-Scope und profitiert von
  fail-closed Job-/Radar-Eligibility.
- **Trust Product/Policy Owner:** Evidencelevel, Validity, Badge-Copy und SLA.
- **Legal/Privacy/Security/Ops Owner:** Provider-/Daten-/Risk-/Capacity-Gates.

Reviewer darf nie den eigenen Companyantrag oder eine unvereinbare Duty
freigeben.

## 8. Portale, Routen, Services, Provider und Worker

Bestehende Employer-/Admin-/Public-Routen werden erweitert; geplante neue
Routen bleiben bis zur Implementierung im Planned Route Delta:

- Employer Verification Panel und `/employer/verification`;
- Admin Queue/Detail `/admin/companies` und
  `/admin/companies/[id]/verification`;
- Public Company Detail und Public Job Detail/Eligibility;
- Talent-Radar Search/Contact/Reveal Eligibility;
- Domain-Challenge-Bestätigung über opaque, no-store/noindex Route;
- Trust-Safety-Verknüpfung zu `/admin/trust-safety/[id]`.

Services/Provider:

- `lib/employer/company.ts`, neue `lib/companies/verification/**`;
- `lib/admin/companies.ts`, `lib/companies/public-read-model.ts`;
- `lib/jobs/public-eligibility.ts`, `lib/talentradar/**`;
- Register-/Domain-Providerport und Composition Root;
- Phase-21-Vault, Phase-20-Outbox und Phase-23-Worker;
- Phase-25 Assurance/Risk/Trust-Safety.

## 9. Datenmodelle, Constraints, Indizes und Datenklassifikation

Prospektiv additive Modelle:

- `CompanyVerificationEvidence` mit Type, Source/Provider, normalized
  Identifier, Scope, Status, response digest, checkedAt, validFrom/validTo;
- `CompanyDomainChallenge` mit hashed Token, Domain, issued/expires/consumed,
  supersededBy und Companybindung;
- `CompanyVerificationCheck` mit versioniertem Input-/Output-Schema,
  Matchdimensionen und Failure Class;
- `CompanyTrustLevel`/Projection mit Policy-Version, Scope, verifiedAt,
  expiresAt, risk state;
- `CompanyVerificationDecision`/`ExceptionApproval`;
- Referenz auf `Document` mit festem Verification Purpose;
- Handling-Time-/Assignment-/SLA-Evidence am bestehenden Request/Event oder
  einer additiven Queueprojektion.

Constraints:

- kein aktiver starker Scope ohne mindestens eine gültige, policyzulässige
  Evidence/Decision;
- Challenge Token single-use, kurzlebig und domain-/company-bound;
- pro Company/Scope höchstens ein effektiver Trustlevel und ein offener
  Re-review-Zyklus;
- Manual Exception braucht Ablauf, Reason und je Risiko anderen Approver;
- Revoked/Expired ist nie Public-eligible, unabhängig von verspätetem Worker;
- private Evidence ist verschlüsselt/restricted; Public DTO nur allowlisted.

Indizes decken Status/Priority/Assignee/SubmittedAt, Evidence Validity,
Company/Scope und fällige Re-review-/Expiry-Aufträge.

## 10. Migration, Backfill und Kompatibilität

1. additive Evidence-/Check-/Challenge-/Trustlevel-/Validity-Modelle;
2. historische `VERIFIED`-Zyklen als `LEGACY_MANUAL` mit ehrlichem Scope
   klassifizieren, nie als UID-/Domainprüfung erfinden;
3. leere DB und Bestandsfixture mit DRAFT/PENDING/VERIFIED/REJECTED/REVOKED,
   mehreren Zyklen, Radar/Jobs und Legacytext migrieren;
4. teilweise/unterbrochenen Backfill und Wiederholung idempotent testen;
5. Public Copy und Eligibility über versionierte Compatibility Projection
   migrieren;
6. N-1-App/Worker darf Expired/Revoke/Scoped Evidence nie als unbeschränkt
   `VERIFIED` lesen; sonst ist nach Cutover nur Roll-forward zulässig;
7. Re-review kohortenweise, mit Capacity-/Admission-Gate vor Legacyablauf;
8. Count-/Null-/Orphan-/Scope-/Validity-/Tenant-Abgleich vor Contract;
9. alte freie Evidence erst nach bestätigter Retention und vollständiger
   Migration entfernen oder archivieren.

## 11. Server-, Worker-, Queue- und Providervertrag

- Antrag und Evidenceänderung prüfen Session, Membership, Companyrolle,
  Step-up, Zyklusstatus und Tenant vor Transaktion;
- Register-/Domainadapter liefern typed, versionierte Resultate und besitzen
  Timeout, Retryklasse, Rate-Limit, Health und fail-closed Composition;
- Providerantwort ist niemals direkte Badgeautorität; eine serverseitige
  Policy plus zulässige Reviewerentscheidung erzeugt Trustlevel;
- Expiry-/Re-review-/Reminder-Worker laufen idempotent über Phase 23;
- jeder Public-/Job-/Radar-Read prüft current Trust synchron/fail-closed und
  hängt nicht allein an verzögerter Projektion;
- Trust-Safety-`HOLD|REVOKE` aus Phase 25C invalidiert riskante Wirkung bei der
  nächsten Serverprüfung;
- Restore erfordert Reverification, zulässigen anderen Approver, Step-up,
  Reason und Audit;
- Queue Claim/Assignment, Provider Attempt, Decision und Notification sind
  dedupliziert und auditierbar.

## 12. UX-Zustände

- **Loading:** Evidence-/Provider-/Queuezustand mit sicherem Skeleton;
- **Empty:** noch kein Antrag/Evidence, mit klarer nächster Aktion;
- **Locked:** Rolle, Step-up, Trust Hold, Capacity Admission oder externes Gate
  fehlt;
- **Pending:** Challenge, Provider, Review, Re-review oder Appeal;
- **Error:** sichere Correlation ID ohne Provider-/Dokumentdetails;
- **Retry:** nur retriable Provider-/Upload-/Challengefehler mit neuem bounded
  Versuch;
- **Conflict:** superseded Cycle, Domainwechsel, parallele Entscheidung,
  veraltete Evidence;
- **Expired:** Challenge, Evidence, Trustlevel oder Reviewfrist;
- **Cancelled:** zurückgezogener/superseded Antrag ohne Badgewirkung;
- **Success:** Scope, Methode, Datum, Validity und nächste Re-review verständlich.

Zusätzlich sind `CHANGES_REQUESTED`, `REJECTED`, `REVOKED`, `ON_HOLD` und
`APPEAL_PENDING` explizit. Public Copy sagt exakt, was geprüft wurde, nicht
„garantiert seriös“.

## 13. Mobile und Accessibility

- Employer-Antrag, Challenge, Evidenceupload, Changes und Appeal funktionieren
  bei 360 px, Touch, Tastatur und Screenreader;
- Admin Queue/Detail besitzt zugängliche Assignment-, Review- und
  High-Risk-Approval-Aktionen ohne wide-only-Tabelle;
- Badge Scope/Datum/Expiry ist für Screenreader benannt und nicht nur Farbe/Icon;
- Provider-/Pending-Status nutzt verständliche Textupdates ohne Live-Region-
  Spam;
- Dokument-/Domainfehler fokussieren den zugehörigen Abschnitt;
- vertrauliche Evidence erscheint nicht in DOM, Tooltip, URL, Canonical oder
  Analytics.

## 14. Authentisierung, Step-up, Autorisierung und Tenant

- Company Owner/Admin darf nur eigene Company einreichen; Recruiter/Viewer und
  fremde IDs werden serverseitig denied/safe-404;
- Submission, Evidencewechsel, Domainwechsel, Manual Exception, Revoke/Restore
  und Appeal folgen der Phase-25B-StepUpPolicy;
- Reviewer benötigt genaue persistierte Capability aus 25A; High Risk und
  Manual Exception erzwingen SoD/unterschiedliche Actor-IDs;
- Trust-&-Safety-Hold/Revoke benötigt Phase-25C-Case/Decision;
- Support darf keine Trustentscheidung oder Evidence lesen;
- Providerautorität endet beim typed Result; Provider darf keinen User-/Company-
  Grant erzeugen;
- Public DTO und Eligibility werden ohne Clientflags serverseitig aus current
  Trust berechnet;
- Company Membership/Assignment bleibt Tenantautorität und wird nie durch
  Badge/Trustlevel ersetzt.

## 15. Datenschutz, Retention, Export, Löschung und Audit

- Register-/Domain-/Dokumentdaten haben dokumentierten Zweck, Rechtsgrund,
  Quelle, Region, Retention und Zugriff;
- Providerrohantworten und Dokumente sind private Evidence, verschlüsselt und
  nie Public DTO;
- response digest beweist Integrität, darf aber keine umkehrbare PII-Kopie sein;
- Datenschutzexport enthält verständliche eigene Verification-/Decision-
  Historie; interne Riskdetails/Drittdaten nur im rechtlich zulässigen Umfang;
- Löschung/Anonymisierung folgt Phase-22-Retention-/Legal-Hold-Matrix;
- Domain-Challenge-Secrets gehasht und nach Ablauf minimiert;
- Reviewerzugriff, Providercall, Submit, Decision, Expiry, Re-review, Hold,
  Revoke, Appeal und Restore sind auditierbar;
- Analytics erhält nur freigegebene, aggregierte Prozess-/SLA-Ereignisse, keine
  Evidenceinhalte.

## 16. Abuse-, Fraud-, ATO-, Replay- und Insider-Szenarien

- erfundene UID, ähnlich geschriebene Firma, Registermismatch oder nicht
  vertretungsberechtigte Domainperson;
- DNS-/Mailbox-/Domain-Challenge-Übernahme, Replay, Token Leak und Domainwechsel;
- manipuliertes/ersetztes Dokument, Malware, Hash-/Purpose-Mismatch;
- gekaperter Owner reicht Evidence ein oder wechselt Domain/Reviewer;
- compromised VERIFIED Company nach ursprünglicher legitimer Prüfung;
- Fake-/Duplicate-Jobs, Scamlinks, Massennachrichten und Beschwerden;
- Provider Timeout/Fehler/gefälschte Antwort oder Insider-Override;
- Reviewer prüft eigene Firma, kolludiert, exportiert Evidence oder umgeht
  Queue/Capacity;
- Manual Exception ohne Ablauf/Reason/zweiten Approver;
- Appeal/Restore ohne Reverification oder mit stale Trustzustand.

Positive und False-Positive-Kontrollfälle sind Pflicht. Eine Anomalie allein
darf keine irreversible Löschung erzeugen; öffentliche riskante Wirkung kann
bis Review fail-closed gehalten werden.

## 17. Externe und organisatorische Voraussetzungen

| Gate | Owner | Evidence |
| --- | --- | --- |
| Registerzugang/-nutzungsrecht | Legal/Trust/Ops | Vertrag, zulässige Abfragen, DPA/Region, Sandbox-/Contracttest |
| Verification-/Badgepolicy | Trust Product/Legal | Evidencelevel, Scope, Validity, Copy, Manual-Exception-Regeln |
| Vault/Scanner | Security/Privacy/Ops | Phase-21-Gate für Verification-Dokumente |
| Reviewer/SoD | Trust Operations/Security | benannte Reviewer/Approver, Training, Vertretung, Quality Review |
| Capacity | Ops/Commercial | p50/p95 Handling Time, Arrival, Queue Age, Staffing, Puffer, Admission Stop |
| Incident/Compromise | Trust & Safety/Ops | Phase-25C-Case, Pager, Rapid-Revoke-/Appeal-Runbook |
| Legal/Privacy | Counsel/Privacy | Retention, Auskunft/Löschung, DSFA-/Providerentscheidung |

Ohne Provider kann ein kontrollierter manueller LC2-Prozess nur dann zugelassen
werden, wenn Policy, Evidence, SoD, Capacity und Copy dies ausdrücklich
erlauben. Er gilt nicht als automatisierte LC3–LC6-Reife.

## 18. Interphase-Abhängigkeiten

- Phase 19 G0 und aktuelle Baseline;
- Phase 20 Identity, Reverification und Notification-Outbox;
- Phase 21 Vault/Scanner für Dokumente;
- Phase 22 Retention/Export/Erasure/Legal;
- Phase 23 Worker, Provider Ledger, Monitoring, Pager und Queue;
- Phase 25A/B/C für Reviewerrechte, Owner-Step-up, Compromise/Rapid Revoke;
- Phase 30D für Job-Freshness-/Duplicate-Interaktion;
- Phase 31A für Operationskapazität und engen Launchscope;
- Phase 29/32 für finale UX-/Release-Evidence.

Phase 26 ist vor aktivem starkem Badge, öffentlichen verifizierten Jobs und
Talent Radar in LC3–LC6 zwingend. Ein Scope kann diese Abhängigkeit nur durch
vollständiges serverseitiges Deaktivieren dieser Versprechen vermeiden.

## 19. Geordnete Implementierungsschritte

1. ADR-/Requirement-, Threat-/Abuse-, Provider-, Evidencelevel-, Badge-,
   Validity-, Legacy-, Capacity- und Appealpolicy freigeben.
2. vollständige Eligibility-/DTO-/Route-/Role-/Queue-Konsumentenmatrix
   inventarisieren.
3. additive Evidence-/Check-/Challenge-/Trustlevel-/Decision-Migration und
   Bestandsfixture implementieren.
4. Domain Challenge und Registerproviderport mit fail-closed Contracttests.
5. Verification-Dokumentpurpose an Phase-21-Vault anbinden.
6. Owner Submit/Changes/Appeal und Reviewer Assignment/Decision/Exception mit
   Phase-25-Assurance/SoD implementieren.
7. Public Badge/DTO und Company-/Job-/Radar-Eligibility auf current
   Policy-Version umstellen.
8. Expiry/Reminder/Re-review/Provider-Retry/Notification Worker anbinden.
9. compromised-company Hold/Revoke/Restore und Appeal mit Phase 25C
   integrieren.
10. Legacy-Reverification kohortenweise mit Admission-/Capacity-Gate.
11. Owning-, Provider-, Migration-, Cross-tenant-, Compromise-, Failure-,
    Mobile-/A11y- und Capacitytests.
12. Sandbox/Allowlist Canary, Rapid-Revoke-/Provider-/Queue-/Rollbackdrill;
    Public-Gates erst danach.

## 20. Feature Flags, Kill Switch und Aktivierung

- `COMPANY_TRUST_V2`: neue Policy/Projection observe-only;
- `COMPANY_DOMAIN_CHALLENGE`: provider-/cohortgebunden;
- `COMPANY_REGISTER_CHECK`: getrennte Provideraktivierung;
- `COMPANY_VERIFICATION_DOCUMENT`: nur bei grünem Vault;
- `COMPANY_STRONG_BADGE`: Public-Ausgabe default false;
- `COMPANY_TRUST_PUBLIC_ELIGIBILITY`: Job/Radar/Company Scope gemeinsam
  fail-closed;
- `COMPANY_TRUST_RAPID_REVOKE`: Phase-25C-integriert;
- `LEGACY_COMPANY_REVERIFY`: bounded Cohort/Admission.

Kill Switch pausiert neue Providerchecks/Anträge/Badgeaktivierung, löscht aber
keine Evidence. Revoke/Expiry bleibt fail-closed wirksam. Aktivierungsfolge:
`DISABLED → OBSERVE → INTERNAL REVIEW → ALLOWLIST → PUBLIC`. Jeder Schritt
braucht Provider-, Capacity-, False-Positive-, Eligibility- und Rollbackproof.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle Testdateien sind geplant und werden erst in Phase 26 angelegt.

| Criterion/Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P26-AC-01` / `REQ-EMP-008` | P0: starkes Badge ohne Evidence | Unit + PostgreSQL | Trustlevel-/Badgepolicy | gültige UID/Domain/Decision erzeugt exakt benannten Scope | missing/expired/revoked/mismatch/Legacy/manual ohne Approval | Public/Reviewer | Policy/Public DTO | alle Evidencelevel, Uhrgrenzen, Policyversionen | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/employer/company-trust-policy-v2.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-trust-verification-postgres.test.ts` | ungültige Kombinationen `0` strong VERIFIED; Public DTO private Felder `0`; gültig genau erwarteter Scope/Datum | Policy-/DTO-/DB-Report | Trust Product + QA | `PLANNED` |
| `P26-AC-02` / `REQ-EMP-008` | P0: gefälschter Register-/Domainnachweis | Provider Contract | UID/register/domain exact/mismatch/failure | typed exact Match und gebundene Challenge | not-found, similar name, mismatch, malformed, timeout, replay, wrong/changed domain | Owner/System | Provider Ports | signed fixtures, UID/name/domain variants | Unit/Sandbox | `npx vitest run --config vitest.config.ts tests/unit/providers/company-verification/provider-contract.test.ts` | jeder Input genau typed Result; Fehl-/Replayfälle `0` Trustwirkung; keine Raw PII in Log/Audit | Contractreport + redigierte Fixtures | Trust + Security | `PLANNED` |
| `P26-AC-03` / `REQ-ID-004` | P0: fremder/gekaperter Actor ändert Trust | PostgreSQL | Rollen/Tenant/Step-up/SoD | eigener Owner submit; zugewiesener Reviewer entscheidet | Recruiter/Viewer/fremde Company, stale/cross-purpose Step-up, gleicher Approver | Owner/Reviewer | Employer/Admin Commands | Company A/B, alle Rollen, Actor A/B, stale grants | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-verification-authorization-postgres.test.ts` | Negativfälle `0` Writes/Providercalls; High Risk gleiche Actor-ID `0` Abschluss; erlaubte Wirkung 1 + Audit | Auth-/Tenant-/Audit-Report | Security + Trust | `PLANNED` |
| `P26-AC-04` / `REQ-DOC-002` | P0: unsicheres/falsches Evidenzdokument | Integration | Vault Purpose/scan/version/retention | CLEAN Verification Document der eigenen Firma reviewbar | quarantined/infected/wrong purpose/replaced/deleted/cross-tenant/expired URL | Owner/Reviewer | Vault/Verification | clean/malware/polyglot, Company A/B, versions | real PostgreSQL + Storage/Scanner Sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-verification-document-postgres.test.ts` | nur CLEAN+current+purpose-bound lesbar; negative Downloads `0`; Public DTO Keys/Bytes `0` | Vault-/DB-/Access-Report | Security + Privacy + Trust | `PLANNED` |
| `P26-AC-05` / `REQ-EMP-008` | P0: Expiry/Re-review lässt stale Trust aktiv | PostgreSQL Boundary | validity/reminder/re-review | vor Grenze current, an/nach Grenze expired/review | DST/Clock, delayed worker, superseded cycle, concurrent review/revoke | System/Owner/Reviewer | Trust Policy/Worker | fixed clocks, boundaries, multiple cycles | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-trust-validity-postgres.test.ts` | an/nach Expiry nächster Read: strong Badge/Job/Radar `0`; Reminder/Review je Dedupe-Key 1 | Boundary-/Worker-/State-Report | Trust + Ops | `PLANNED` |
| `P26-AC-06` / `REQ-TRUST-001` | P0: kompromittierte Firma bleibt öffentlich/riskant | PostgreSQL + E2E | Incident Hold/Revoke/Restore | bestätigter Case entzieht Badge/Jobs/Radar/Sessions/risikante Actions | Signal allein löscht irreversibel; worker delayed; stale cache; restore ohne Reverify/SoD | T&S/Owner/Public | Trust Case/Public/Employer/Radar | verified Company, active Jobs/Radar/Sessions, incident/appeal | real PostgreSQL + Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/trust/company-compromise-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase26-company-verification.spec.ts --project=chromium-journeys` | nach committed REVOKE beim nächsten Read `0` Badge/eligible Job/Radar/riskante Action; Restore erst nach gültiger Evidence+anderem Approver | Cross-domain-/E2E-/Audit-Report | Trust & Safety + Trust Product | `PLANNED` |
| `P26-AC-07` / `REQ-EMP-008` | P1: Legacy wird übertrieben/ungeplant gesperrt | Migration + PostgreSQL | Legacy Classification/Reverification | Legacy bleibt ehrlich begrenzt und kohortenweise reviewbar | Legacy→strong Backfill, verlorene Zyklen, über Capacity expirierte Massensperre | System/Reviewer | Migration/Queue/Public DTO | historische states/cycles/jobs/radar | isoliertes PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-trust-legacy-postgres.test.ts` | Legacy→strong ohne neue Evidence `0`; Zyklen/Events Countabweichung 0; Public Copy exakt Legacy/kein Strong Badge | Migration-/DTO-/Count-Report | Data/DBA + Trust | `PLANNED` |
| `P26-AC-08` / `REQ-OPS-004` | P0/P1: Reviewerbacklog macht Launch unkontrollierbar | Operations/Capacity | handling time/arrival/queue/SLA/admission | freigegebene Kohorte plus Puffer abdeckbar | reviewer absent, burst, SLA breach, queue > capacity, manual exception surge | Reviewer/Ops | Admin Queue/Capacity Model | mindestens 100 synthetische Fälle, Mix normal/high risk | Staging + Modell | manuell: 20 repräsentative Fälle zeitmessen; `npx vitest run --config vitest.integration.config.ts tests/integration/admin/company-verification-queue-postgres.test.ts` | p50/p95 Handling, Arrival, Backlog, Coverage und Cost erfasst; Admission stoppt neue Kohorte bei Forecast>SLA-Kapazität; unerreichbare Rows 0 | anonymisiertes Time-/Queue-/Staffing-Modell | Trust Ops + Commercial | `PLANNED` |
| `P26-AC-09` / `REQ-OPS-005` | P0: Provider-/Worker-Ausfall verliert Expiry/Revoke | Failure | timeout/429/5xx/restart/DLQ/backpressure | Retry/Recovery ohne doppelte Decision | poison response, crash vor/nach Event, provider unavailable | System/Ops | Provider/Worker/DLQ | Fault Injection, due expiry/reviews | real PostgreSQL + Sandbox/Staging | `npx vitest run --config vitest.integration.config.ts tests/integration/employer/company-trust-failure-postgres.test.ts`; manuell: Provider/Worker stoppen, DLQ re-drive, Alert ack | doppelte Decisions/Notifications 0; fail-closed Eligibility trotz Delay; DLQ/age Alert innerhalb freigegebener SLO | Failure-/Pager-/Runbook-Record | Ops + Trust | `PLANNED` |
| `P26-AC-10` / `REQ-QA-003` | P0: Schema-/Backfillkorruption | Migration | empty/upgrade/partial/idempotent/N-1 | sichere additive Migration | partial backfill, orphan Evidence, invalid validity, N-1 liest stale trust | System/DBA | Prisma/PostgreSQL | leere DB + Phase-18-Fixture + partial/N-1 | isoliertes PostgreSQL | `npm run db:migrate`; `npm run db:migrate:status`; `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase26-company-trust-migration-postgres.test.ts` | Exit 0; Orphan/invalid strong trust 0; Wiederholung 0 Zusatzwirkung; N-1 fail-closed oder Roll-forward-Guard | Migration-/Compatibility-Manifest | Data/DBA + Trust | `PLANNED` |
| `P26-AC-11` / `REQ-QA-003` | P1: Trustprozess unverständlich/unzugänglich | E2E + A11y | Submit→Challenge/Register/Document→Review→Badge; Changes/Expiry/Revoke/Appeal | klare states/next steps | error/locked/conflict/expired, private evidence leak, narrow viewport | Owner/Reviewer/Public | Employer/Admin/Public UI | alle UX-Zustände, Company A/B | Chromium Desktop + 360 | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase26-company-trust-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase26-company-trust-quality.spec.ts --project=chromium-mobile-360` | Axe serious/critical 0; Clipping kritischer Actions 0; Public private fields/URLs 0; Scope/Datum/Status verständlich | Playwright/Axe/Screenshots | UX + Accessibility + Privacy | `PLANNED` |
| `P26-AC-12` / `REQ-EMP-008` | P0: Gate nur UI-seitig | Route/API Security | Badge/Public Job/Radar vor/nach Gate | current strong trust erlaubt freigegebenen Scope | Flag off, missing/expired/revoked/held trust, direkte Route/API/old cache | Visitor/Candidate/Owner | Public Company/Jobs/Radar/API | every trust status, flag state, cluster | real PostgreSQL + HTTP/E2E | `npx vitest run --config vitest.integration.config.ts tests/integration/jobs/company-trust-eligibility-postgres.test.ts`; `npm run test:e2e:http` | alle ineligible states `0` public strong badge/jobs/radar results; Flag off vollständig fail-closed | Eligibility-/HTTP-Manifest | Trust + Jobs + Radar + QA | `PLANNED` |

### Phase-26 Audit-log extension matrix

| Audit Action | Auslöser | Mindestmetadaten | Ziel |
| --- | --- | --- | --- |
| `COMPANY_VERIFICATION_SUBMITTED_V2` | Owner startet einen strukturierten Prüfzyklus | Request-, Company-, Policy- und Evidence-Scope | `COMPANY_VERIFICATION` |
| `COMPANY_VERIFICATION_CHECKED_V2` | Register-, Domain- oder Dokumentcheck endet | Checktyp, Resultat, Provider-Key und redigierter Digest | `COMPANY_VERIFICATION` |
| `COMPANY_VERIFICATION_ASSIGNED_V2` | Reviewer übernimmt oder erhält einen Fall | Assignee, SLA und Request-Version | `COMPANY_VERIFICATION` |
| `COMPANY_VERIFICATION_DECIDED_V2` | Reviewer/Approver entscheidet | Decision, Reason, Risiko, Policy, Gültigkeit und SoD | `COMPANY_VERIFICATION` |
| `COMPANY_VERIFICATION_APPEALED_V2` | Owner oder Trust Operations eröffnet einen Appeal | Request-, Decision- und Appeal-Reason | `COMPANY_VERIFICATION` |
| `COMPANY_TRUST_CHANGED_V2` | Trustprojektion wird gehalten, widerrufen oder wiederhergestellt | alter/neuer Status, Scope, Reason und Decision | `COMPANY` |
| `COMPANY_TRUST_EXPIRED_V2` | Current-Trust-Gültigkeit endet | Scope, Policy, Ablauf und Projektion | `COMPANY` |

## 22. Performance und Scale

- Public current-Trust-Prüfung verwendet indexierte/bounded Projection und fügt
  im Staging p95 höchstens `20 ms` zum Company-/Job-/Radar-Read hinzu;
- Providerchecks laufen nicht unbounded im Requestpfad; UI erhält `PENDING`,
  Worker/Command verarbeitet Timeout/Retry;
- Queue besitzt Keyset-Pagination, Severity/Freshness, Assignment und keine
  harte unerreichbare Cap;
- Re-review-/Expiry-Worker verarbeitet bounded Batches und misst Queue Age,
  Throughput, Failure/DLQ und Provider Rate Limit;
- vor LC3+ werden p50/p95 Handling Time pro Evidencelevel, Arrival Rate,
  Queue-p95-Alter, Reviewerstunden, Vertretung und Cost/Fall versioniert;
- Startkohorte plus mindestens `30 %` Kapazitätspuffer ist erforderlich;
  Forecast darüber aktiviert Admission Stop statt SLA-/Qualitätsverlust;
- konkrete externe Provider-/Review-SLAs werden vor Aktivierung durch Owner
  freigegeben und danach gegen reale Werte gemessen.

## 23. Geschützte Phase-01–18-Invarianten

- Phase 03/07/15: kanonische Public Eligibility, sichere Public DTOs,
  fail-closed SEO/Sitemap;
- Phase 06/10: Company Claim, Membership, Assignment, Owner-/Tenantgrenze und
  sichere 404;
- Phase 09/14: Candidate Privacy, Radar Current Consent, Anonymität und Reveal;
- Phase 11: bestehender Company Review Lifecycle, Capability-/Audit-Seams;
- Phase 12/13: bezahlte Rechte/Boost verändern Trust/Fair Score nicht;
- Phase 16: IDOR, CSRF, no-store, Redaction, Audit und Abuse;
- Phase 17/18: Cross-role E2E, Zero Retry, Clean Clone/Recovery und ehrliche
  Demo-/LIVE-Grenze.

Bestehende Submit/Review/Verify/Reject/Revoke-, Supersession-, Notification- und
Radar-Withdrawal-Semantik wird erweitert, nicht parallel dupliziert.

## 24. Rollback und Roll-forward

- Provider kann pausiert werden; neue Checks bleiben `PENDING`, nie
  automatisch `VERIFIED`;
- Badge-/Public-Eligibility-Flags können deaktiviert werden; Revoke/Expiry bleibt
  fail-closed;
- Evidence/Decisions werden bei Rollback nicht gelöscht;
- Compatibility Projection erlaubt N-1 nur, wenn Scope/Expiry/Revoke sicher
  verstanden wird; andernfalls Roll-forward-only und altes Binary blockieren;
- nach Public Badge/Job/Radar-Trustverlust darf DB-Rollback keine Berechtigung
  wiederbeleben;
- Legacy-Reverification kann cohortweise pausieren, ohne Strong Trust zu
  erfinden;
- Restore nach Provider-/Policyfehler erfolgt über neue Decision/Reverification,
  nicht durch Überschreiben historischer Events.

## 25. Benötigte Evidence und Artefakte

- Evidencelevel-/Scope-/Validity-/Badge-/Legacy-/Appealpolicy;
- Register-/Domainprovidervertrag, DPA/Region, Contract-/Failure-/Sandboxreport;
- Migration-/Backfill-/N-1-/Count-/Checksum-Evidence;
- Role×Action×Step-up×SoD- und Cross-Tenant-Matrix;
- Public DTO-/Private-Evidence-/Vault-/Retention-Prüfung;
- Expiry/Re-review/Compromise/Rapid-Revoke/Restore/Appeal-Manifest;
- Job-/Company-/Radar-Eligibility-Vorher/Nachher;
- Handling-Time-/Queue-/Staffing-/Coverage-/Cost-/Admission-Modell;
- Desktop-/360-/A11y-Artefakte;
- Provider-/Worker-/DLQ-/Pager-/Kill-Switch-/Rollbackdrill;
- externe Legal/Privacy/Trust/Ops-Freigaben und Commit-/Artefakt-Digest.

## 26. Definition of Done

- jede starke Trustprojektion besitzt gültige strukturierte Evidence,
  Policy-Version, Scope, Validity und zulässige Decision;
- Legacy ist ehrlich klassifiziert und nicht still hochgestuft;
- Owner-/Revieweraktionen sind tenant-, capability-, step-up- und
  gegebenenfalls SoD-gesichert;
- Expiry, Hold, Revoke und Compromise wirken fail-closed auf Badge, Public Jobs,
  Company und Radar;
- Appeal/Restore/False Positive ist funktionsfähig und auditierbar;
- Provider, Vault, Worker, Queue, Capacity, Runbook und UX sind vollständig;
- jede AC-Zeile `PASS` oder begründet `N/A`; Owning Tests, Lint, Typecheck,
  Build, vollständige Unit/PostgreSQL/E2E/Security-Suites und G3 laufen auf
  demselben Commit.

Technischer/qualitativer Abschluss erteilt keine Provider-, Legal- oder
Public-LIVE-Freigabe. Aktivierung bleibt bis zu Abschnitt 17 separat.

## 27. Quality-Gate für abhängige Phasen

- kein starkes Public Badge, keine als verifiziert beworbene öffentliche Stelle
  und kein Talent-Radar-Scope in LC3–LC6 vor grünem Phase-26-G3 und externem
  Trust-/Provider-/Capacity-Go;
- Phase 28/30D müssen Trust-/Freshness-Wirkung gegen dieselbe Eligibility
  testen;
- Phase 29 finalisiert Company-/Job-/Radar-UX erst auf stabiler Phase-26-Policy;
- Phase 31B darf Verifikation/Radar/Trust nicht verkaufen, bevor Delivery-,
  Capacity- und Operationsgates grün sind;
- Phase 32 prüft Public-, Employer-, Candidate-, Admin-, Provider-, Compromise-
  und Recoveryfluss auf exakt dem deployten Artefakt.

## 28. Was diese Phase nicht beweist

Phase 26 beweist nicht:

- dass eine verifizierte Firma nie betrügt, solvent ist oder jede Stelle wahr
  ist;
- dass Domainkontrolle juristische Vertretungsbefugnis oder Registerprüfung
  ersetzt;
- dass Register-/Providerzugang rechtlich oder vertraglich freigegeben ist;
- dass Jobmoderation, Job-Freshness, Clusterliquidität oder
  Kandidatenqualifikation grün sind;
- dass Radar oder ein Paid-Badge Zahlungsbereitschaft besitzt;
- dass Reviewer Capacity bei anderem Volumen oder landesweitem Rollout genügt;
- allgemeine KYC/KYB-, AVG-, Datenschutz- oder Produktionsreife.

Das Badge kommuniziert nur den tatsächlich geprüften versionierten Scope.
