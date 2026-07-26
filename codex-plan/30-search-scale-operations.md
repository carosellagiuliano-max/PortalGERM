# Phase 30 — Search Quality, Search Learning, Scale und Job Freshness

> **Planstatus: GEPLANT. Technikstatus: NICHT IMPLEMENTIERT. Quality-Gate:
> NICHT GELAUFEN. Aktivierung: DISABLED.** Vier getrennt evidenzierte Tracks
> verhindern falsche Prioritäten: 30A Search Quality, 30B triggerbasierte
> Read-/Queue-Skalierung, 30C triggerbasierte Sitemap-Kapazität und 30D
> Job-Freshness/Anti-Ghosting. Ein Trackabschluss hakt die Gesamtphase nicht
> pauschal ab.

Es gilt
[`remediation-execution-contract.md`](./remediation-execution-contract.md)
vollständig.

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Track | Status | Aktivierungspriorität |
|---|---|---|
| 30A Search Quality | geplant nach Phase 19 + frühem 31A-Korpus | P0 für jeden tatsächlich aktivierten Cluster in LC3–LC6 |
| 30B Scale | `DEFERRED / MONITORED` bis Trigger | P3; P1 ab 70-%-/Budgetwarnung, P0 vor Unerreichbarkeit/LC6 |
| 30C Sitemap | `DEFERRED / MONITORED` bis Trigger | P3 unter Trigger; Eskalation gemäss Capacity-Matrix |
| 30D Freshness | geplant | P1 bei LC2 mit realen Jobs; P0 für LC3–LC6 |

Technik ist in allen Tracks nicht implementiert, Quality-Gates sind nicht
gelaufen und Aktivierung ist `DISABLED`.

### 2. Ziel und messbarer Nutzer-/Businesswert

- 30A findet fachlich gleiche Schweizer Berufe, Standorte, Qualifikationen,
  Zertifikate, Skills und Branchenvarianten konsistent über Search, Alerts,
  Preferences, Recommendations und Matching.
- 30B macht autorisierte Fälle vollständig erreichbar und hält
  Recommendation-/Adminreads innerhalb fester Query-/p95-Budgets.
- 30C verhindert Sitemap-Ausfall durch gemessenen Headroom und baut Shards nur
  rechtzeitig bei realem Bedarf.
- 30D hält öffentliche Jobs aktuell, ermöglicht „besetzt“/Reconfirmation,
  priorisiert Kandidatenhinweise und entfernt stale/duplizierte Jobs
  konsistent aus allen Downstream-Consumern.

### 3. Tatsächlicher Repositoryzustand

- `STH-019`: Akzent-/Substringsuche existiert, aber keine kontrollierte
  versionierte Berufs-/Standort-/Qualifikationsontologie; Alert,
  Recommendations und Matching teilen den Vertrag nicht.
- `STH-020`: Adminreads besitzen Caps 100–250; Fälle dahinter können
  unerreichbar werden.
- `STH-021`: Candidate Recommendations hydrieren bis zu 48 Einzelprojektionen
  für sechs Ergebnisse.
- `STH-027`: die einzelne Sitemap fällt über 50.000 URLs kontrolliert
  fail-closed aus; kein stilles Abschneiden, aber noch kein LIVE-Monitoring.
- `STH-032`: Ablauf/Public Eligibility existiert, Reconfirmation,
  „besetzt“-Signal, Candidate-Freshness-Report und Inhaltsdublettenvertrag
  fehlen.
- `STH-036`: privacy-arme Result-count-Buckets einschliesslich Nulltreffer
  existieren bereits. Es fehlen redigierte Unknown-Term-Aggregate,
  Mindestmengen/Retention und der kontrollierte Review→Taxonomy-Lifecycle.

### 4. Findings und Requirements

- `STH-019`, `STH-020`, `STH-021`, `STH-027`, `STH-032`, `STH-036`.
- `REQ-MKT-001/002`, `REQ-DATA-001`, `REQ-ADM-001/002/003/005`,
  `REQ-QA-001/002`, `REQ-OPS-002`.
