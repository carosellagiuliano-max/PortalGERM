# Phase 21 — Reales Dokumenten- und CV-Vault

> **Planstatus:** GEPLANT / NICHT BEGONNEN
> **Technikstatus:** NICHT IMPLEMENTIERT
> **Quality-Gate:** NICHT GELAUFEN
> **Aktivierung:** DISABLED
>
> Der aktuelle Adapter ist absichtlich metadata-only. Dieser Plan ist keine
> Aussage, dass reale Bytes, Scanner, Object Storage oder Downloads bereits
> vorhanden oder freigegeben seien.

## 1. Status in vier Dimensionen

Technische Implementierung, bestandenes Quality-Gate und Aktivierung werden
getrennt. Ein vollständiger Vault kann technisch und in Provider-Sandbox
getestet sein, während Aktivierung wegen DPA, Region, Scanner, Retention,
Phase-22-Legal-Holds, Phase-23-Worker oder Phase-25-Step-up weiterhin
`DISABLED`, `SANDBOX` oder `BLOCKED BY EXTERNAL GATE` bleibt.

## 2. Ziel und messbarer Business-/Nutzerwert

Candidate können echte CV-Bytes sicher hochladen; interne Bewerbungen
referenzieren eine unveränderliche, als sauber freigegebene Version und nur
aktuell berechtigte Employer/Recruiter können genau dieses Dokument
kurzlebig lesen. Untrusted Bytes bleiben bis zum erfolgreichen Scan in
Quarantäne.

Messbarer Zielzustand:

- 100 % neuer Objekte beginnen in `UPLOADING`/`QUARANTINED`, niemals direkt
  lesbar;
- 0 Downloads für `PENDING`, `INFECTED`, `FAILED`, abgelaufene, widerrufene,
  fremde oder orphaned Objekte;
- 100 % interner Submission-Snapshots behalten exakt ihre ursprüngliche
  `DocumentVersion`;
- 0 unbounded App-Server-Buffer und 0 orphaned personenbezogene Objekte nach
  abgeschlossenem Reconciliation-Lauf;
- alle erlaubten Dateitypen bestehen Magic-/MIME-/Scannervertrag, alle
  Polyglot-/Bomb-/Resource-Abuse-Fixtures werden fail-closed abgewiesen.

## 3. Tatsächlicher Repositoryzustand

- `lib/providers/storage/index.ts:1-21` liefert immer
  `MockStorageProvider`.
- `lib/providers/storage/storage-provider.ts:2-16` ist metadata-only,
  `getReadUrl()` liefert `null`.
- `lib/providers/storage/mock-storage-provider.ts:57-60` verwirft optionale
  Bytes; `106-118` bietet keinen Download und löscht nur prozesslokale
  Metadaten.
- `components/candidate/JobPassForm.tsx:21` begrenzt aktuell clientseitig auf
  5 MiB; `app/candidate/jobpass/actions.ts:267-304` sendet nur Dateiname,
  MIME und Größe.
- `prisma/schema.prisma:1424-1439` speichert
  `CandidateDocumentMetadata`; `2029-2042` speichert den
  `ApplicationSubmissionDocument`-Metadatensnapshot, aber keine Byteversion.
- Bestehende Mock-Storage-, Candidate-Profile- und Application-Snapshot-Tests
  schützen ehrliche Demo- und Ownership-Verträge. Es gibt keinen realen
  Storage-/Scanner-Contracttest. Für diese Planung wurde nichts ausgeführt.

## 4. Findings und Requirements

| Finding / Requirement | Verantwortung dieser Phase | Launchpriorität |
| --- | --- | --- |
| `STH-003`, `REQ-DOC-002` | echte private Bytes, Quarantäne, Scan, Version, autorisierter Download | LC1 P2; LC2 P0 sobald interne Bewerbungsbytes versprochen werden; LC3–LC6 P0 |
| Storage-Anteil `STH-004` | Object-Storage-/Scanner-Adapter und Sandbox-Gate | je aktiviertem realem Provider P0 |
| Beitrag `STH-030`, `REQ-ID-004` | Bulk-/besonders riskanter Dokumentzugriff verlangt Step-up-kompatiblen Grant; Policy-Owner bleibt Phase 25 | LC2–LC6 P0, wenn Bulk aktiviert |
| Beitrag `STH-031`, `REQ-TRUST-001` | Upload-/Download-Volumen-, Malware- und Exfiltrationssignale | LC2–LC6 P0 |
| `REQ-QA-003` | 28-Punkte-Vertrag und vollständige Matrix | alle P0 |

