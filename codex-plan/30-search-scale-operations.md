# Phase 30 — Startcluster-Suche und skalierbare Operations

> **Status: GEPLANT / NICHT BEGONNEN.** Diese Phase besitzt drei getrennt
> freigebbare Tracks. **Track 30A** beginnt direkt nach Phase 19 und ist für
> jeden Kandidaten-Launch im gewählten Startcluster ein P1-Gate. **Track 30B**
> skaliert Reads und Queues später im Integrationspfad. **Track 30C** führt
> sofort Kapazitätsmessung und Warnungen ein, baut den Sitemap-Index aber erst
> bei einem dokumentierten Auslöser. Ein früher Track-Abschluss ist mit eigener
> Evidence zulässig; die Gesamtphase wird dadurch nicht vorzeitig abgehakt.

## Ziel

Fachlich gleichwertige Schweizer Berufsbezeichnungen im Startcluster
zuverlässig und erklärbar zusammenführen, denselben Berufsvertrag in Suche,
Job-Alerts, Empfehlungen und Matching verwenden, betriebliche Reads ohne
stille Caps/Fan-out skalieren und die sichere Einzel-Sitemap rechtzeitig vor
ihrer tatsächlichen Kapazitätsgrenze ablösen.

## Ausgangslage und Problem-IDs

- `STH-019` ist für Pflege/Gesundheit **P1 und Launch-Blocker**. Die öffentliche
  Suche normalisiert Akzente und nutzt gewichtete Substring-Treffer, kennt aber
  keine kontrollierten Berufsaliase oder Tippfehler. Job-Alerts verwenden
  daneben eine eigene `contains`-Semantik; Empfehlungen und Match Score teilen
  keine Berufsontologie mit der Suche.
- `STH-020` ist P1 vor wachsendem Betriebsvolumen: Adminqueues besitzen Caps
  von 100–250 statt vollständiger Pagination.
- `STH-021` ist P1 Performance: Das Candidate Dashboard lädt bis zu 48
  Detailprojektionen für sechs Recommendations.
- `STH-027` ist bei der repository-belegbaren DEMO-/Plan-Größenordnung
  **P3-Skalierungsvorbereitung**: Eine einzelne Sitemap fällt oberhalb von
  50.000 URLs bewusst geschlossen aus. Sie schneidet weder still ab noch
  publiziert sie dadurch private URLs; die reale LIVE-Größe bleibt zu messen.

## Verbindliche Track-Reihenfolge

### Track 30A — Startcluster-Suchqualität, früh und launchkritisch

Track 30A startet nach der Phase-19-Baseline mit technischem Design/Benchmark;
sein verbindlicher Golden-/Negativkorpus kommt aus dem frühen
Phase-31A-Fachreview. Er läuft danach parallel zu den übrigen Kernphasen und
muss vor öffentlicher Kandidatenakquise, vor öffentlichen
Startcluster-Claims und vor der finalen Search-/Alert-/Recommendation-UX in
Phase 29 abgeschlossen sein. Zuerst wird Pflege/Gesundheit auf de-CH
abgenommen; jedes weitere Cluster oder jede weitere Sprache benötigt vor
Aktivierung ein eigenes freigegebenes Korpus.

### Track 30B — Read-, Queue- und Recommendation-Skalierung

Track 30B folgt nach den fachlich betroffenen Phasen 22, 23 und 25. Er umfasst
Admin-Pagination, Bulk/Export, Recommendation-Query-Verträge und
Performancebudgets. Er ist kein Grund, Track 30A bis ans Ende der
Remediation-Kette aufzuschieben.

### Track 30C — Sitemap-Kapazität und konditionales Sharding

Messung, Forecast, Alarmierung und Runbook sind Pflicht. Der Sitemap-Index und
die Shards bleiben hingegen aufgeschobene P3-Arbeit, solange reale Messung und
90-Tage-Prognose unter den definierten Auslösern liegen. Dieser Status wird als
`DEFERRED / MONITORED` dokumentiert und nicht fälschlich als behobener
Sharding-Befund bezeichnet.

## In Scope

- Versionierte, kontrollierte Schweizer Berufstaxonomie mit kanonischen
  Berufs-Konzepten, de-CH-Bezeichnungen, Synonymen, Abkürzungen,
  geschlechtsspezifischen/neutralen Formen, Singular/Plural, regionalen
  Varianten und freigegebenen häufigen Tippfehlern.
