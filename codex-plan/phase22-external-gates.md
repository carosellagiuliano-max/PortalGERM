# Phase 22 — externe Legal-/Privacy-/Provider-Gates

> Stand 26. Juli 2026: **alle externen Aktivierungsgates offen.** Die Tabelle
> ist eine technische Übergabe, keine Rechtsberatung und keine Freigabe. Wo
> kein datierter, benannter Fachentscheid vorliegt, bleiben UI, API, Worker,
> Provider und Marketing serverseitig deaktiviert.

## Technisches Dateninventar

| Feld | Wert |
| --- | --- |
| Vertrag | `PHASE22_DATA_INVENTORY_V1` |
| Zeilen | 24 |
| Subject-Klassen | `USER`, `CANDIDATE`, `EMPLOYER_MEMBER`, `INVITEE`, `LEAD`, `REPORTER`, `NON_ACCOUNT_HOLDER` |
| Processor | `postgres-primary`, `document-object-store`, `notification-outbox`, `email-provider`, `payment-ledger`, `analytics-store`, `audit-store`, `runtime-logs`, `backup-restore` |
| kanonischer SHA-256 | `d9e199e8d7423abc1070d305efbed59e2c52bce6f79ab90e2fbe3b8e8f9798c4` |
| technische Validierung | vollständig und deterministisch |
| fachliche Signatur | `NICHT VORHANDEN` |
| Aktivierungsstatus | `BLOCKED` |

Die technischen Zeilen verwenden bewusst
`EXTERNAL_DECISION_REQUIRED` beziehungsweise
`*-decision-required` für ungeklärte Basis/Region. Sie dürfen nicht als
signierte `ACTIVE`-Version in eine Production-Datenbank kopiert werden.

## Counsel-/Fachentscheidungsmatrix