## 5. In Scope

- private, freigegebene Datenregion und purpose-spezifischer Object-Namespace;
- serverseitig autorisierte, kurzlebige Upload Intents;
- direkter oder streng begrenzt gestreamter Upload ohne Vollbuffer im
  App-Prozess;
- Limits vor und während des Streams: Content-Length, tatsächliche Bytes,
  Dauer, Chunk-/Requestfrequenz, Benutzer-/Tenantquota und Parallelität;
- Extension, normalisierter Name, deklarierter MIME, serverseitige Magic
  Bytes, Hash und geschlossene Purpose-Allowlist;
- Quarantäne-first State Machine, asynchroner Malware-/Policy-Scanner,
  Scan-Retry und sichere Terminalablehnung;
- Polyglot-, Parser-/Dekompressionsbomb-, malformed- und
  Ressourcenerschöpfungsabwehr;
- immutable `DocumentVersion` in internen Bewerbungen;
- single-object Read Grant mit aktueller Owner-/Tenant-/Assignmentprüfung;
- Access Audit, Version Replacement, Delete-/Export-/Hold-Hooks;
- Object↔DB-Orphan-, incomplete multipart- und Delete-Reconciliation;
- Bulk-/Exportzugriff nur hinter Phase-25-kompatiblem Step-up und separatem
  serverseitigem Flag.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- öffentliche CV-URLs, globale Employer-CV-Bibliothek und Radar-Download;
- OCR, Parsing, AI-Bewertung, Ranking oder automatische Extraktion;
- ZIP-Upload als Produktdateityp und offene MIME-/Extension-Listen;
- Firmenverifikationsdokumente vor Phase 26 mit eigenem Purpose;
- fachliche Retention-/Legal-Hold-/Erasure-Entscheidung: einzige Autorität
  bleibt Phase 22;
- autonomer Scanner-/Cleanup-Scheduler: Phase 23;
- Bulk-Download, Massenzugriff und Ops-Inhaltsansicht vor Phase 25.

Nachbarfunktionen sind API-, UI- und Worker-seitig absent oder `DISABLED`;
ein ausgeblendeter Button allein reicht nicht.

Bis `DOCUMENT_CLEAN_READS` für den konkreten Scope grün ist, bleibt der
bestehende interne Bewerbungsflow als strukturierte Bewerbung nutzbar, darf
aber weder CV-Bytes noch einen Download behaupten. Ein Job/Flow, der ein
Datei-CV zwingend voraussetzt, fällt serverseitig mit
`DOCUMENT_VAULT_UNAVAILABLE` aus und kann nicht als vollständige interne
CV-Bewerbung beworben werden.

## 7. Benutzerrollen und organisatorische Owner

| Rolle | Erlaubter Zweck | Owner |
| --- | --- | --- |
| Candidate | eigenen Upload starten/ersetzen/löschen, Status sehen | Candidate + Document Engineering |
| Employer/Recruiter | nur saubere immutable Version einer aktuell berechtigten internen Bewerbung | Employer Engineering |
| Privacy Processor | Export/Delete/Hold-Adapter über Phase-22-Case | Privacy |
| Ops | Objekt-/Scan-/Queuezustand ohne Inhalt/Dateiname | Ops |
| Security/Trust | Malware-/Volumen-/Exfiltrationssignale und Incident | Security |
| Storage/Scanner Owner | Adapter, Region, Kosten und Verfügbarkeit | Platform/Ops |

Radar Reveal erteilt niemals implizit einen Dokumentgrant.

## 8. Portale, Routen, Services, Provider und Worker

Bestehend betroffen sind `/candidate/jobpass`,
`/candidate/applications/[id]`, `/employer/applicants/[id]` und die
Privacy-Routen. Geplantes Delta, noch nicht im Ist-Routeinventar:

- Upload-Intent-/Finalize-/Abort-Handler aus JobPass;
- single-object Download-/Revoke-Handler aus der Application;
- Privacy Export/Delete/Hold Adapter ohne eigene konkurrierende Case-UI;
- redigierter Vault-/Scannerzustand unter `/admin/system`.

Services: Document Policy, Upload Intent, Finalizer, Scanner Adapter,
Read-Grant Authorizer, Lifecycle Adapter und Reconciler. Provider:
Object Store, KMS und Malware Scanner. Phase 21 liefert bounded
Scan-/Reconcile-Commands; Phase 23 betreibt sie autonom.