- Gemeinsame Normalisierung und Konzeptauflösung für Public Search, gespeicherte
  Suche/Job-Alerts, Candidate Preferences, Empfehlungen und Matching.
- Erklärbare PostgreSQL-Lösung aus Taxonomie, Aliasauflösung,
  `pg_trgm`/Full-Text-Suche und versionierten Rankingregeln; ein externer oder
  semantischer/AI-Suchdienst nur nach separat belegtem Zusatznutzen.
- Stable Keyset-Cursor, transparente Boost-Grenze und Relevanzdiagnostik.
- Batchfähige Recommendation Projection oder kontrollierte Materialisierung.
- Keyset-Pagination, serverseitige Filter/Counts sowie capability-geschützte,
  begrenzte Bulk-Aktionen und Exporte.
- Sitemap-Zählung, Byte-/Laufzeitbudget, Wachstumsprognose, Alerts und Runbook;
  später bei Trigger ein Sitemap-Index mit Ressource- und optionalen
  Cluster-Shards.

## Out of Scope

- Opaque ML-/Embedding-Ranking als Voraussetzung für die Startcluster.
- Unkontrollierte Wortstamm- oder Kategorieausweitung, die fachfremde Treffer
  als Synonyme behandelt.
- Stille Wiederverwendung von `OccupationCode`: Der vorhandene Code dient dem
  Job-Reporting. Eine Verbindung zur Suchontologie braucht ein explizites,
  versioniertes Mapping und fachliche Freigabe.
- Bezahlter Einfluss auf Fair Score oder irrelevante Resultate; Boost bleibt
  sichtbar und darf Relevanz nicht ersetzen.
- Automatische Arbeitgeberentscheidung nach Match.
- Unbegrenzte Admin-Exports oder Massenmutation ohne Teilfehler/Audit.
- Sofortiger Sitemap-Umbau allein wegen der theoretischen 50.000er-Grenze.

## Rollen und Prozesse

Public/Candidate sucht, speichert die Suche und erhält Empfehlungen/Alerts.
Employer profitiert von Discovery, aber Boost bleibt transparent.
Taxonomy/Content Admin pflegt Konzepte und Aliase über Review, Version,
Aktivierung und Rollback. Admin/Support/Moderation/Finance/Privacy nutzt
paginierte, capability-gebundene Queues. Crawler sieht ausschließlich
indexierbare LIVE-Ressourcen.

## Betroffene Dateien und Module

- `lib/search/**`, `lib/jobs/public-read-model.ts`,
  `lib/candidate/job-alerts.ts`, `lib/candidate/dashboard.ts`,
  `lib/scoring/match-score.ts`
- neue Search-Occupation-Taxonomy-/Alias-Modelle und Admin Content; vorhandene
  `OccupationCode`-Modelle nur über ein ausdrücklich geprüftes Mapping
- `lib/admin/**`, `app/admin/**`, Admin Components
- `lib/seo/public-sitemap.ts`, `app/sitemap.ts`, Monitoring und bei Trigger
  neue Index-/Shard-Routen
- Prisma-Migrationen/Indizes, Golden-Korpus, Benchmarks, Load-/E2E-Tests

## Datenmodell- und Policyvertrag

Die genaue Benennung wird im ADR eingefroren; mindestens benötigt werden:

- unveränderliche `OccupationConcept`-IDs mit Version/Status;
- lokalisierte kanonische Labels und typisierte Aliase
  (`SYNONYM`, `ABBREVIATION`, `GENDER_VARIANT`, `REGIONAL_VARIANT`,
  `COMMON_MISSPELLING`) mit Herkunft, Reviewer und Gültigkeit;
- explizite Job-/Preference-Zuordnung zu Konzepten; keine Ableitung allein aus
  einer groben Category. Originale Jobtitel und Candidate-`desiredTitles`
  bleiben für Anzeige/Audit erhalten;
- eine versionierte Normalisierungs-, Expansion- und Rankingpolicy;
- eine public-only Search Projection mit freigegebenem Titel, Berufs-Konzepten,
  Category/Skills und den bereits zulässigen Suchfeldern; private/DEMO/
  revoked Daten gelangen nicht in den Index;
- ein gespeicherter Alert-Snapshot mit normalisiertem Query,
  aufgelösten Konzept-IDs und Policyversion, damit Dispatch und UI denselben
  Vertrag ausführen;