| Flow/Scope | erforderlicher Owner und Entscheid | Mindest-Evidence | technischer Gate | Status |
| --- | --- | --- | --- | --- |
| öffentliche Privacy Notice | Swiss Privacy/Legal: DSG, gegebenenfalls DSGVO, Retention, Rechtekanäle | signierte Revision, Hash, Locale, effective/expiry/review | `LEGAL_PUBLICATION_PRIVACY` plus aktuelle Publication | `BLOCKED` |
| Terms/AGB | Swiss Legal: Leistungsumfang, Haftung, Kündigung, Rechtswahl | signierte Revision und Re-review | `LEGAL_PUBLICATION_TERMS` | `BLOCKED` |
| Impressum | Swiss Legal/Company Owner: korrekte Rechtsperson und Kontakt | Handelsregister-/Kontaktbeleg, signierte Revision | `LEGAL_PUBLICATION_IMPRINT` | `BLOCKED` |
| Cookie/Analytics Notice | Privacy/Legal: Basis je Eventfamilie, Widerruf, Retention | Eventkatalog, Policyhash, Retentionentscheid | `LEGAL_PUBLICATION_ANALYTICS`, `OPTIONAL_ANALYTICS_*` | `BLOCKED` |
| Privacy Export V2 | Privacy/Legal/Data: vollständige Kategorien, Ausschlüsse, Region, Frist | signiertes Inventory, Processor-/DPA-Liste, Counsel-Ref | `PRIVACY_EXPORT_V2`, Cohort, exakte `ProcessingApproval(PRIVACY_EXPORT, region, processor)` | `BLOCKED` |
| Korrektur | Privacy plus Domain Owner: kanonisch korrigierbare Felder/Evidence | Feldmatrix, immutable Ausnahmen, Eskalationsweg | `PRIVACY_CORRECTION_EXECUTION` und exakte Approvals | `BLOCKED` |
| Erasure/Anonymisierung | Privacy/Legal/Finance: Hold-, Application-, Audit- und Accounting-Retention | signierte Retention-/Hold-Matrix, Review-/Release-Owner | `PRIVACY_ERASURE_EXECUTION` und exakte Approvals | `BLOCKED` |
| Dokument-Object-Store | Privacy/Security/Procurement: Datenregion, KMS, AVV/DPA, Subprocessor | Vertrag, Region, Key-/Delete-/Restore-Evidence | `PRIVACY_PROVIDER_DOCUMENT_OBJECT_STORE` | `BLOCKED` |
| E-Mail-Provider | Privacy/Procurement: Empfänger-/Receipt-Retention, Region, DPA | Vertrag, Subprocessor, Delete-/Exportreceipt | `PRIVACY_PROVIDER_EMAIL` | `BLOCKED` |
| Payment-/Accounting-Ledger | Finance/Tax/Privacy: gesetzliche Aufbewahrung und Subject-Scope | Tax-/Accounting-Entscheid mit Zeitraum | `PRIVACY_PROVIDER_PAYMENT` | `BLOCKED` |
| Backup/Restore | Security/Privacy/Ops: Snapshot-Retention und Tombstone-Reconcile | Restore-Drill, RPO/RTO, Lösch-/Tombstone-Vertrag | `PRIVACY_PROVIDER_BACKUP` | `BLOCKED` |
| Talent-Radar-Kontakt | Swiss AVG Counsel: private Arbeitsvermittlung/Personalverleih je exaktem Flow | flowspezifischer AVG-Entscheid, Bewilligungs-/Nichtbewilligungsbegründung | exakte `ProcessingApproval` mit `avgDecisionRef` | `BLOCKED` |
| Success Fee/Paid Matching | Swiss AVG Counsel plus Tax/Finance | AVG-, Vertrags-, MWST-/Tax- und Fulfillment-Entscheid | Phase 24/31 plus exakte Paid-Flow-Approval | `BLOCKED` |
| DSFA | Privacy Owner: `REQUIRED`, begründet `NOT_REQUIRED` oder `APPROVED` | datierter Entscheid, Scope, Reviewer, Re-review | `dsfaDecision` und erforderliche Referenz in jeder Approval | `BLOCKED` |
| AVV/DPA | Legal/Procurement: Controller-/Processor-Rollen und Subprocessor | signierter Vertrag und Versionsreferenz | `dpaRef` je externem Processor | `BLOCKED` |
| Search Learning | Privacy/Data: keine Raw-/Rare-query-Reidentifikation, Retention | freigegebener Eventkatalog, Thresholds, Redactionreport | `SEARCH_LEARNING_COLLECTION` plus Approval | `BLOCKED` |

## Anforderungen an einen gültigen `ProcessingApproval`

Ein aktivierbarer Eintrag bindet exakt Scope, Region, Processor, Version,
aktuelle Legal Publication, legal basis, AVG-/DPA-/DSFA-Referenzen, benannten
Owner/Approver, effective/expiry/review und Revoke-Owner. `DRAFT`, abgelaufen,
widerrufen, falscher Hash, falsche Region oder falscher Processor schreiben
null fachliche Wirkung.

Die DB und `LegalGate`-Policy erzwingen diese Form technisch. Sie prüfen nicht,
ob ein externes Dokument materiell richtig ist. Diese Verantwortung bleibt
beim benannten Fachowner.

## Aktivierungsreihenfolge

1. Fachowner schließen und signieren Inventory-/Retention-/Hold-Matrix.
2. Drei-Aktor-Workflow veröffentlicht die exakte Legal Revision.
3. Owner erfasst je Flow×Region×Processor eine versionierte Approval.
4. QA gleicht Hash, Version, Ablauf, Revoke und negative Gates ab.
5. Moderierte Studie nach
   [`research/phase22-privacy-comprehension-protocol.md`](./research/phase22-privacy-comprehension-protocol.md)
   besteht.
6. Erst danach wird **ein** Sandbox-/kleines Cohort-Flag aktiviert.
7. Phase 23 muss autonome Retry-/DLQ-/Monitoring-Verantwortung übernehmen,
   Phase 25 reales Step-up und personell getrennte Grants.

Bis dahin sind nur Local-/CI-Sandboxtests zulässig; keine Seite, E-Mail,
Marketingaussage oder Statusanzeige darf `LIVE`, rechtsgeprüft oder
produktionsbereit behaupten.