## 9. Datenmodelle, Constraints, Indizes und Klassifikation

ADR-032 wird vor Migration konkretisiert. Mindestens:

- `Document` als kanonische Candidate-/Purpose-Identität;
- immutable `DocumentVersion` mit opaque Object Key, Object Version,
  serverseitigem MIME, bytegenauer Größe, SHA-256, Classification,
  Key-Version und Lifecyclestatus;
- `DocumentUploadIntent` mit Actor, Purpose, erwarteter Größe/Hash,
  Ablauf, Provider-Multipart-ID und einmaligem Finalize;
- append-only `DocumentScanAttempt` mit Engine-/Signature-Version und
  redigiertem Outcome;
- `DocumentReadGrant` mit Actor, Tenant, Application, Purpose, Objektversion,
  Expiry, single-/bounded-use und Revocation;
- `DocumentAccessEvent` und `ObjectLifecycleOutcome`;
- fachliche Referenz von `ApplicationSubmissionDocument` auf genau eine
  `DocumentVersion`.

Constraints verhindern mehr als einen aktuellen Uploadintent je Purpose,
Statussprünge, cross-owner Referenzen, doppelte Finalize-/Scanwirkungen und
änderbare Submission-Versionen. Personenbezogene Dokumentbytes sind
`HIGHLY_SENSITIVE`; Object Key, Signed URL und Scan-Interna sind Secrets/
Security-sensitive.

## 10. Expand–Migrate–Contract, Backfill und Datenprüfung

1. Additive Modelle/Enums/FKs/Checks/Indizes auf leerer und realistischer DB.
2. Legacy-Metadaten explizit `METADATA_ONLY_LEGACY`; keine fiktiven Objekte,
   Hashes oder erfolgreichen Scans.
3. Dual Read zeigt Legacy ehrlich als nicht downloadbar.
4. Feature Gate aktiviert neue Uploads zuerst für TEST/Sandbox-Cohort.
5. Application Writer referenziert neue Version additiv; bestehende
   Metadatensnapshots bleiben unverändert.
6. Reconcile-Dry-run inventarisiert DB-without-object, object-without-DB,
   incomplete multipart, checksum mismatch und delete-pending.
7. Wiederholter Backfill/Reconcile ist idempotent; Count-/Hash-/Owner-/
   Tenant-/Purpose-Abgleich blockiert Cutover bei jeder Abweichung.
8. Contract alter Writepfade erst nach G3; Objektlöschung niemals als
   Migrationsrollback.

## 11. Serverlogik, Streaming, Scan, Retry und Providervertrag

- Upload Intent entsteht nur nach aktueller Candidate-Ownership- und
  Quota-Prüfung. Client-Metadaten sind untrusted.
- Bevorzugt wird ein direkter Providerupload in Quarantäne. Falls Bytes den
  App-Server passieren, werden sie mit hartem Bytecounter, Timeout,
  Backpressure und begrenztem Chunkpuffer gestreamt; nie `Buffer` des ganzen
  Dokuments.
- Finalize prüft Providergröße, Hash, Upload-ID, Owner/Purpose und
  Idempotency. Abweichung führt zu Quarantäne/Abbruch, nie zu `CLEAN`.
- Serverdetektion muss deklarierte MIME/Extension/Magic-Matrix bestätigen.
  Polyglots, verschachtelte Archive, Dekompressions-/Parserbudgetüberschreitung
  und Scanner-Timeout bleiben nicht downloadbar.
- Scanner Attempts sind retrybar und versioniert. Nur ein erlaubtes
  `CLEAN`-Outcome kann die Version freigeben.
- Read Grant prüft bei Ausstellung und Abruf aktuelle Membership,
  Application Assignment, User-/Company-/Jobstatus und Version. Signed URL
  ist kurzlebig, audience-/purpose-bound und `no-store`.
- Reconciler besitzt Lease/Dedupe, Quarantänefrist und getrennte Outcomes;
  unbekannte/orphaned Objekte werden zunächst isoliert, erst nach Policy
  gelöscht.
- Provider 429/5xx/Timeout führt zu bounded Retry; ungültige Region,
  Credentials oder Scanner-Signatur booten/arbeiten fail-closed.

## 12. UI-Zustandsvertrag