- Neu:
  - `REQ-SRCH-030A-001` gemeinsamer versionierter Concept-Vertrag;
  - `REQ-SRCH-030A-002` privacy-sicherer Search-Learning-Loop;
  - `REQ-OPS-030B-001` vollständige bounded Pagination/Bulk;
  - `REQ-SEO-030C-001` mess-/triggerbasierte Sitemap;
  - `REQ-JOB-030D-001` Reconfirmation-/Freshness-Vertrag.

### 5. In Scope

- **30A:** immutable Concepts/Aliases für Occupation, Location,
  Qualification, Certificate, Skill und Industry; kontrollierte de-CH-
  Varianten, Tippfehler, Abkürzungen und Beziehungen; gemeinsame Auflösung und
  versionierte Ranking-/Cursor-/Alert-/Cluster-V2-Verträge.
- Getrennte Pflege- und Engineering-Discovery-Korpora aus Phase 31A. Für den
  exakt einen `SELECTED`-Cluster ist vollständiges Fachreview plus
  Releasebenchmark verbindlich. Das `DISCOVERY_ONLY`-Korpus bleibt
  versioniert, getrennt und durch einen Negativtest nicht aktivierbar; vor
  einer späteren Expansion benötigt es ein neues aktuelles Vollreview.
- Privacy-safe unknown/zero-result learning: request-lokale Rohquery,
  Redaction, Concept-/Filter-/Resultbucket, k-anonyme Aggregate, Review,
  Taxonomieänderung, Re-evaluation und Audit.
- **30B:** Keyset-Pagination, serverseitige Filter/Counts, capability-
  gebundene Bulk/Export-Teilfehler, Recommendation Batch/Projection.
- **30C:** Counts/Bytes/Laufzeit/Wachstum/Forecast/Alerts; Index/Shards nur bei
  Trigger.
- **30D:** Reconfirmation, Erinnerungen, Filled/Closed, Candidate Report,
  Exact-/Near-Duplicate, stale hold/review, downstream Eligibility.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

- Kein opaque ML-/Embedding-Big-Bang, keine automatische Berufs- oder
  Kandidatenentscheidung, kein ungeprüftes Sprach-/Cluster-Rollout.
- Keine rohe personenbezogene Querypersistenz, keine unbounded Adminexports.
- Kein Sitemap-Sharding ohne Trigger.
- Candidate-Freshness-Reports entfernen nicht unreviewed dauerhaft einen Job;
  sie erzeugen einen priorisierten, SLA-gebundenen Review und fail-closed Hold
  bei SLA-Bruch.
- Kein Engineering-Claim ohne eigenes grünes Korpus; nicht freigegebene
  Cluster bleiben Public/SEO/Paid-Acquisition gesperrt.

### 7. Rollen und Owner

Public/Candidate sucht und meldet stale Jobs. Employer Owner/Admin bestätigt,
markiert besetzt und beantwortet Dubletten. Taxonomy/Search Owner und
Berufsfachpersonen reviewen Concepts/Korpora. Content/Moderation prüft
Mehrdeutigkeit/Dubletten/Freshness. Adminpersonas nutzen nur ihre Capabilities.
SEO/Ops besitzt 30C; DB/Performance Owner 30B; Privacy Owner `STH-036`.

### 8. Portale, Routen, Services und Worker

- `lib/search/**`, `lib/jobs/public-read-model.ts`,
  `lib/candidate/job-alerts.ts`, `lib/candidate/dashboard.ts`,
  `lib/scoring/match-score.ts`.
- Public Search/Cluster/Job, Candidate Alerts/Preferences/Recommendations,
  Employer Jobs, Admin Taxonomy/Queues/Moderation, Sitemap.
- Geplant: Taxonomy-Release-/Reviewservice, Search-Learning-Aggregator,
  Recommendation Batch, gemeinsame Admin-Cursor-Primitives,
  Freshness-/Duplicate-Service.
- Worker Phase 23: Alert dispatch, aggregate rollup, Reconfirmation reminder/
  due, stale review SLA und Sitemap monitor. Public GET bleibt side-effect-free.

### 9. Datenmodell, Constraints, Indizes und Klassifikation

- `SearchConcept` mit unveränderlicher ID, `type`, Locale, Status und Release;
  typisierte `SearchAlias`-Quelle/Reviewer/Gültigkeit; versionierte Relationen
  zwischen Occupation/Qualification/Certificate/Skill/Industry/Location.
