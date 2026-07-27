# Security-, Assurance- und Trust-&-Safety-Runbook

## 1. Zweck und Aktivierungsgrenze

Dieses Runbook gehört zu Phase 25 und beschreibt den technischen
Local-/CI-Vertrag für Admin-Least-Privilege, MFA/Recovery, nutzerseitiges
Step-up sowie Trust-&-Safety-Fälle. Es ist **keine** Production-, Pager-,
Legal-/Privacy-, Geräte- oder Personal-Freigabe.

Die sichere Standardkonfiguration bleibt:

```text
ADMIN_MFA_REQUIRED=false
PRIVILEGED_STEP_UP_MODE=disabled
TRUST_RISK_MODE=observe
BREAK_GLASS_ENABLED=false
```

Ein Secret oder ein globales `ADMIN`-Konto aktiviert keinen Track. Übergänge
von `DISABLED` über `OBSERVE`/Allowlist bis Enforcement benötigen den exakten
Deployment-Digest, benannte getrennte Owner und die externen Gates aus
`codex-plan/25-admin-security.md`.

## 2. Autoritätsmodell

### 2.1 Adminrollen und Duties

`User.role=ADMIN` erlaubt nur den Eintritt in das interne Portal. Fachrechte
werden bei jeder serverseitigen Prüfung aus aktuellen, persistierten,
zeitgebundenen Zuweisungen und Direktgrants aufgelöst.

| Rolle | Duty | Hauptumfang |
| --- | --- | --- |
| `PLATFORM_OPERATOR` | `PLATFORM` | Übersicht, Suche, User/Firma, Leads, Ops, Audit, Analytics |
| `JOB_MODERATOR` | `MODERATION` | Job-/Company-/Claim-/Report-Review und Restriktionen |
| `SUPPORT_AGENT` | `SUPPORT` | Supportfälle ohne Security-/Risk-Rohdaten |
| `CONTENT_SUPPLY_OPERATOR` | `CONTENT_SUPPLY` | Taxonomie, Import, Content und Cluster |
| `FINANCE_OPERATOR` | `FINANCE` | Billing, Katalog, Invoice, Credits |
| `PRIVACY_VERIFIER` | `PRIVACY_VERIFY` | Privacy-Read/Verify/Hold |
| `PRIVACY_PROCESSOR` | `PRIVACY_PROCESS` | Privacy-Process/Execution und Legal-Publikation |
| `SECURITY_ADMIN` | `SECURITY` | Rollen/Grants, Authenticator-Reset, Break-glass, Audit |
| `TRUST_SAFETY_REVIEWER` | `TRUST_SAFETY` | Fälle lesen, zuweisen, halten oder widerrufen |
| `TRUST_SAFETY_APPROVER` | `SECURITY` | unabhängiger Appeal-/Restore-Entscheid |

Konfliktpaare sind `PRIVACY_VERIFY↔PRIVACY_PROCESS`,
`FINANCE↔SECURITY` und `TRUST_SAFETY↔SECURITY`. Selbstgrant,
Selbstfreigabe und gleicher Appellant/Reviewer/Approver werden serverseitig
abgelehnt. Break-glass vererbt keine Rolle und wird nur als enges,
zeitgebundenes Capability-Set aufgelöst.

### 2.2 Step-up-Matrix

Ein Step-up ergänzt immer Ownership, Membership, Tenant, Entitlement und
fachliche Statusprüfungen; er ersetzt keine davon.

| Purpose | Actions | Bindung |
| --- | --- | --- |
| `PAID_CHECKOUT` | serverautorisierter Checkout | Actor, Session, Company, Quote/Resource |
| `EMPLOYER_BILLING` | Checkout/Profile/Plan/Cancel/Payment Method | Actor, Session, Company, Resource |
| `EMPLOYER_TEAM` | Invite/Role/Remove/Owner Change | Actor, Session, Company, Membership/Invite |
| `EMPLOYER_COMPANY_TRUST` | Trust-/Verification-/Legal-Name-Änderung | Actor, Session, Company, Resource |
| `EMPLOYER_EXPORT` | Bulk-/Radar-Export und Reveal | Actor, Session, Company, Resource |
| `ACCOUNT_SECURITY` | Login-E-Mail und Recovery | Actor, Session, User-Resource |
| `CANDIDATE_PRIVACY` | Export/Delete/Correct | Actor, Session, Request/Intent |
| `CANDIDATE_TRUST` | kritischer Consent, Radar und Reveal | Actor, Session, Resource, gegebenenfalls Company |
| `FINANCE_REFUND` | Request/Approve | Actor, Session, Company, Refund |
| `ADMIN_PRIVACY` | Export/Correct/Delete/Hold ausführen | Actor, Session, Case |
| `TRUST_SAFETY` | Hold/Revoke/Resolve/Restore/Appeal | Actor, Session, Case |