Candidate und Employer unterscheiden Empty, Uploading, Progress,
Finalizing, Quarantined, Scanning, Clean, Rejected/Infected, Scan Failed,
Retry, Conflict, Replaced, Delete Pending, Held, Expired Grant, Revoked,
Deleted, Provider Degraded und Success. Eine Datei darf vor `CLEAN` weder als
angehängt noch als herunterladbar erscheinen. Fehlertexte verraten keine
Scanner-Signatur oder Object Keys.

## 13. 360 px, Touch, Keyboard, Screenreader und Accessibility

- Upload, Abort, Replace, Retry und Download funktionieren bei 360×800 und
  200-%-Zoom;
- Progress besitzt Textwert und `aria-live`, nicht nur Farbe;
- Dropzone hat gleichwertigen Keyboard-/File-input-Pfad;
- Focus bleibt bei Statuswechsel, Fehlerzusammenfassung und Confirm-Dialog
  nachvollziehbar;
- Dateiname wird sicher gerendert, bidi/control-Zeichen werden normalisiert;
- 0 `critical`/`serious` Axe, 0 Clipping und vollständige Touchziele.

## 14. Authentisierung, Step-up, Autorisierung und Tenantgrenzen

Single Download verlangt aktuelle, serverseitige Owner-/Tenant-/Assignment-
Berechtigung und sichere 404 bei Foreign Object. Object Key, URL oder
Submission-ID ist niemals Authorization. Kandidat kann nur eigene aktive
Versionen verwalten; Employer sieht nur die eingereichte Version, nicht das
aktuelle Profil-CV.

Jeder Multi-Object-, Admin-Inhalts-, Export- oder Bulk-Grant verlangt einen
kurzlebigen actor-/session-/tenant-/purpose-/action-bound Step-up-Nachweis.
Bis Phase 25 diesen Vertrag liefert, bleibt Bulkzugriff ausserhalb isolierter
Tests serverseitig deaktiviert. Phase-22-Export nutzt seine eigene verifizierte
Privacy-Case-Berechtigung plus dieses Step-up-Gate.

## 15. Datenschutz, Zweck, Retention, Export, Löschung und Audit

Phase 21 stellt idempotente Byte-/Manifest-Export-, Hold-Abfrage-,
Delete-/Crypto-Erasure- und Lifecycle-Outcome-Adapter bereit. Phase 22 bleibt
alleinige fachliche Autorität für Retention und Legal Hold. Ohne freigegebene
Policy wird nicht gelöscht. Logs/Audit enthalten IDs/Digests nur redigiert,
keine Dateinamen, Bytes, Signed URLs, Object Keys oder Scannerpayloads.
Provider-DPA, Region und Subprozessoren sind je Objektklasse dokumentiert.

## 16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien

- falscher Content-Length, Stream über 5 MiB, Slowloris, Parallel-/Intent-
  Flood, abgebrochene Multipart-Uploads und wiederholtes Finalize;
- Traversal-/Bidi-Namen, MIME-Spoof, Polyglot, malformed PDF, Archive-/Parser-
  Bomb, Scanner-Timeout und Signature-Downgrade;
- Foreign Tenant, erratene Object-ID, geleakte/abgelaufene Signed URL,
  widerrufene Membership, suspendierter User und revoked Company;
- Massendownload/Exfiltration, Admin ohne Need-to-know, Grant Replay und
  cross-purpose Bulk-Grant;
- Objektprovider bestätigt Upload, DB-Commit scheitert beziehungsweise
  Delete gelingt nur auf einer Seite.

Phase 21 emittiert minimierte Risk-/Access-Signale; Case-/Appeal-Entscheidung
bleibt Phase 25/26.

## 17. Externe und organisatorische Voraussetzungen

Object-Storage-, Scanner- und KMS-Anbieter, AVV/DPA, CH/EWR-Datenregion,
Subprozessorliste, Malware-Signature-/Update-SLO, Security Threat Model,
zulässige Dateitypen, 5-MiB-Änderungsentscheid, Retention-/Legal-Hold-Policy,
Kosten-/Egresslimits, Incident Owner und Löschbestätigung. Jede Freigabe
braucht Owner, Version und Datum.

## 18. Harte Abhängigkeiten