- Explizite Job-/Preference-Zuordnung; Originaltexte bleiben für Anzeige/Audit.
  Reporting-`OccupationCode` wird nur über freigegebenes Mapping verbunden.
- `SearchPolicyRelease`, `TaxonomyRelease`, `RankingRelease`,
  `SavedSearchSnapshot`, optional Candidate-owned Recommendation Projection.
- `SearchLearningAggregate`: keine rohe Query; Concept-/redigierter
  Tokenbucket, Filterfingerprint, Resultbucket, Locale, Tagesfenster,
  k-threshold, Retention und Release-Outcome.
- `ClusterLaunchAssessmentV2` bindet Query-Set/Top-K-Judgments und alle
  Releases; V1-Approval autorisiert V2 nie.
- `JobFreshnessProjection/Event/Report`: dueAt, lastConfirmedAt, state,
  source/reason, review SLA; Exact-Duplicate-Fingerprint unique im zulässigen
  Company/Source-Scope, Near-Duplicates nur Reviewsignal.
- GIN/Trigramm/FTS-, Concept-, Cursor-, Queue- und DueAt-Indizes nach
  EXPLAIN-/Lockmessung.

### 10. Expand–Migrate–Contract und Backfill

- Extensions/Tabellen/Indizes additiv und mit Staging-Lockbudget.
- Jobs, Preferences und Alerts deterministisch einem Concept-Release zuordnen;
  mehrdeutig/unmatched bleibt sichtbar und wird nicht geraten.
- Dual Read/Shadow Query; gespeicherte Alerts bleiben unter alter Policy
  lesbar oder werden mit Preview/Dispatch-Parität migriert.
- Freshness-Projektion wird für bestehende LIVE Jobs aus
  `publishedAt/expiresAt` backgefüllt; kein stilles sofortiges Stale-Hiding
  ohne angekündigten Cohort-Cutover.
- Count/Checksum/Orphan/Tenant/Version prüfen; Reindex/Backfill resumable.

### 11. Serverlogik, Queue und Provider

- Ranking: exact Concept/Label → freigegebener Alias → kontrollierter Typo →
  FTS/sonstige Felder. Relevanz vor Boost; Cursor bindet alle Releaseversionen.
- Search, Alert Preview/Dispatch, Preference, Recommendation und Matching lösen
  dieselben Concept-IDs; zusätzliche Rankingfaktoren sind separat erklärt.
- Rohquery lebt nur request-lokal. Vor Aggregation: Längen-/Zeichenlimit,
  PII-/Secret-Redaction, allowlisted Normalisierung und k-Anonymität. Niedrige
  Buckets werden verworfen/zusammengefasst, nie breit sichtbar.
- 30B filtert vor Cursor; Bulk ist bounded/idempotent und liefert pro Item
  Erfolg/Denial/Conflict mit Audit.
- `JOB_FRESHNESS_POLICY_V1` als Planungshypothese: Reconfirmation spätestens
  30 Kalendertage nach Publish/letzter Bestätigung oder früher am
  `expiresAt`; Reminder 7 Tage und 24 Stunden vorher. Am Due-Instant verliert
  der Job Public Eligibility fail-closed, bis er bestätigt/reviewt ist.
- Employer „besetzt“ schliesst sofort. Ein authentifizierter
  Candidate-Report erzeugt priorisierten Review; nach überschrittenem
  vierstündigem Betriebs-SLA wird der Job bis Entscheidung fail-closed gehalten.
  Exact Duplicate blockiert Publish; Near Duplicate verlangt Review.

### 12. UX-Zustände

Search/Queues/Bulk/Freshness besitzen Loading, Empty/Zero, End-of-list,
Locked/Cluster closed, Pending/Review, Error, Retry, Conflict/Release changed,
Expired/Stale, Cancelled/Closed/Filled und Success. Zero Result bietet sichere
Alternativen ohne falsche Synonymverbreiterung. Employer sieht Due/Reminder/
Bestätigung; Candidate erhält Reportbestätigung ohne Moderationsdetails.

### 13. Mobile und Accessibility