- optional eine Candidate-owned Recommendation Projection mit
  Input-/Taxonomie-/Policyversion und Freshness.
- ein `ClusterLaunchAssessment`-V2-Vertrag, der Query-Set-, Search-Policy-,
  Ranking- und Taxonomie-Release bindet und je Query erwartete Konzepte,
  Top-K-Result-IDs und fachlich relevante Counts persistiert. Der heutige
  aggregierte Evidence-Hash und ein beliebiger positiver Substring-Proxy
  genügen dafür nicht; alte V1-Approvals dürfen nach Cutover keine
  V2-Aktivierung autorisieren.

Sitemap-Shards müssen nicht persistiert werden. Falls der Trigger eintritt,
werden sie mit stabiler Keyset-Grenze oder unveränderlichem Build-Snapshot
erzeugt; Ressourcentyp, Count, unkomprimierte Bytes, Generation und
Eligibility-Version bleiben nachvollziehbar.

## Track 30A — Umsetzungsschritte

- [ ] Product/Search Owner friert die tatsächlich beworbenen Startcluster und
  pro Cluster zentrale Berufe, zulässige Aliase, Gegenbeispiele und
  Relevanzurteile ein.
- [ ] Eine kontrollierte Such-Berufstaxonomie getrennt von der groben Category
  und dem Reporting-`OccupationCode` modellieren; optionales Mapping explizit
  dokumentieren.
- [ ] Unicode-/Akzent-/Interpunktions-/Whitespace-/Großschreibungs-,
  Singular-/Plural- und fachlich kontrollierte Compound-Normalisierung
  versionieren.
- [ ] Jobs beim Review/Publish einem oder mehreren geprüften
  Berufs-Konzepten zuordnen; fehlende/mehrdeutige Zuordnung erhält einen
  sichtbaren Redaktionsstatus und wird nicht heimlich geraten.
- [ ] Query Resolver, Kandidatenpräferenz und Alert-Snapshot auf dieselben
  Konzept-IDs und dieselbe Taxonomieversion stellen.
- [ ] `pg_trgm`, PostgreSQL FTS und die kontrollierte Aliasauflösung gegen das
  Golden-Set benchmarken; kleinste erklärbare Variante per ADR wählen.
- [ ] Rankingpriorität `exaktes Konzept/Label → geprüfter Alias →
  tolerierter Tippfehler → FTS/sonstige Felder` sowie Mindestähnlichkeit,
  Feldgewichte, Tie-Breaker, Cursor- und Boost-Grenze einfrieren.
- [ ] Cursor und Search-/Alert-Snapshots an Search-Policy-, Ranking- und
  Taxonomie-Release binden; inkompatible alte Cursor starten kontrolliert neu,
  statt unter veränderter Semantik fortzusetzen.
- [ ] Empfehlungen/Matching verwenden dieselben Berufs-Konzept-IDs; ihr
  kontextabhängiges Ranking darf abweichen, die fachliche Gleichwertigkeit und
  Ausschlussmenge jedoch nicht.
- [ ] Bestehende gespeicherte Suchen/Alerts deterministisch migrieren oder als
  alte Policyversion lesbar halten; Preview und Dispatch müssen paritätisch
  bleiben.
- [ ] DEMO-Fixtures um realistisch-fiktive positive und negative
  Startcluster-Berufspaare/Aliase ergänzen. Das fachlich versionierte
  Golden-/Negativkorpus bleibt davon getrennt; DEMO-Seed zählt nie als
  LIVE-Markt- oder Fachreview-Evidence.
- [ ] Shadow Query, Relevanzdiff, False-Zero-/False-Broadening-Metrik,
  Feature-Flag, Rollback und Taxonomie-Publish-/Revoke-Audit umsetzen.
- [ ] Cluster-Launch-Assessment V2 auf denselben kanonischen Search Read Model
  umstellen. Das fachlich freigegebene Query-Set kommt aus Track 31A und zählt
  relevante Top-K-Judgments statt beliebiger Location-/Kategorie-Substring-
  Treffer; Taxonomie-/Policywechsel invalidiert oder re-evaluiert alte
  Freigaben fail-closed.

## Verbindlicher Startcluster-Testkatalog