- Phase 19 G0/G4-Baseline und ADR-032;
- Phase 20 für verifizierte Identität, Outbox und Notification-Hooks;
- Phase 22 vor realem Export/Erasure und für Retention/Legal Hold;
- Phase 23 vor autonomem Scan/Reconcile und Production Monitoring;
- Phase 25 vor Bulk-/Admin-Inhaltszugriff;
- Phase 26 vor Wiederverwendung für Firmenverifikation.

Der Vault-Grundvertrag darf in Sandbox vor Phase 22/23 getestet werden; reale
interne Bewerbungsbytes dürfen ohne diese Gates nicht aktiviert werden.

## 19. Geordnete Implementierungsschritte

1. Datei-/Purpose-/Threat-/Kosteninventar und ADR-032 freigeben.
2. Providerports, State Machine und additive Migration implementieren.
3. Upload Intent/Direct Stream/Finalize mit serverseitigen Limits.
4. MIME/Magic/Hash-/Polyglot-/Resource-Policy und Scanneradapter.
5. Version Replacement und immutable Application-Referenz.
6. single-object Read Grant mit zweifacher aktueller Autorisierung.
7. Export/Hold/Delete-Adapter und Object↔DB-Reconciler.
8. Bulkpfad mit Step-up-Guard implementieren, aber `DISABLED` lassen.
9. Candidate-/Employer-/Ops-UX und A11y-Zustände.
10. Migration-, Hostile-file-, Concurrency-, Provider-, E2E- und G3-Tests.
11. Sandbox-Cohort; erst nach Phase 22/23/25 gezielte Aktivierung.

## 20. Feature-/Provider-/Cohort-Flags und Aktivierungsreihenfolge

Getrennte Flags: `DOCUMENT_VAULT_WRITES`, `DOCUMENT_STORAGE_MODE`,
`DOCUMENT_SCANNER_MODE`, `DOCUMENT_CLEAN_READS`,
`DOCUMENT_RECONCILIATION`, `DOCUMENT_BULK_ACCESS` und Cohort.

Reihenfolge: additive Schema → Quarantäne-Write ohne Reads → Scanner Sandbox →
Clean Read für Testcohort → Application Snapshot → Reconciler dry-run →
Design-Partner-Allowlist. Kill Switch stoppt neue Intents/Reads oder Scanner
getrennt, bewahrt Quarantäne und fachliche Referenzen. Er löscht keine Objekte
und fällt nie auf metadata-only zurück, ohne dies als unavailable zu zeigen.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Geplante Testdateien sind vor Evidence anzulegen und mit Exit Code `0`
auszuführen.