Searchfilter werden Drawer, Hauptaktionen bleiben bei 320/360 px sichtbar.
Admin Pagination/Bulk und Freshness Review verwenden das Phase-29-Cardpattern.
Concept-/Dubletten-/Reportzustände sind keyboard- und screenreaderbedienbar.
Keine Bedeutung nur durch Farbe; Error-/Result-Counts werden angekündigt.

### 14. Authentisierung, Autorisierung und Tenant

Public Index enthält nur freigegebene Public-Felder. Candidate Recommendations
bleiben owner-scoped. Taxonomy Publish/Revoke, Bulk/Export und Freshness Review
benötigen benannte Phase-25-Capabilities und Step-up nach Risiko.
Employer bestätigt nur eigene Jobs; Candidate reportet nur sichtbare Jobs,
rate-limited. Cursor ist signiert sowie an Filter/Sort/Capability/Release
gebunden.

### 15. Datenschutz, Retention, Export, Löschung und Audit

- Keine Rohqueries, PII, Tokens oder Nachrichtentexte in Search Learning,
  Analytics, Logs oder Evidence.
- Aggregate werden nur ab `k ≥ 10` pro freigegebenem Tages-/Clusterbucket
  sichtbar; Roh-/Redaction-Working-State höchstens 30 Tage restricted,
  anonyme Aggregate gemäss Phase-22-Matrix.
- Taxonomy Review/Aktivierung/Revoke und Freshness/Duplicate-Entscheidung sind
  auditiert. Candidate Reports sind Need-to-know, export-/deletefähig und
  nicht öffentlich.
- Sitemap/Index enthält nie private, DEMO, expired, stale, revoked oder
  cluster-gesperrte Ressourcen.

### 16. Abuse-, Fraud- und Missbrauchsszenarien

Keyword Stuffing, Alias Poisoning, Query-PII/Secrets, Cursor-Manipulation,
Bot-Zero-Result-Spam, Bulk-Privilege-Eskalation, gefälschte Freshness-Reports,
konkurrierende Reconfirm/Filled-Aktionen, duplizierte/geklaute Inserate und
kompromittierte Firmenkonten. Rate-/Volume-Limits, Reviewer Separation,
Provenienz und `STH-031`-Riskqueue sind Pflicht.

### 17. Externe und organisatorische Voraussetzungen

Product/Search/Taxonomy Owner; Pflegefachpersonen für Pflichtkorpus;
Engineeringfachpersonen nur bei Engineering-Target; Privacy Owner für
Search-Learning; Ops/SEO Zugriff auf Zielumgebung/Search Console; Moderations-
und Freshnesskapazität aus `STH-034`. Recall/Precision/Latenz und Corpus-
Judgments werden vor Shadowresultaten eingefroren.

### 18. Harte Abhängigkeiten

- 30A: Phase 19 plus 31A-Query-/Judgment-Korpus; Alert-Cutover mit Phase 20
  sequenzieren; Abschluss vor Clusteraktivierung und finaler Phase-29-Search-UX.
- 30B: Phase 19, Phase 22 Export/Analytics, Phase 23 Monitoring, Phase 25
  Capabilities und ausgelöster Volume/Query/p95-Trigger.
- 30C: Messbaseline nach 19, Alerts/Runbook nach 23; Shards nur bei Trigger.
- 30D: Phasen 20/23 für Reminder/Worker, 25 für Reviewcapabilities, 26 für
  Trustwirkung und 31A für Operationskapazität.

### 19. Geordnete Implementierungsschritte

#### 30A

1. Cluster/Locale und Pflege-/optional Engineering-Korpus einfrieren.
2. Concept-/Alias-/Relation-/Release-ADR und additive Migration.
3. Job-/Preference-/Alert-Zuordnung plus Mehrdeutigkeitsqueue.
4. Resolver, Ranking, Cursor, Search/Alert/Recommendation/Matching-Parität.
5. Search-Learning Redaction/Aggregation/Review/Release-Feedback.
6. Cluster V2, Shadow/Canary, Golden/Negative/Load und G3.

#### 30B