Challenges und Grants sind kurzlebig, opaque, gehasht, AAL2-gebunden und
single-use. Cross-Actor, Cross-Session, Cross-Purpose, Cross-Tenant,
Cross-Resource, stale, revoked und replayed Evidence hat null Fachwirkung.

### 2.3 Risk-Entscheide und Wirkung

`TRUST_RISK_POLICY_V1` akzeptiert nur den geschlossenen Signalkatalog:
Credential Stuffing, Password Spray, Session-/Recovery-Anomalie,
kompromittierte Firma, Job-Scam/-Dublette, Mass Messaging/Contact,
wiederholte Beschwerden, Reveal-/Export-Anomalie und Payment Fraud.

Jedes Signal speichert Zweck, Quelle, Policy-Version, Zeitfenster,
minimalen Count, Evidence-Digest und Retention. Rohinhalte, CV-/Nachrichten-
oder Querykopien sowie geschützte Attribute gehören nicht in `RiskSignal`.

| Decision | Wirkung |
| --- | --- |
| `ALLOW` | keine zusätzliche Wirkung |
| `STEP_UP` | fachliche Aktion bleibt bis passender frischer Assurance gesperrt |
| `REVIEW` | deduplizierter Fall ohne automatische irreversible Wirkung |
| `HOLD` | begrenzte reversible Wirkung mit Ablauf und Review |
| `REVOKE` | nur nach bestätigtem Signal und menschlicher, capability- sowie step-up-gebundener Entscheidung |

Containment ist scope-basiert. Unterstützt werden insbesondere Session- und
Assurance-Revoke, Company-Suspension, Public-Job-Pause,
Verification-Revoke, offene Radar-Kontakte sowie ausstehende
Payment-/Fulfillment-Wirkung. Reads prüfen den aktuellen Fachstatus und
bleiben auch bei Worker-Verzögerung fail-closed.

## 3. Regelbetrieb

### 3.1 Security- und Trust-Queues prüfen

1. `/admin/security/authenticators`: eigenen Faktor-/Recovery-Status prüfen.
2. `/admin/security/roles`: Rollen und offene Vier-Augen-Anträge prüfen.
3. `/admin/security/grants`: bounded Direktgrants und Authenticator-Resets
   prüfen.
4. `/admin/security/break-glass`: nur bei dokumentiertem Incident öffnen.
5. `/admin/trust-safety`: Status, Severity, Assignee und Reviewfrist prüfen.
6. `/admin/trust-safety/[id]`: sichere Reason, Scope, Effekte, append-only
   Historie und offenen Appeal prüfen.

Support erhält keinen Ersatzweg zu internen Risk-Evidenzen. Datenbank-Edits,
manuelles Zurücksetzen von Status oder Teilen von Admin-Konten sind verboten.

### 3.2 Fall zuweisen und entscheiden

1. Fallversion und aktuelle Effekte neu laden.
2. berechtigte Review-Person zuweisen;
3. sichere, nicht geheime Begründung erfassen;
4. für Hold/Revoke/Restore einen exakt fallgebundenen Step-up ausstellen;
5. Entscheidung einmal absenden;
6. Case-Event, Audit, Containment-Effekte und sichtbare Eligibility prüfen;
7. bei Conflict den aktuellen Stand neu laden, nie blind wiederholen.

Ein unbestätigtes Signal darf keinen irreversiblen Revoke auslösen. Ein
kompromittierter VERIFIED-Company-Incident wird dagegen nach bestätigter
Entscheidung beim nächsten Read aus Public Jobs und riskanten Aktionen
entfernt; der Worker ist nicht die einzige Schranke.

### 3.3 Appeal und Restore

Betroffene sehen nur sichere Reason Codes, nächste Schritte und Frist. Ein
offener Decision-Stand erlaubt genau einen Appeal. Die final entscheidende
Person muss von Appellant und bisherigem Case-Assignee verschieden sein und
`TRUST_SAFETY_RESTORE` plus frische fallgebundene AAL2-Evidence besitzen.

Restore kehrt nur als reversibel gespeicherte Effekte zurück. Sessions,
verwendete Grants oder widerrufene Security-Evidence werden nie
„wiederbelebt“. Nicht reversible Firmenverifikation benötigt die spätere
fachliche Reverification aus Phase 26.

## 4. Geräteverlust, Recovery und Authenticator-Reset