| Criterion | Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `21-AC-01` | `STH-003`, `REQ-DOC-002` | Fake-/unbounded Upload, P0 | Unit + Provider Contract | Intent und direkter/gestreamter Upload mit Bytecounter | erlaubte Datei exakt ≤5 MiB endet quarantined mit korrektem Hash | 0 Byte, >5 MiB deklariert/tatsächlich, falscher Length, slow stream, extra chunk werden abgebrochen | Candidate | JobPass/Upload Provider | Grenzgrößen, 1-B/5-MiB/5-MiB+1, Fake Clock | jsdom + Provider Sandbox | `npx vitest run --config vitest.config.ts tests/unit/documents/document-upload-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/providers/storage/storage-provider-contract.test.ts` | 0 Fullbuffer; tatsächlich gespeicherte Bytes exakt; jeder Oversizefall 0 CLEAN/Read Grant; incomplete multipart markiert | Stream-/Memory-/Providerreport | Document + Security | PLANNED |
| `21-AC-02` | `REQ-DOC-002`, ADR-032 | Malware/Polyglot/Resource Exhaustion, P0 | Unit + Scanner Contract | geschlossene MIME/Magic/Extension/Parserbudget-Matrix | jede erlaubte saubere Fixture wird nach Scannerreceipt CLEAN | MIME-Spoof, Traversal/Bidi, Polyglot, malformed, Bomb, timeout, outdated signature bleiben quarantined/rejected | Candidate/System | Document Policy/Scanner | hash-fixierte harmlose hostile fixtures, kein reales PII | isoliert + Scanner Sandbox | `npx vitest run --config vitest.config.ts tests/unit/documents/document-content-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/providers/storage/malware-scanner-contract.test.ts`; `npx tsx scripts/phase21-storage-scanner-smoke.ts --mode=sandbox --fixture-manifest=tests/fixtures/documents/manifest.json` | 100 % Allowlistmember korrekt; 100 % hostile fixtures nicht downloadbar; Timeout bounded; Signatureversion belegt | Fixture-Hash-/Scannerreceipt | Security + Document | PLANNED |
| `21-AC-03` | `REQ-DOC-002` | Race/Statussprung, P0 | PostgreSQL Concurrency | Complete/Abort/Scan/Retry parallel | genau ein gültiger Finalize und ein terminaler Scanoutcome | doppeltes Finalize, Scan vor Complete, CLEAN→PENDING, foreign intent wirken 0 | Candidate/System | Vault/PostgreSQL | 20 parallele Clients, Fake Clock | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/documents/document-vault-races-postgres.test.ts` | exakt 1 Version; nur erlaubte State Edges; 0 Orphan-Referenzen; Retries idempotent | Transition-/Race-Manifest | Document + Data | PLANNED |
| `21-AC-04` | `STH-003`, `REQ-DOC-002` | Bewerbung mutiert nach CV-Ersatz, P0 | PostgreSQL + E2E | Upload v1 → CLEAN → Apply → Upload v2/Replace | Bewerbung referenziert weiter v1, Profil zeigt v2 | pending/infected/fremde v2 kann nicht submitted werden; Replace schreibt v1 nicht um | Candidate/Employer | JobPass/Application | Candidate, zwei Versionen, interne Jobrevision | PostgreSQL + Production Browser | `npx vitest run --config vitest.integration.config.ts tests/integration/documents/application-document-version-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase21-document-vault.spec.ts --project=chromium-journeys` | Submission-FK/Digest v1 vor/nach Replace identisch; Employer lädt genau v1 | DB-Diff, Downloadhash, Trace | Candidate + Employer | PLANNED |
| `21-AC-05` | `REQ-DOC-002`, Beitrag `REQ-ID-004` | IDOR/Exfiltration, P0 | Security + PostgreSQL | Read Grant bei Owner/Tenant/Assignment/Status/Expiry; Bulk-Step-up | zugewiesener Recruiter erhält 1 kurzlebigen single-object Grant | Foreign Employer, removed assignment, revoked membership, suspended user, expired/replayed URL und Bulk ohne Step-up: 0 Bytes | Candidate/Employer/Ops | Download Authorizer/Object Store | zwei Companies, zwei Recruiter, leaked URL, stale grant | isoliertes PostgreSQL + provider emulator | `npx vitest run --config vitest.integration.config.ts tests/integration/documents/document-access-postgres.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/security/authorized-repositories.test.ts` | positiver Grant 1 Objekt; alle Negativfälle sichere 404/403 vor Providerread; Bulkflag off 0 Grants | Access-/Provider-call-Manifest | Security + Employer | PLANNED |
| `21-AC-06` | `REQ-DOC-002`, `REQ-PRIV-004` | Orphan/PII bleibt oder falsche Löschung, P0 | PostgreSQL + Failure Injection | DB-without-object, object-without-DB, incomplete multipart, checksum mismatch, partial delete | Dry-run klassifiziert; autorisierter Reconcile repariert/quarantänisiert idempotent | Legal Hold, unklare Ownership, Provider timeout oder zweiter Run löschen nicht unzulässig | System/Privacy | Reconciler/Storage/DB | vollständige Orphanmatrix + Hold Canary | isoliertes PostgreSQL + provider emulator | `npx vitest run --config vitest.integration.config.ts tests/integration/documents/document-reconciliation-postgres.test.ts` | nach zwei Runs 0 ungeklärte aktive Orphans; Hold Canary unverändert; je Objekt 1 Outcome; Providerfehler retryable sichtbar | Before/After-Manifest | Document + Privacy + Ops | PLANNED |
| `21-AC-07` | Storage-Anteil `STH-004` | falsche Region/Config/Provider-Degradation, P0 | Provider/Sandbox | Upload, read, delete, multipart abort, KMS rotate, 429/5xx/timeout | freigegebene Sandboxregion und Checksums stimmen | bad secret/region/key, timeout und partial delete fail-closed; kein Mockfallback | System/Ops | Storage/Scanner/KMS | synthetische Dateien, Testbucket, Testkeys | Provider Sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/providers/storage/storage-provider-contract.test.ts`; `npx tsx scripts/phase21-storage-scanner-smoke.ts --mode=sandbox --scenario=upload,scan,read,delete,abort,rotate,429,500,timeout,bad-config` | alle Receipts region-/versionkorrekt; bad config Exit ≠0; 0 public objects/Secrets | Provider-/Bucketpolicy-Report | Platform + Security | PLANNED |
| `21-AC-08` | Beitrag `STH-031`, `REQ-TRUST-001` | Kosten-/Upload-/Downloadmissbrauch, P0/P1 | Security + Last | Intent/stream/scan/read velocity und Quota | normale Cohort bleibt innerhalb Budget | 100 parallele Intents, slow clients, repeated hostile files, mass download führen zu throttle/hold/signal | Candidate/Employer | Rate Store/Vault/Risk Events | definierte Actor/IP/Tenant-Lastprofile | isolierte Lastumgebung | `npx vitest run --config vitest.integration.config.ts tests/integration/documents/document-abuse-postgres.test.ts`; `npx tsx scripts/phase21-document-load.ts --uploads=100 --concurrency=25 --max-bytes=5242880` | keine OOM; bounded aktive Streams; Quota exakt; 0 unautorisierte Reads; Securityevent ohne Dateiname/Bytes | Last-/Memory-/Riskreport | Security + Ops | PLANNED |
| `21-AC-09` | `REQ-QA-002`, `REQ-QA-003` | unbedienbare Quarantäne/Fehler, P0/P1 | E2E + Mobile + A11y | Upload/Progress/Abort/Scan/Replace/Download in allen Zuständen | alle erlaubten Aktionen per Touch/Keyboard | rejected, timeout, conflict, provider degraded und expired grant verständlich/fokussiert | Candidate/Employer | Browserportale | deterministische Scanner-/Storagefixtures | Production Build Desktop/360 | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase21-document-vault-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase21-document-vault-quality.spec.ts --project=chromium-mobile-360` | 0 critical/serious Axe; 0 Clipping; 200-%-Zoom; Status nicht nur Farbe; alle States besucht | Axe-/Screenshot-/State-Report | UX + QA | PLANNED |
| `21-AC-10` | `REQ-QA-003`, ADR-032 | gefälschte Legacybytes/gebrochene Migration, P0 | Migration/PostgreSQL | leer, Legacy metadata-only, Partial Backfill, Wiederholung | Legacy bleibt nicht downloadbar; neue Versionen konsistent | keine fiktiven Hash/Scans, 0 cross-owner FK, Abbruch blockiert Cutover | System/Data | Prisma/PostgreSQL | Phase-19-Bestand mit Status-/Null-/Tenantfällen | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase21-document-vault-migration-postgres.test.ts`; `npm run db:migrate`; `npm run db:migrate:status` | Exit 0; 100 % Legacy `METADATA_ONLY_LEGACY`; 0 erfundene Objects; Wiederholung 0 Duplicates | Migration-/Countmanifest | Data + Document | PLANNED |
| `21-AC-11` | `REQ-QA-001`, `REQ-QA-003` | Regression Apply/Tenant/Privacy, P0 | G3 bei Byte-Cutover | Owning- und Alt-Suites vollständig | Repository-Gate auf identischem Commit | Skip/Retry/anderes Artefakt blockiert | alle | Repository/Portale | deterministischer Seed | Clean Clone, PostgreSQL 16, Production Browser | nacheinander `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e:http`, `npm run test:e2e:browser`, `npm run test:e2e:hsts` | alle Exit 0; Retry 0; keine unerklärten Skips; gleicher Commit/Digest | G3-Manifest | QA | PLANNED |