1. Triggerwerte und Istmessung dokumentieren.
2. Recommendation Batch/Projection mit Freshness.
3. gemeinsame Keyset-/Filter-/Count-Primitives.
4. Queueweise Migration, Bulk/Export, Load/Soak und G3.

#### 30C

1. Count/Bytes/Laufzeit/Wachstum/Forecast/Alert/Owner.
2. Unter Trigger `DEFERRED / MONITORED`.
3. Ab Trigger Index/Shards, >50k-/Byte-/Eligibility-Test und Cutover.

#### 30D

1. Freshness-/Duplicate-/Report-Policy und SLA freigeben.
2. Projektion/Event/Report additiv migrieren.
3. Employer Reconfirm/Filled, Candidate Report und Reviewqueue.
4. Worker/Reminder/Due/Hold und alle Consumer auf eine Eligibility.
5. Failure/Concurrency/E2E/Moderation/Support-Gate.

### 20. Feature-Flags, Kill Switch und Aktivierung

Getrennte Release-/Cohort-Gates für Search Policy, Learning, Admin Pagination,
Recommendation Projection, Sitemap Shards und Freshness. Reihenfolge:
Shadow→Canary→ein Cluster/eine Queue→voller freigegebener Scope.
Taxonomie-/Freshness-Kill-Switch schliesst den betroffenen Cluster/Job
fail-closed; er darf nicht auf bekannte False-Zeros oder stale Jobs
zurückrollen. Search Learning kann ohne Auswirkung auf Resultate gestoppt
werden.

### 21. Akzeptanzkriterien und vollständige Testmatrix

- `AC-30-01`: Pflege-Golden/Negative-Korpus ist fachlich grün.
- `AC-30-02`: Engineering besitzt ein eigenes, getrenntes Korpus; ohne
  `SELECTED`-Entscheid und Vollreview bleibt es deaktiviert.
- `AC-30-03`: Location/Qualification/Certificate/Skill/Industry sind im
  gemeinsamen Concept-Vertrag und erzeugen keine False-Broadening.
- `AC-30-04`: Search/Alert/Preference/Recommendation/Matching sind release-
  und concept-paritätisch.
- `AC-30-05`: Search Learning speichert keine rohe/identifizierende Query und
  schliesst den Review→Release→Re-evaluation-Loop.
- `AC-30-06`: Cluster V2 akzeptiert nur fachliche Top-K-Evidence.
- `AC-30-07`: 30B läuft nur ab Trigger und beseitigt Caps/Fan-out.
- `AC-30-08`: 30C misst immer; Shards nur bei Trigger.
- `AC-30-09`: Reconfirmation/Filled/Reports/Duplicates sind deterministisch.
- `AC-30-10`: stale/filled/duplicate/revoked wirkt in allen Consumern.

