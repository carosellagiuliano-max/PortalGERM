# Phase-30 Search-, Capacity- und Freshness-Runbook

> **Status:** Die technische Local-/CI-Basis ist ausführbar. Search Learning
> bleibt standardmässig aus, Cluster V2 bleibt ohne Fach- und Dual-Approval
> geschlossen, Sitemap-Sharding ist unter Trigger nicht implementiert und
> Production-/LIVE-Betrieb ist ohne benannte Owner, Zielumgebungs-Alertreceipt
> und Moderationskapazität nicht freigegeben.

## Verantwortungs- und Aktivierungsgrenzen

| Bereich                         | sicherer Zustand                                    | Aktivierungsvoraussetzung                                                                                               | Owner                                  |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Pflege-Concept-/Ranking-Vertrag | technische Releasebindung; kein aktivierter Cluster | unveränderlicher Corpusdigest, vollständiges Pflegefachreview, grüne Golden-/Top-K-/Load-Evidence, Product+Ops Approval | Search/Taxonomy + Pflegefachowner      |
| Engineering                     | `DISCOVERY_ONLY`                                    | eigene `SELECTED`-Entscheidung und neues vollständiges Engineeringfachreview                                            | Search/Taxonomy + Engineeringfachowner |
| Search Learning                 | `SEARCH_LEARNING_COLLECTION=false`                  | Privacy Owner, eigener Base64-Key, Retentionjob, Reviewkapazität und beobachtete Poisoning-/Volume-Grenzen              | Privacy + Search                       |
| Recommendation Projection       | technisch aktiv, bounded und canonical              | Querycount ≤8, p95 ≤300 ms, Foreign Canary 0                                                                            | Candidate + DB Owner                   |
| Admin Pagination/Bulk           | `DEFERRED / MONITORED`                              | Queue ≥70 %, p95 >400 ms oder 90-Tage-Prognose erreicht Cap                                                             | Admin + DB Owner                       |
| Sitemap Shards                  | Single-Sitemap fail-closed                          | ab 70 % planen, vor 80 % deployen, ab 90 %/Fehler Expansion stoppen                                                     | SEO + Platform Operations              |
| Job Freshness                   | technische Projektion; Bestandscohort verzögert     | Moderator-/Supportkapazität für vierstündiges Report-SLA, Worker-/Pager-Go und veröffentlichte Employer-Kommunikation   | Jobs + Trust/Moderation                |

Ein technischer Local-/CI-Pass aktiviert keine Zielumgebung. Keine
Fachreview-, Search-Console-, Pager-, Capacity- oder LIVE-Evidence darf durch
Seed-/Mockdaten ersetzt werden.

## Preflight

1. Exakten Commit, Environment, Datenbank und Worker-Modus feststellen.
2. Migration `20260729190000_phase_30_search_freshness_operations` muss in
   `_prisma_migrations` erfolgreich und nicht zurückgerollt sein.
3. Search-/Taxonomy-/Ranking-Versionen müssen gemeinsam
   `search-policy-v2`, `taxonomy-de-ch-v1`, `ranking-v2` sein.
4. Vor jeder Clusterentscheidung Corpus-, Queryset- und Top-K-Digest
   vergleichen. Ein abweichendes Byte invalidiert das Review.
5. Vor Freshness- oder Search-Learning-Workerbetrieb Phase-23-Lease-,
   Retry-, DLQ-, Replay- und Handleractivation prüfen.
6. Keine Query, E-Mail, Telefonnummer, Token, freie Moderationsnotiz oder
   Secret in Befehlsausgabe/Evidence kopieren.

Technische Basisprüfung:

```text
npm run env:validate
npm run db:validate
npm run db:migrate:status
npm run seed:verify
```

## Search Quality und Cluster V2

- Der statische de-CH-Startervertrag und die gespeicherten Releaseobjekte
  müssen denselben Corpusdigest besitzen.
- Pflege `SELECTED + NOT_REVIEWED` bedeutet: technische Tests sind zulässig,
  Public-/SEO-/Paid-Aktivierung ist nicht zulässig.
- Engineering `DISCOVERY_ONLY` muss selbst bei perfekten synthetischen
  Metriken abgelehnt werden.
- V2 verlangt mindestens 80 % Precision@10, Recall@10 und Coverage sowie
  mindestens fünf relevante Top-K-Jobs, alle drei Releaseversionen,
  Expertreview und die bestehende Product-/Ops-Dual-Approval.
- V1-Approval, DEMO-Provenienz, Location-only-Counts, Release-Mismatch oder
  fehlender Reviewer schließen fail-closed.