Der Katalog enthält Query, erwartete Konzept-ID, zulässige/erwartete Jobs,
ausgeschlossene Jobs, Rankingurteil, Cluster, Sprache und Taxonomieversion.
Must-find-/must-not-find-Urteile sowie Recall@K-/Precision@K-/Latenzbudgets
werden vor Shadowresultaten eingefroren. Das bestehende Produktgate
„mindestens 80 % der beworbenen Query-Kombinationen mit mindestens fünf
relevanten Stellen“ bleibt Untergrenze, zählt aber nur fachlich relevante
Top-K-Judgments und nicht irgendeinen Substring-Treffer.
Mindestens folgende Fälle sind Pflicht:

- [ ] `Pflegefachkraft` findet eine vorhandene Stelle
  `Dipl. Pflegefachfrau HF` beziehungsweise das gleiche freigegebene
  Berufs-Konzept.
- [ ] `Pflegefachperson` findet weibliche, männliche und neutrale
  Titelvarianten, sofern passende öffentliche Stellen vorhanden sind.
- [ ] `diplomierte Pflegefachperson` und Singular-/Pluralvarianten lösen auf
  dasselbe freigegebene Konzept auf.
- [ ] `FaGe` findet passende `Fachfrau/Fachmann Gesundheit EFZ`-Stellen, ohne
  diesen Beruf ungeprüft mit diplomierter Pflege gleichzusetzen.
- [ ] Ein freigegebener leichter Tippfehler wie `Plegefachfrau` liefert die
  relevanten vorhandenen Stellen innerhalb des Latenzbudgets.
- [ ] Akzent-, Interpunktions-, Groß-/Kleinschreibungs- und regionale Varianten
  verändern die fachliche Treffermenge nicht unkontrolliert.
- [ ] Negative Queries belegen, dass `Pflegefachperson` nicht allein wegen des
  Wortteils `Pflege` zu `Pflegehelfer/in`, Reinigung oder fachfremden
  Tätigkeiten verbreitert wird.
- [ ] Company-name-only-, Location-only- und generische
  `Jobs/Stellen`-Treffer zählen ohne passenden Beruf nicht als relevante
  Search-Coverage.
- [ ] Search Preview, Public Search und Job-Alert-Dispatch liefern bei
  identischem Eligibility-Zeitpunkt und Filter dieselbe fachliche Treffermenge.
- [ ] Empfehlungen und Matching verwenden für dieselben Berufsvarianten
  dieselben Konzept-IDs und dokumentieren zusätzliche Rankingfaktoren separat.
- [ ] Jeder zentrale Begriff jedes freigegebenen Startclusters hat mindestens
  einen positiven und einen negativen Test; bei vorhandener passender Stelle
  ist kein bekannter False-Zero zulässig.

## Track 30B — Umsetzungsschritte

- [ ] Recommendations batchen/materialisieren und Freshness definieren.
- [ ] Query-count-/p50-/p95-/Load-/Soak-Budgets einfrieren und messen.
- [ ] Gemeinsame Admin-Cursor-/Filter-/Count-Primitives einführen; Filter immer
  vor Pagination.
- [ ] Queues sowie Bulk/Export capabilityweise mit Idempotenz,
  Teilfehlerresultat und Audit migrieren.
- [ ] Shadow/Canary, Backfill/Rebuild und routeweiser Rollback.

## Track 30C — aktuelle Kapazität, Forecast und Trigger

### Nachgewiesene Repository-Baseline

- Die einzelne Sitemap besitzt **10 statische Pfade** und zählt anschließend
  gemeinsam eligible LIVE-Jobs, -Firmen, -Ratgeber und aktive
  Cluster-Landingpages. Formel:
  `10 + LIVE_JOBS + LIVE_COMPANIES + LIVE_GUIDES + LIVE_CLUSTERS`.
- Standorte und Berufe sind heute keine getrennten Sitemap-Budgets, sondern
  erscheinen nur als freigegebene Cluster-Landingpages in derselben Summe.
  Bei 26 Kantonen und 18 Kategorien liegt deren rein kombinatorische
  Obergrenze bei 512 Seiten
  (`26 × 18` Paare + 26 Kanton- + 18 Kategorie-Eltern), sofern jede davon
  echte Inhalte und alle Launch-Gates erfüllt.
- Die dynamische Restkapazität beträgt derzeit theoretisch `49.990` URLs. Die
  Ressourcentypen besitzen keine getrennte Reservation; ein voller früher Typ
  kann daher den gesamten Request geschlossen scheitern lassen.