| Criterion / Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC-30-01 / STH-019 | P0 aktiver Cluster | Unit/Golden + fachlich | Pflegefachkraft/Pflegefachperson/Dipl. HF/FaGe/Typo | must-find und Ranking stimmen | Pflegehilfe/Reinigung/falsche Qualifikation must-not-find | Public/Candidate | Search Resolver | versioniertes Pflege-Korpus | Unit + Fachreview | `npx vitest run --config vitest.config.ts tests/unit/search/phase30-pflege-golden.test.ts`; danach signiertes Fachreview des unveränderten Corpus-Digests | 100 % Must-find/-not; kein bekannter False-Zero; eingefrorene Recall@10/Precision@10-Schwelle erreicht | JUnit + Corpusdigest + Review | Search + Pflegefachowner | PLANNED |
| AC-30-02 / STH-019 | P0 iff Engineering aktiv; sonst P1 Discovery-Gate | Unit/Golden + fachlich | separates Engineering-Korpus und `DISCOVERY_ONLY`-Sperre | eigenes Korpus/Digest; bei `SELECTED` freigegebene Titel/Qualifikationen relevant | Pflegekorpus/Marketingalias/fachfremder Engineer oder `DISCOVERY_ONLY` aktiviert keinen Engineering-Cluster | Public/Candidate | Search | separates Engineering-Korpus, Selection off/on | Unit + Fachreview | `npx vitest run --config vitest.config.ts tests/unit/search/phase30-engineering-golden.test.ts` | Digest verschieden von Pflege; ohne `SELECTED`+Vollreview Public/SEO/Acquisition 0; bei Aktivierung gleiche Must-find/-not-/Recall-/Precision-Schwellen wie Pflege | JUnit + Corpusdigest + Flag/Review | Engineeringfachowner | PLANNED |
| AC-30-03 / REQ-SRCH-030A-001 | P0 | Unit + PostgreSQL | Zürich/Zuerich/Züri/ZH; HF/EFZ; Zertifikate, Skills, Branchen | Conceptauflösung/Filter korrekt | Mehrdeutigkeit, falsche Qualifikation/Branche und Aliascycle fail-closed | Public/Candidate | Resolver/DB | positive/negative Dimensionpairs | PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/search/search-dimension-contract.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/search/search-dimensions-postgres.test.ts` | 100 % Corpusurteile; Aliascycles/unknown release 0 Treffer/Activation | Reports + Query samples | Search/Taxonomy | PLANNED |
| AC-30-04 / STH-019/021 | P0 | PostgreSQL | identische Query/Filter/asOf über fünf Consumer | gleiche Concept-/Eligibilitymenge | Release mismatch, old cursor, revoke/expiry, Alert-task-only drift | Public/Candidate | Search/Alerts/Prefs/Recs/Match | 48 Jobs, two releases | PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/search/search-v2-parity-postgres.test.ts` | Mitgliedschaft 100 % identisch; Rec Querycount ≤8; alte Cursor kontrolliert neu | DB/Query-count report | Search + Candidate | PLANNED |
| AC-30-05 / STH-036 | P1 | Privacy/PostgreSQL | unknown/zero query→redaction→aggregate→review→release | k-anonymer Bucket wird actionable | Name/E-Mail/Telefon/Token, k<10, Botspam nie sichtbar/persistiert | Public/Candidate, Taxonomy Admin | Learning pipeline | PII canaries, 9/10 threshold | PostgreSQL + Fake Clock | `npx vitest run --config vitest.integration.config.ts tests/integration/search/search-learning-postgres.test.ts` | rohe Queryspalten 0; k=9 hidden, k=10 visible; TTL exact; Releaseaudit genau 1 | Canary scan + aggregate/report | Privacy + Search | PLANNED |
| AC-30-06 / STH-018/019 | P0 | Unit/PostgreSQL | Cluster V2 79/80 %, release binding | 80 % nur mit relevanten Top-K | V1 approval, Location-only, `Stellen`, DEMO, mismatch denied | Product/Ops | Cluster Launch | V1/V2, live/demo, judgments | PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/seo/cluster-launch-v2.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/admin/cluster-launch-v2-postgres.test.ts` | 79 % fail; 80 % pass nur bei allen gebundenen Releases/Approvals | Assessment manifest | Product/Ops approvers | PLANNED |
| AC-30-07 / STH-020 | P1/P0 Trigger | PostgreSQL/Load | >250 je Adminqueue, Filter vor Cursor | jede erlaubte Zeile exakt einmal | Cursor tamper, cross-filter, concurrent insert, hidden cap | Adminpersonas | Admin repositories/UI | 501 Rows je Queue | PostgreSQL/Load | `npx vitest run --config vitest.integration.config.ts tests/integration/admin/phase30-pagination-postgres.test.ts` | 501/501 unique; 0 Lücken/Dubletten; page size ≤100; p95 ≤400 ms | Cursor/count/EXPLAIN report | Admin + DB Owner | PLANNED |
| AC-30-07 / STH-021 | P1/P0 Trigger | PostgreSQL/Performance | 48 Recommendation candidates | gleiche sechs erlaubte Ergebnisse | private/stale/revoked row, N+1 regression | Candidate | Dashboard projection | 48 Jobs, canary revisions | PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/candidate/phase30-recommendations-postgres.test.ts` | Querycount ≤8; p95 ≤300 ms; Foreign Canary 0 | Query instrumentation | Candidate/DB Owner | PLANNED |
| AC-30-07 / REQ-OPS-030B-001 | P1/P0 Trigger | Security/PostgreSQL | Bulk 100 Items mit Teilfehlern | erlaubte Items genau einmal | fremde Capability/Tenant, stale version, Replay | Adminpersonas | Bulk/Export | mix valid/denied/conflict | PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/admin/phase30-bulk-postgres.test.ts` | ≤100/Request; per-item Result; denied Writes 0; Retry keine Doppelwirkung | Audit/DB diff | Security/Admin | PLANNED |
| AC-30-08 / STH-027 | P3 | Unit/Ops | Counts/Bytes/Runtime/7/30/90 forecast | unter Trigger monitored | missing run, timeout, 70/80/90 threshold alerts | SEO/Ops | Sitemap monitor | resource counts/growth | production-like | `npx vitest run --config vitest.config.ts tests/unit/seo/sitemap-capacity-monitor.test.ts`; Ops-Runbook mit Zielumgebungsmanifest | Count/Bytes exakt; Alerts an 70/80/90; Owner/last success vorhanden | Capacity manifest + Alert receipt | SEO/Ops | PLANNED |
| AC-30-08 / STH-027 | P0 iff trigger | Load/Contract | >50.000 eligible URLs | jede exakt einmal in validen Shards | private/demo/stale/revoked, Byte/count overflow, duplicate/missing | Crawler/Ops | sitemap index/shards | >50k synthetic LIVE | PostgreSQL + HTTP | `npx vitest run --config vitest.integration.config.ts tests/integration/seo/sitemap-shards-postgres.test.ts && npm run test:e2e:http` | je Shard <50k und Bytebudget mit 10 % Headroom; union exakt eligible set | XML validation + set diff | SEO/Ops | PLANNED |
| AC-30-09 / STH-032 | P0 LC3+ | Unit/PostgreSQL | publish→remind→reconfirm/due; Filled immediate | Bestätigung verlängert Policyfenster | stale version, no confirm, compromised actor, boundary replay | Employer/System | Employer Jobs/Worker | fixed clock, two companies | PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/jobs/job-freshness-policy.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/jobs/job-freshness-postgres.test.ts` | Reminder genau bei -7d/-24h; Due-Instant public false; retry 1 event; Filled sofort false | Clock/Event/Eligibility report | Jobs + Ops | PLANNED |
| AC-30-09 / STH-031/032 | P0 | PostgreSQL/Security | candidate stale report + exact/near duplicate | Reviewcase/SLA/fingerprint korrekt | report spam, Company B, copied content/source-id, false-positive near duplicate | Candidate, Employer, Moderator | Public Job/Admin Queue | reporters, duplicate fixtures | PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/jobs/job-freshness-abuse-postgres.test.ts` | exact duplicate publish 0; near duplicate review only; SLA breach public false; reporter PII hidden | Risk/Queue/Audit report | Trust/Moderation | PLANNED |
| AC-30-10 / REQ-JOB-030D-001 | P0 | PostgreSQL + E2E | stale/filled/revoked über Search, Alerts, Recommendations, Matching/Radar, Feed, Export, Sitemap und Analytics | überall am identischen `asOf` ausgeschlossen | ein Consumer bleibt sichtbar, exportiert oder versendet noch | Public/Candidate/Employer/Crawler/System | alle Job-Consumer | ein Job in allen Freshness-/Trust-Zuständen | PostgreSQL + Chromium | `npx vitest run --config vitest.integration.config.ts tests/integration/jobs/job-freshness-consumers-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase30-freshness.spec.ts --project=chromium-journeys` | Consumer-Set-Diff 0; nach Due 0 neue Alerts/Recommendations/Matches/Radar-Treffer/Feed-/Exportzeilen/Sitemap-URLs; Analytics klassifiziert ihn ineligible | DB-Set-Diff + Playwright | Jobs/Search/SEO/Data | PLANNED |
| AC-30-01–10 | G3 je Track | Full Regression | unveränderlicher Trackcommit | alle owning/global Gates grün | Skip/Retry/anderer Commit rot | alle | Repository | isolierte DB/load fixtures | CI/PostgreSQL 16 | `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e:http && npm run test:e2e:browser` | Exit 0; Fail/Skip/Retry 0 | Track-Evidence + SHA | Release Owner | PLANNED |

### 22. Performance- und Skalierungsgrenzen

- 30A: Search p95 ≤300 ms und p99 ≤600 ms bei 50.000 public Jobs im
  vereinbarten PostgreSQL-16-Harness; Corpus-Recall@10/Precision@10 wird vor
  Shadowresultaten eingefroren, Mindest-Clustercoverage bleibt ≥80 % mit
  mindestens fünf relevanten Top-K-Stellen je beworbener Kombination.
- 30B-Trigger: irgendeine Queue ≥70 % ihres aktuellen Caps, p95 >400 ms,
  Recommendation Querycount >20 oder 90-Tage-Prognose bis zum Cap. Vor 100 %
  muss die betroffene Migration abgeschlossen sein. Querycount-Ziel ≤8.
- 30C: unter 70 % Count/Byte `P3`; ab 70 % planen, vor 80 % deployen, ab
  90 %/Capacity-/Byte-/Timeout-/p95-Fehler Expansion stoppen.
- 30D: vierstündiges Review-SLA ist eine Operationshypothese und muss durch
  `STH-034`-Kapazität belegt werden; sonst wird der Reportpfad enger allowlisted.

### 23. Geschützte Phase-01–18-Invarianten

Public Eligibility, global korrektes Ranking vor Pagination, Boost nur hinter
Relevanz und ohne Scoreeffekt, signed Cursor ohne Lücken/Dubletten, Alert
Delivery/Dedupe, Candidate Privacy, Admin Capability, Cluster Dual Approval,
Sitemap no-truncation/fail-closed und Job Publish/Expiry. Owning Search/SEO/
Jobs/Admin/Candidate-Suites und `phase17-security-search.spec.ts` bleiben grün.

### 24. Rollback / Roll-forward

Shadow/Canary hält Alt-Search nur solange sie keine bekannten zentralen
False-Zeros reaktiviert; sonst Cluster schliessen oder sichere Releaseversion
zurückspielen. Recommendation/Adminqueue routeweise rollbackbar.
Freshnessprojektion additiv; ein Rollback darf stale/filled Jobs nicht wieder
public machen. Sitemap Single-Route bleibt nur unter nachgewiesenem Budget
Rollbackoption; nach Überschreitung roll-forward.

### 25. Evidence

Corpus-/Release-Digests und Fachapprovals, Search-/Consumer-Paritätsdiffs,
Redaction-/k-Anonymitätsreport, Query Plans/counts/p50/p95/p99, >250-/Bulk-
Counts, Capacity-/Forecast-/Alertmanifest, Freshness Clock-/SLA-/Consumerdiff,
Migration/Backfill/Flags, E2E/Mobile/A11y und exakter Trackcommit.

### 26. Definition of Done

- 30A: jedes aktivierte Cluster besitzt grünes eigenes Korpus, gemeinsamen
  Concept-Vertrag, Search-Learning und Cluster V2.
- 30B: nur bei Trigger; alle Fälle vollständig erreichbar, Query-/p95-Budget
  grün.
- 30C: Monitoring immer; unter Trigger datiert deferred, bei Trigger Shards
  vollständig belegt.
- 30D: Reconfirm/Filled/Report/Duplicate und Consumerparität grün.
- Technik und Quality-Gate bleiben je Track getrennt; LIVE benötigt externe
  Owner-/Kapazitäts-/Clusterfreigaben.

### 27. Folgephasen-Gate

Kein LC3–LC6-Cluster, SEO oder Paid Acquisition vor 30A und 30D. Phase 29B
prüft sichtbare Search/Freshness-Flows erst danach. Phase 31B verlangt 30A,
30D und nur bei ausgelöstem Scale-/Capacity-Trigger 30B/30C-Ausbau. Phase 32
prüft pro Track den tatsächlichen Status statt pauschalem Phasen-Häkchen.

### 28. Ausdrücklich nicht bewiesen

Die Phase beweist keine landesweite Mehrsprachigkeit, keinen Nutzen von
Embeddings/AI Search, keine Marktliquidität, keinen Product-Market-Fit und
keine unbegrenzte Skalierung. Ein Pflegekorpus beweist Engineering nicht.
Aggregate Zero Results beweisen keine Nutzerabsicht. Unter Trigger
deferiertes Sharding ist keine implementierte Shardlösung.