## 22. Performance-, Query-, Queue-, Datei-, Latenz- und Lastgrenzen

- Bestehendes Initiallimit bleibt 5 MiB je CV, bis ein versionierter
  Security-/Productentscheid es ändert; Server prüft deklariert und real.
- Upload Intent TTL höchstens 10 Minuten, Read Grant standardmässig höchstens
  60 Sekunden und auf ein Objekt/Purpose begrenzt.
- Bei App-Streaming ist Chunkpuffer ≤1 MiB und Peak-Heapzuwachs je Stream
  ≤8 MiB; bevorzugter Direct Upload transportiert keine Bytes durch Next.js.
- maximal 3 gleichzeitige Uploads je Actor und konfigurierbares Cohort-/Tenant-
  Speicherbudget; 25-Client-Referenzlast darf keine OOM/Pool-Erschöpfung
  erzeugen.
- Scanner besitzt Byte-/Parser-/Wallclockbudget; Sandbox p95 bis terminalem
  Outcome ≤120 s, sonst `SCAN_FAILED`, nie `CLEAN`.
- Reconciler arbeitet in Batches ≤100 mit Dry-run, oldest-age und
  provider-call Budget. Productionwerte/Unit Cost werden Phase 23 bestätigt.

## 23. Geschützte Phase-01–18-Invarianten und Owning-Regressionen