- Der lokale DEMO-Seed enthält keine sitemapfähigen LIVE-Datensätze. Die
  Nicht-Production-Route liefert vertragsgemäß `0`; ein production-like Builder
  über denselben DEMO-Daten hätte nur die 10 statischen Pfade.
- Eine reale Production-URL-Anzahl ist aus dem Repository **nicht belegbar**
  und muss in Phase 19/30C aus der Zielumgebung ohne PII erfasst werden.
- Das Start-Szenario aus der Produktstrategie liegt grob bei 336–348 URLs
  einschließlich statischer Pfade, geplanter Jobs/Firmen/Cluster und optional
  legitimer Ratgeber. Das ist eine Planprojektion, keine LIVE-Messung, und
  deutlich unter 1 % des Count-Limits.
- Ein belastbares Datum bis 50.000 kann ohne reale Ausgangszahl und
  Wachstumsreihe nicht angegeben werden. Heute existiert kein
  sitemap-spezifischer Count-/Byte-/Laufzeitmonitor; genau diese Lücke schließt
  der Pflichtteil von 30C.

### Pflicht-Monitoring

- [ ] Counts pro Ressourcentyp, Gesamtsumme, Kapazitätsauslastung,
  unkomprimierte XML-Bytes, Generierungsdauer, DB-Batches/Timeouts, letzter
  erfolgreicher Lauf und Fehlergrund erfassen.
- [ ] Wachstum über 7/30 Tage und konservative 90-Tage-Prognose mit
  Datenstand, Quelle und verantwortlichem SEO/Ops Owner anzeigen.
- [ ] Alerts und Runbook für Capacity Error, Bytegrenze, wiederholten
  Transaktionstimeout, p95-Budgetbruch und ausbleibenden erfolgreichen Lauf.
- [ ] Search-Console-/Crawler-Evidence wird getrennt von der technisch
  generierten URL-Anzahl beobachtet; „submitted“ ist nicht „indexed“.

### Eskalations- und Bauentscheid

| Auslöser | Verbindliche Reaktion |
|---|---|
| unter 70 % Count-/Bytebudget und 90-Tage-Prognose bleibt darunter | P3 `DEFERRED / MONITORED`; bestehende Single-Sitemap unverändert fail-closed halten |
| ab 70 % oder Prognose erreicht 70 % in 90 Tagen | P2-Warnung; Shard-ADR, Owner, Zielrelease und Lasttest verbindlich terminieren |
| ab 80 % oder Prognose erreicht 80 % in 90 Tagen | Sitemap-Index und Ressource-Shards vor weiterer indexierbarer Expansion implementieren und deployen |
| ab 90 %, Capacity Error, Byte-/Timeout-/p95-Gate rot | P1 Betriebs-/Releaseblocker; Expansion stoppen, Incident/Runbook ausführen, keine stille Truncation |

Beim ausgelösten Ausbau gelten:

- [ ] Sitemap-Index und getrennte Job-, Company-, Guide- und Cluster-Sitemaps;
  zusätzliche Cluster-/Keyset-Segmente nur bei tatsächlichem Bedarf.
- [ ] jeder Shard bleibt unter Count- **und** unkomprimierter Bytegrenze mit
  Sicherheitsmarge; Namen und Grenzen sind deterministisch.
- [ ] exakt dieselbe LIVE-/Public-Eligibility, Canonical-, Expiry- und
  Revoke-Policy wie die bisherige Single-Sitemap.
- [ ] paralleler Production-like Test, Robots-/Index-Verlinkung,
  Cache/Freshness, Monitoring und Search-Console-Runbook vor Cutover.
- [ ] die alte Single-Sitemap bleibt nur solange Rollbackoption, wie Count-,
  Byte- und Performancebudget nachweislich nicht überschritten sind.

## Sicherheits- und Datenschutzfolgen

- Suchindex und Taxonomiediagnostik enthalten nur freigegebene Public-Felder.
- Recommendation Projection bleibt Candidate-owned und gibt keine Profile an
  Arbeitgeber weiter.
- Admin Cursor/Filter/Bulk/Export prüft Capability und Tenant/Scope bei jeder
  Seite und Mutation.
- Sitemap, Index und Shards enthalten keine DEMO-, private, expired, revoked
  oder mangels Cluster-Gate gesperrte URL.
- Suchlogs speichern keine rohen personenbezogenen Freitexte; Analytics folgt
  Phase 22.