Gezielte technische Prüfung:

```text
npx vitest run --config vitest.config.ts tests/unit/search/phase30-pflege-golden.test.ts tests/unit/search/phase30-engineering-golden.test.ts tests/unit/search/search-dimension-contract.test.ts tests/unit/seo/cluster-launch-v2.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/search/search-dimensions-postgres.test.ts tests/integration/search/search-v2-parity-postgres.test.ts tests/integration/admin/cluster-launch-v2-postgres.test.ts
```

Bei False-Zero oder False-Broadening den betroffenen Cluster schließen und
einen neuen Release/Digest erstellen. Bestehende Concepts/Aliases/Evidence
werden nicht mutiert; kein Fallback darf einen bekannten zentralen Fehler
wieder aktivieren.

## Search Learning

Aktivierung benötigt einen nur für diesen Zweck erzeugten Base64-Key mit
mindestens 32 Bytes:

```text
SEARCH_LEARNING_COLLECTION=true
SEARCH_LEARNING_HASH_SECRET=<SECRET>
```

Der Secret-Wert wird nie geloggt oder als Evidence gespeichert. Rotation
beginnt neue HMAC-Buckets; alte und neue Buckets werden nicht
zusammeninterpretiert. Während Rotation ist Collection bei unklarer
Contributor-/Bucket-Semantik zu pausieren.

Operatorablauf:

1. Nur `ACTIONABLE`-/`REVIEWED`-Aggregate mit `observationCount >= 10` und
   nicht abgelaufener Retention sind sichtbar.
2. Der redigierte Normalbegriff ist vor `k=10` nicht persistiert. Er wird erst
   beim atomaren Schwellenübergang capability-geschützt sichtbar und bei
   Expiry zusammen mit allen Contributor-Buckets wieder entfernt.
3. `REVIEW` bestätigt ausschließlich die fachliche Prüfung des Aggregats.
4. `PROMOTE` verlangt zusätzlich einen versionierten `releaseOutcomeCode`;
   es veröffentlicht nicht selbstständig einen Cluster.
5. `REJECT` dokumentiert Poisoning, Mehrdeutigkeit oder Nichtrelevanz.
6. `search.learning-expiry` entfernt Reviewbegriff und
   Contribution-Working-State und markiert
   den Aggregatezustand nach 30 Tagen abgelaufen.

Bei PII-/Secret-Canary, k<10-Sichtbarkeit, Rohquery-Spalte/-Log oder
ungeklärtem Botspam: Collection sofort aus, Handler pausieren, Incident nach
`incident-response.md`, betroffene Working-State-IDs unter Privacy-Owner
quarantänisieren. Keine Taxonomieänderung aus dem kompromittierten Bucket.

## Recommendation- und Admin-Scale-Trigger

Die Entscheidung verwendet:

- maximale Queueauslastung in Basispunkten;
- p95 des owning Reads;
- Recommendation-Gesamtquerycount;
- 90-Tage-Prognose zum aktuellen Cap;
- bereits erreichte Kapazität.

Unter 70 %, p95 ≤400 ms, Recommendation ≤20 Queries und ohne Cap-Forecast
bleibt Admin-Pagination/Bulk `P3_DEFERRED`. Der Recommendation-Track wurde
bereits durch den 42-Query-Istwert ausgelöst und muss nach jeder Änderung bei
48 Kandidatenjobs weiterhin ≤8 Queries, p95 ≤300 ms und Foreign Canary 0
erreichen.

Ab Admin-Trigger wird ausschließlich die betroffene Queue migriert:
serverseitiger Filter vor signiertem Keyset-Cursor, Page Size ≤100,
vollständiger Count, capability-/tenantgebundener Cursor und bounded Bulk
≤100 mit per-item Success/Denial/Conflict. Erst dann wird die zugehörige
deferred Testzeile verpflichtend.

## Sitemap Capacity

`seo.sitemap-capacity` läuft höchstens einmal pro UTC-Tagesbucket und
persistiert append-only:

- URL-Anzahl und geschätzte unkomprimierte Bytes;
- Runtime und Erfolg;
- 7-/30-Tage-Wachstum;
- lineare 90-Tage-Prognose;
- `HEALTHY`, `PLAN`, `DEPLOY` oder `EXPANSION_BLOCKED`;
- Owner und Zeitpunkt.