1. Identität nicht allein über E-Mail oder einen Supporttext akzeptieren.
2. vorhandenen Single-use-Recovery-Code nur über den Security-Flow verwenden;
3. bei Admin-Geräteverlust einen `AUTHENTICATOR_RESET`-Antrag durch eine
   andere berechtigte Person stellen und freigeben lassen;
4. nach Reset prüfen: Faktoren widerrufen, Recovery-Codes widerrufen,
   Sessions beendet, Assurances/Step-up-Grants widerrufen, Audit vorhanden;
5. neuen Faktor in einer neuen gültigen Sitzung registrieren.

Recovery erzeugt nur kurze Recovery-Assurance und keine AAL2- oder
Capability-Erweiterung. Der letzte aktive Faktor darf nicht ohne den
kontrollierten Resetpfad entfernt werden.

## 5. Break-glass

Break-glass bleibt standardmässig aus. Vor einem erlaubten Drill oder Incident
müssen Incident-ID, Requester, anderer Approver, maximal acht notwendige
Capabilities, maximal 60 Minuten TTL, On-call und Alertempfänger feststehen.

Nach Aktivierung:

1. `SECURITY_INCIDENT`-SystemTask und Audit prüfen;
2. nur den dokumentierten Incident bearbeiten;
3. Grant frühestmöglich widerrufen;
4. spätestens bei TTL-Ablauf Expiry-Worker ausführen;
5. Session-/Assurance-Revoke und fehlende Restrechte prüfen;
6. Incident und eventuelle Capability-Lücke nachbesprechen.

Ein Rollback darf niemals die historische All-Admin-Semantik reaktivieren.
Wenn die persistierte Capability-Auflösung ausfällt, wird Adminbetrieb
pausiert.

## 6. Worker, Failure und Recovery

Phase 23 registriert die Phase-25-Handler für Security-Expiry und
Trust-Case-Expiry. Der Fachvertrag lautet effect-before-ack, idempotent,
lease-/fencing-gebunden und replay-sicher.

Bei Worker-Stopp oder Poison Event:

1. öffentliche und privilegierte Reads auf fail-closed Wirkung prüfen;
2. Queue Age, Attempts, Lease und DLQ ohne Payload-/Secret-Leak prüfen;
3. Ursache beheben oder Handlergruppe per Kill Switch pausieren;
4. Worker neu starten beziehungsweise auditierten Re-drive ausführen;
5. genau eine Fachwirkung und genau ein terminales Ack prüfen;
6. Alert/Ack/Eskalation dokumentieren.

Lokale PostgreSQL-Failure-Tests ersetzen keinen realen Pager-, Staging- oder
On-call-Drill. Diese bleiben vor Aktivierung extern blockierend.

## 7. Kill Switch und Roll-forward

- `PRIVILEGED_STEP_UP_MODE=disabled|observe|enforce` wird actionweise
  freigegeben. Eine LIVE-Hochrisikoaktion darf nach Rückschaltung nicht
  ungeschützt offenbleiben.
- `TRUST_RISK_MODE=observe|hold|revoke` pausiert neue automatische Wirkung,
  löscht aber keine Fälle oder Revocations.
- `BREAK_GLASS_ENABLED=false` verhindert neue Incidentgrants.
- `ADMIN_MFA_REQUIRED=false` ist nur die deaktivierte Local-/CI-Grenze; ein
  bereits produktiv freigegebener Adminbetrieb darf nicht auf AAL1
  zurückfallen.

Nach extern sichtbarer Sperre wird vorwärts über Case-Entscheid,
Reverification, Appeal und Reconciliation repariert. Ein Datenbankrollback
darf alte Sessions, Grants, Badges, Jobs, Radar- oder Paymentrechte nicht
reaktivieren.

## 8. Pflichtnachweise vor Aktivierung

- freigegebene Geräte-/Recoverypolicy und Production-RP-ID/HTTPS;
- benannte, getrennte Personen je Duty sowie Recovery-/Break-glass-Owner;
- Trust-/Risk-/Retention-/DSFA-Entscheid und sichere Appeal-SLA;
- Reviewer- und On-call-Kapazität, Queue-/Incident-SLO und Pagerdrill;
- getrennte 25A-/25B-/25C-Canaries auf dem deployten Artefakt;
- Worker stop/restart, Poison→DLQ, Alert→Ack→Eskalation;
- manuelle Tastatur-/Screenreader- und Geräteverlust-Abnahme;
- Phase-32-G4 auf exakt demselben Deployment-Digest.

Bis diese Nachweise datiert und von den zuständigen Ownern freigegeben sind,
bleiben Admin-MFA-Enforcement, Break-glass, automatische Holds/Revoke und
alle davon abhängigen Paid-/Public-Trust-Flows `DISABLED`.