## Migrations-, Kompatibilitäts- und Rollbackstrategie

- [ ] Extension/Index/additive Tabellen in Staging mit Lock-/Size-Messung.
- [ ] Dual Read/Shadow Query vergleicht Alt/Neu, ohne Userresultat zu ändern.
- [ ] Taxonomie-, Ranking- und Cursorversion bleiben im Ergebnis/Alert
  reproduzierbar; alte Versionen werden migriert oder kontrolliert beendet.
- [ ] Queue für Queue auf Keyset umstellen; Caps bleiben nur page-size bounds.
- [ ] Reindex/Rebuild/rollback Runbook und gezielte Feature-Flags.

Alte Suche kann während der Shadow-/Canary-Phase als Fallback bleiben. Nach
Freigabe eines Startclusters darf ein Rollback jedoch nicht wieder bekannte
False-Zeros aktivieren; dann muss der Cluster geschlossen oder eine
nachweislich sichere Taxonomieversion zurückgespielt werden. Ein
Sitemap-Rollback darf keine unzulässig indexierbare URL reaktivieren.

## Abhängigkeiten

- **30A:** Phase 19, benannter Product/Search-/Taxonomy-Owner, reales
  Startcluster-Korpus und Content-Zuordnung. Abschluss vor Kandidaten-Launch und
  vor der Search-/Alert-/Recommendation-Abnahme in Phase 29/32.
- **30B:** Phase 19 sowie Phase 22 für Export/Analytics, Phase 23 für
  Worker/Monitoring und Phase 25 für Admin-Capabilities.
- **30C:** Messbaseline nach Phase 19; produktive Alerts/Runbook über Phase 23.
  Der Sharding-Ausbau hängt nur vom dokumentierten Trigger ab, nicht pauschal
  von E-Mail, Billing oder anderen P0-Gates.

## Risiken und Regressionen

- Alias oder Trigramm erweitert zu fachfremden Treffern.
- Search, Alert, Preference und Recommendation driften auf verschiedene
  Taxonomieversionen.
- Ranking-/Cursoränderung erzeugt Duplikate/Lücken oder Boost verdrängt
  Relevanz.
- Materialisierte Recommendations werden stale oder leaken PII.
- Filter nach Pagination verstecken Fälle; Bulk ist partiell fehlerhaft.
- Verfrühtes Sharding erzeugt unnötige Cache-/Crawlerkomplexität; verspätetes
  Sharding lässt die gesamte Sitemap ausfallen.
- Shards duplizieren/verlieren URLs oder verletzen Eligibility.

## Akzeptanzkriterien und Tests

### Unit / Golden

- [ ] Der dokumentierte Startcluster-Katalog mit positiven, negativen,
  Alias-, Abkürzungs-, Geschlechts-, Neutral-, Singular-/Plural-, Akzent- und
  Tippfehlerfällen ist vollständig grün.
- [ ] Aliaszyklen, Mehrdeutigkeit, inaktive Version, ungültiges Mapping und
  False-Broadening fallen geschlossen aus.
- [ ] Ranking-Erklärung, Cursor-Version und Boost-Unabhängigkeit.
- [ ] Cluster V2: 79 % Search-Coverage scheitert, 80 % besteht nur mit
  fachlichen Top-K-Judgments; V1-Approval, Release-Mismatch und reine
  Location-/`Stellen`-Treffer können V2 nicht aktivieren.
- [ ] Filter/Cursor sowie Capacity-/Forecast-Schwellen sind deterministisch.

### PostgreSQL / Performance

- [ ] Search-/Alert-Parität und Keyset unter parallelen Publish-/Expiry-
  Änderungen.
- [ ] Der heutige task-only-Paritätsbruch, Synonym, Tippfehler,
  Category/Skill/Berufs-Konzept sowie Revoke/Expiry sind als identische
  Search-/Alert-Mitgliedschaft bei gleichem Filter/`asOf` geprüft; nur
  Delivery-/Dedupe-Fenster dürfen zusätzlich wirken.
- [ ] Recommendation Query-Count-Ceiling und Berufs-Konzept-Parität bei 48
  Kandidaten; `desiredTitles` beeinflusst Retrieval/Ranking nachweislich und
  ein verwandter Beruf mit falscher Qualifikation wird nicht hochgerankt.