| Zustand                                          | zwingende Reaktion                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `<70 %` / `HEALTHY`                              | Single-Sitemap, no-truncation und tägliches Monitoring beibehalten        |
| `≥70 %` / `PLAN`                                 | Sharddesign terminieren, Zielalert und Ownerreceipt belegen               |
| `≥80 %` / `DEPLOY`                               | Index/Shards vor weiterer Expansion deployen und >50k-Uniontest ausführen |
| `≥90 %`, Forecast-Cap oder fehlgeschlagener Lauf | Expansion stoppen; Incident/Releaseblockade                               |

Ein fehlgeschlagener Lauf schreibt eine fehlgeschlagene Observation und darf
nicht als Nullbedarf interpretiert werden. Bis zum Trigger ist das Fehlen von
`sitemap-shards-postgres.test.ts` beabsichtigt; nach Trigger wäre es ein
Blocker.

## Job Freshness, Reports und Duplikate

- Due ist das frühere Datum aus letzter Bestätigung +30 Tage und
  `expiresAt`.
- Reminder werden sieben Tage und 24 Stunden davor exactly-once geplant.
- Am Due-Instant ist Public Eligibility bereits fail-closed, auch wenn der
  Worker die Projektion erst danach auf `STALE` schreibt.
- Employer Owner/Admin bestätigt nur den eigenen aktuell veröffentlichten
  Job mit Job-/Revisionversion und Idempotency-Key. „Besetzt“ schließt Job,
  Projektion und Fingerprint atomar.
- Candidate-Hinweise sind nur für aktuell sichtbare Jobs, authentifiziert,
  rate-limitiert und reporter-deduplicated. Die öffentliche Antwort enthält
  keine Moderations- oder Reporterdetails.
- Reconfirm-/Filled-Replays sind an Job, aktive Membership, Firma und
  Owner-/Adminrolle gebunden. Ein offener Review oder Hold kann durch eine
  Employer-Reconfirmation nicht umgangen werden.
- Nach vier Stunden offenem Report wird der Job `HOLD`; ein Moderator kann
  confirmed outdated oder dismissed entscheiden.
- Exakte Duplikate werden pro Firma plus `manual` oder
  `import:<source-id>` verhindert. Near-Duplicates blockieren nicht
  automatisch, sondern erzeugen eine Moderationsaufgabe.

Der zentrale Public-Eligibility-Vertrag muss für Search, Detail, Alerts,
Recommendations, Matching/Radar, Company Counts, Admin/Employer Overview,
Sitemap und Analytics identisch bleiben. Diagnose zuerst über Jobstatus,
Revisionbindung, Trust-/Moderationseffekte und
`JobFreshnessProjection.enforceAt/state/dueAt/reviewDueAt`; nie einen
einzelnen Consumer lokal „freischalten“.

Gezielte technische Prüfung:

```text
npx vitest run --config vitest.config.ts tests/unit/jobs/job-freshness-policy.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/jobs/job-freshness-postgres.test.ts tests/integration/jobs/job-freshness-abuse-postgres.test.ts tests/integration/jobs/job-freshness-consumers-postgres.test.ts
npm run test:e2e:browser -- tests/e2e/flows/phase30-freshness.spec.ts --project=chromium-journeys
```

## Rollback, Roll-forward und Incident

- Search Learning: Collector und Expiry-Handler getrennt pausieren;
  persistierte Events nicht löschen. Releaseänderung nur über neue Version.
- Search/Cluster: Cluster schließen oder auf eine nachweislich sichere
  Releaseversion vorwärts wechseln. Kein V1-Approval als V2-Ersatz.
- Freshness: UI-/Reminder-Intake kann pausiert werden; `HOLD`, `STALE`,
  `FILLED`, `CLOSED`, Trust- und Moderationssperren bleiben public
  fail-closed. Projektionen/Events/Fingerprints nicht löschen.
- Sitemap: unter Trigger kann die Single-Sitemap bleiben. Nach
  Kapazitätsüberschreitung nur Roll-forward auf vollständig getestete Shards;
  niemals still abschneiden.
- Workerfehler, DLQ, verlorene Lease oder Replay folgen
  [worker-operations.md](./worker-operations.md); PII-/Securityvorfälle folgen
  [incident-response.md](./incident-response.md).

Production-/LIVE-Abnahme benötigt zusätzlich: signiertes Pflegefachreview des
exakten Digests, Zielumgebungs-Load/Shadow, Search- und Sitemap-Alertreceipt,
benannte Pager-/Vertretungsowner, belegte vierstündige
Moderationskapazität, Staging-Canary und den Phase-32-Releaseaudit auf exakt
demselben Artefakt.