```powershell
npx vitest run --config vitest.config.ts tests/unit/providers/storage/mock-storage-provider.test.ts tests/unit/privacy/reveal-dto.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/candidate/profile-postgres.test.ts tests/integration/candidate/applications-saved-jobs-postgres.test.ts tests/integration/employer/applications-postgres.test.ts tests/integration/security/authorized-repositories.test.ts tests/integration/privacy/talent-radar-reveal-postgres.test.ts
npx playwright test --config=playwright.config.ts tests/e2e/flows/phase17-journeys.spec.ts tests/e2e/flows/phase17-talent-radar.spec.ts --project=chromium-journeys
```

Geschützt bleiben Metadaten-Mockehrlichkeit in LC1, Candidate Ownership,
Required-document-Contract, immutable Application Confirmation/Snapshot,
Employer Assignment/Tenant, sichere 404 und Radar-Anonymität/-Reveal ohne
automatisches Dokumentrecht.

## 24. Rollback oder Roll-forward-only

Schema/Flags sind vor Read-Cutover rückschaltbar. Bereits gespeicherte Bytes,
extern erteilte URLs, Scanreceipts oder referenzierte Submission-Versionen
werden nie per DB-Rollback „entfernt“. Kill Switch stoppt neue Intents/Reads,
erhält Quarantäne und startet Reconciliation. Nach Object-Contract gilt
Roll-forward mit manifestierter Checksummigration; Löschung folgt Phase-22-
Policy und Restore-Schutz.

## 25. Benötigte Evidence und Artefakte

Der Phase-21-Record enthält Commit/Digest, Schema-/Backfill-/Orphan-Counts,
Dateityp-/Limit-/Hostile-Fixture-Manifest samt Hash, Memory-/Stream-/Lastreport,
Scanner-/Storage-/KMS-Receipts, Region/DPA/Bucketpolicy, Transition-/Race-
Manifest, Access-/Tenantmatrix, Downloadhash, Reconciliation-Dry-run/Apply,
Mobile/A11y, Flags/Kill-Switch und gegebenenfalls G3. Keine Bytes, Dateinamen,
Object Keys, Signed URLs oder Scannersecrets in Git.

## 26. Definition of Done für Technik und Quality-Gate

`TECHNISCH ABGESCHLOSSEN` verlangt Quarantäne-Vault, Streaminglimits,
Provider-/Scannervertrag, immutable Versionen, single-object Authorization,
Lifecycle-Hooks und Reconciler. `BESTANDEN` verlangt `21-AC-01` bis
`21-AC-11` auf einem Commit; bei Umstellung interner Bewerbungen auf Bytes ist
G3 zwingend. Bulk bleibt trotz technischer Guard-Implementierung `DISABLED`,
bis Phase 25 Step-up bestanden hat.

## 27. Gate für abhängige Folgephasen

Phase 22 darf reale Dokumentbytes erst exportieren/löschen, wenn AC-06 und der
kanonische Lifecycle grün sind. Phase 23 übernimmt nur bounded/idempotente
Scan-/Reconcile-Commands. Phase 26 darf den Vault erst nach neuem
Verification-Purpose, eigener Retention und erneuter Tenant-/Step-up-Matrix
verwenden. Keine Folgephase darf Object Keys zur Autorisierung machen.

## 28. Ausdrücklich nicht bewiesene Aussagen und Referenzen

Nicht bewiesen sind LIVE-Storage/Scanner, Virenfreiheit aller denkbaren
Dateien, OCR/Parsing, unbegrenzte Skalierung, Production-Retention, Bulk-
Zugriff, autonome Verarbeitung oder Erasure. Ein `CLEAN`-Receipt reduziert
Risiko, garantiert aber keine semantische Harmlosigkeit.

Verbindlich ergänzend gelten
[`remediation-execution-contract.md`](./remediation-execution-contract.md),
ADR-032/033/034/036 in [`decisions.md`](./decisions.md),
[`requirements-matrix.md`](./requirements-matrix.md),
[`remediation-traceability.md`](./remediation-traceability.md) und
[`route-role-matrix.md`](./route-role-matrix.md).