- [ ] >250 Queuefälle: jeder genau einmal erreichbar, Filter vor Pagination.
- [ ] Bulk-Teilfehler, Idempotenz, Capability und Audit.
- [ ] EXPLAIN, p50/p95, Load und Soak gegen freigegebene Budgets.
- [ ] Bei ausgelöstem Sharding: >50.000 synthetische LIVE-URLs, Count- und
  Bytegrenzen, jede eligible URL exakt einmal, deterministische Shards,
  Revoke/Expiry und kein privater/DEMO-Pfad.

### E2E und manuell

- [ ] Berufsvariante/Tippfehler → relevantes Ergebnis → Detail/Apply sowie
  gleichwertige Job-Alert-Preview/Dispatch.
- [ ] Candidate Recommendations ohne Taxonomie-, UX- oder Privacy-Drift.
- [ ] Admin Filter/Pagination/Bulk/Export Desktop/360 px.
- [ ] Capacity-Dashboard/Alert/Runbook in Production-like Mode; bei ausgelöstem
  Sharding zusätzlich Index/Shard/robots/canonical und Rollback.

## Evidence und Definition of Done

- [ ] **Track 30A:** Alle zentralen Startcluster-Begriffe besitzen dokumentierte
  Tests; bei vorhandener passender Stelle gibt es keinen bekannten
  False-Zero, keine bekannte unkontrollierte fachliche Ausweitung und
  Search/Alert/Recommendation nutzen dieselbe Berufstaxonomie.
- [ ] **Track 30B:** Candidate Dashboard besitzt ein Query-Count-Ceiling; kein
  Adminfall bleibt wegen eines stillen Hard Caps unerreichbar; Bulk/Export ist
  least-privilege, bounded und auditiert.
- [ ] **Track 30C:** reale Zielumgebungszahl, Wachstum, Count/Bytes/Laufzeit,
  Warnschwellen und Owner sind belegt; das bestehende fail-closed-Verhalten
  bleibt bis zum sicheren Cutover erhalten.
- [ ] Liegt kein Sitemap-Trigger vor, ist `STH-027` nachvollziehbar als
  `P3 DEFERRED / MONITORED` offen. Liegt ein Trigger vor, sind Index/Shards und
  die vollständige >50.000-/Byte-/Eligibility-Suite vor Abschluss Pflicht.
- [ ] Loading-, Empty-, End-of-list-, Locked-, Error-, Retry-, Conflict- und
  Success-Zustände sind für Suche, Queues, Bulk und Exporte umgesetzt.
- [ ] Alle tatsächlich erforderlichen Performance-/Load-/Regression-Gates sind
  auf dem jeweiligen unveränderlichen Track-Zielcommit grün.

## Offene externe Voraussetzungen

Taxonomie-/Synonym-Fachowner und fachliche Pflege-/Gesundheits-Reviewer,
realistische Last-/Wachstumsannahmen sowie für LIVE Search-Console- und
Monitoring-Zugriff. Semantische/ML-Komponenten sind nicht erforderlich und
bräuchten vor einem späteren Einsatz einen separaten
Fairness-/Privacy-/Kostenentscheid.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Startcluster liefern auffindbare relevante Jobs; Operations und SEO wachsen ohne stille Lücken. |
| Problem-IDs | STH-019 P1 in 30A; STH-020/021 in 30B; STH-027 P3/triggerbasiert in 30C. |
| Prerequisites | 30A: 19 + Taxonomiekorpus; 30B: 19/22/23/25; 30C: 19 + LIVE-Messzugang, Alerts über 23. |
| Deliverables | Gemeinsame Berufstaxonomie/Search v2; Recommendation Batch; Admin Keyset/Bulk; Capacity-Monitoring und nur bei Trigger Sitemap-Index/Shards. |
| Security / Privacy | Public-only Index, candidate-owned Recommendations, scoped Adminexport, unveränderte Sitemap-Eligibility. |
| Tests | Startcluster-Golden/Negative/Parity, Cursor/Concurrency, Query Counts, >250, Capacity/Forecast und konditional >50k/Bytes. |
| Expected Result | Kein bekannter Startcluster-False-Zero bei vorhandenem passenden Job; Scale-Arbeit wird messbar und rechtzeitig ausgelöst. |
| Risks / Limits | Kein unbelegter ML-Big-Bang; kein verfrühter Sitemap-Umbau; reale URL-Zahl bleibt bis Zielumgebungsmessung extern offen. |
