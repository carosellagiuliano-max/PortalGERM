# Commercial-, Daten- und AVG-Go-live-Gates

> **Status 24. Juli 2026:** Dieses Dokument ist ein Folgeaudit nach dem
> technischen Abschluss der Phasen 01–18. Es ändert keine historische
> Phase-Evidence und erteilt keine Rechts-, Steuer- oder
> Produktionsfreigabe. Die offenen Kästchen sind echte Business-/Fach-/
> Operations-Gates.

## 1. Bewertete Befunde

| Befund | Urteil | Konsequenz |
|---|---|---|
| Mock Payment prüft keine Zahlungsbereitschaft | **hoch, korrekt** | `CHECKOUT_COMPLETED` ist nur eine Mock-Bestätigung. Paid Conversion braucht einen echten, transparenten Geldfluss mit realen KMU. |
| ADR-014 widerspricht der Playground-`CLAUDE.md` | **Repo-Verwechslung** | `Playground`/`Portal.git` und das verschachtelte `PortalGERM.git` sind getrennte Repositories. Das lokale [`../CLAUDE.md`](../CLAUDE.md) grenzt den Scope nun ausdrücklich ab; für PortalGERM gelten ADR-014/016. |
| 150 Zahlende und CHF −700/Monat verschweigen CHF 400–600k Burn | **Modelllücke; Betrag plausibel, nicht bewiesen** | Der Endpunkt ist rechnerisch korrekt, aber ein monatliches Cashflow-/Runway-Modell fehlt. Sensitivität siehe unten. |
| CHF 149/Monat ist wegen jobs.ch massiv unterpreist | **kommerzielles Risiko, Schluss zu stark** | Produkte, Reichweite und Einheit sind nicht direkt vergleichbar. jobs.ch wirbt aktuell auch mit kostenlosem Start und Werbeprodukten ab CHF 290. Preis erst nach bezahlten Angebotsversuchen ändern. |
| Episodischer Bedarf führt zu Churn | **hoch als Hypothese** | Reaktivierung und Hiring-Sprints müssen getrennt von dauerhaftem Logo-Churn gemessen werden; Monatsabo, zeitlich begrenztes Paket und Retainer/Credits gegeneinander testen. |
| Talent Radar kam zu spät und ist der einzige Moat | **historisch teilweise, „einziger Moat“ unbelegt** | Der vollständige Flow kam in Phase 14, wurde aber ab Phase 02 vorbereitet und ist heute implementiert. Radar als kommerziellen Wedge testen, nicht vorab als verteidigbaren Moat behaupten. |
| Kein autonomer Worker | **hoch für unbeaufsichtigten Betrieb; bereits offenes Gate** | Kontrollierter Concierge-Test kann mit benanntem Owner und Runbook arbeiten. Öffentlicher Self-Service/Alerts/Renewal benötigen durable Queue/Outbox, Retry, DLQ und Monitoring. |
| Salary Radar besitzt keine reale Quelle | **hoch, korrekt** | Der fiktive Datensatz bleibt Demo-only. Die LIVE-Seite ist jetzt fail-closed, `noindex` und nicht in der Sitemap. |
| Google for Jobs kam erst in Phase 15 | **falsch** | `JobPosting`-JSON-LD entstand bereits in Phase 07; Phase 15 härtete und validierte es. Kein Fix nötig. |
| AVG fehlt | **kritisches Go-live-Gate** | Ein entgeltlicher Online-Stellenmarkt und insbesondere Radar-Matching/Kontaktfreigabe können bewilligungspflichtige Arbeitsvermittlung sein. Vor realem Betrieb ist eine konkrete behördliche/fachjuristische Beurteilung nötig. |

## 2. Zahlungsbereitschaft statt Mock-Conversion

Mock Checkout belegt Preisquelle, Order-, Steuer-, Invoice-, Entitlement- und
Idempotenzlogik. Er belegt weder Karten-/Bankautorisierung noch Kaufabbruch an
echter Zahlungsfriktion, Refunds, Chargebacks oder Zahlungsbereitschaft.
Stripe-Testmode wäre ebenfalls nur technische Integration.

- [ ] Commercial Owner friert **vor** dem ersten Angebot Zielsegment,
  Angebotsvarianten, Stichprobe, Erfolgsschwelle, Laufzeit, Kündigung/Refund und
  Auswertungsregel ein.
- [ ] Qualifizierte Schweizer KMU erhalten reale, identische und
  nachvollziehbar protokollierte Angebote; Zusage und Ablehnung werden getrennt
  von Produktklicks erfasst.
- [ ] Mindestens ein fachlich freigegebener, tatsächlich beglichener
  Design-Partner-Auftrag beweist ersten Geldfluss. Das ist noch kein
  Product-Market-Fit.
- [ ] Die vorab definierte Stichproben-/Erfolgsschwelle entscheidet über Preis
  und Packaging; Mock-Abschlüsse zählen dabei null.
- [ ] Vor öffentlichem Self-Service existiert ein separater Payment-ADR mit
  hosted Checkout, signierten Webhooks, serverseitigem Betrag/Währung,
  Idempotenz, Reconciliation, Retry, Refund/Chargeback/Dunning, Monitoring und
  Runbook. Fehlende Production-Konfiguration fällt geschlossen aus und niemals
  still auf Mock zurück.

Ein manueller, korrekt versteuerter und rechtlich freigegebener Rechnungs-Pilot
kann Zahlungsbereitschaft vor einer Stripe-Integration testen. Resend oder
Supabase beantworten diese Geschäftsannahme nicht und werden nicht künstlich
an das Payment-Paket gekoppelt.

## 3. Cashflow, Burn und Break-even

Der bestehende Basis-Endpunkt ist korrekt:

- Umsatz: `150 × CHF 330 + CHF 12'000 = CHF 61'500`;
- Kosten: `CHF 42'000 + 600 × CHF 22 + CHF 7'000 = CHF 62'200`;
- Ergebnis: `CHF −700/Monat`.

Er ist aber nur ein Monat-18-Snapshot. Eine illustrative lineare Rampe von null
vor Monat 1 auf diesen Endpunkt in Monat 18, fixe CHF 42'000 ab Monat 1,
lineare direkte Kosten und Tools von CHF 3'000 auf CHF 7'000 ergibt rund
**CHF 387'000 kumulierten Verlust**. Bei CHF 7'000 Tools ab Monat 1 sind es rund
**CHF 423'000**. Werden zusätzlich `150 × CHF 1'100 = CHF 165'000` CAC als
separater Cash-Abfluss angesetzt, liegt die Sensitivität bei rund
**CHF 552'000–588'000**. CAC darf dabei nicht nochmals im Sales-Fixblock stecken.
Das erklärt die genannte Grössenordnung, ist aber keine Prognose.

Bei den Basisrelationen entsprechen 600 aktive Arbeitgeber 150 Zahlenden:
direkte Kosten sind damit CHF 88 je Zahlendem. Recurring-only Break-even liegt
bei ungefähr `CHF 49'000 ÷ (330−88) = 203` Zahlenden. Wenn der
Einmalumsatz proportional CHF 80 je Zahlendem beiträgt, sind es ungefähr
`CHF 49'000 ÷ (330+80−88) = 153`. **42–90** ist ohne einen explizit kleineren
Fixkostenblock keine ableitbare Aussage.

- [ ] Vor Hiring oder bezahlter Akquise existiert ein monatliches
  18-/24-Monatsmodell mit Opening Cash, Hiring/Fixkosten, Paid-/Free-Cohorts,
  ARPA, Einmalumsatz, VAT/Payment Fees, CAC-Zahlungszeitpunkt, Support,
  Infrastruktur, Churn, Pause/Reaktivierung, kumuliertem Burn und Peak Funding.
- [ ] CAC und Sales-Personal/-Fixkosten sind überschneidungsfrei definiert.
- [ ] Base, founder-lean und downside besitzen je Break-even, Runway und
  Finanzierungspuffer; Annahmeänderungen sind versioniert.

## 4. Episodisches Hiring und Packaging

- [ ] Drei klar verschiedene Angebote werden mit echtem Geld getestet:
  monatlicher Workflow/aktive Slots, zeitlich begrenzter 30-/45-/90-Tage
  Hiring-Sprint und kleiner Retainer plus verbrauchbare Credits.
- [ ] `pause → reactivation` wird als eigener Lifecycle gemessen und nicht
  automatisch als gescheiterte dauerhafte Retention gewertet.
- [ ] Kohorten verbinden Angebot, Aktivierung, erste publizierte Stelle,
  qualifizierte Bewerbung/Gespräch, bezahlten Abschluss, Renewal/Pause und
  Reaktivierung.
- [ ] Ein Wettbewerbsvergleich normalisiert Laufzeit, Reichweite,
  Veröffentlichungsplätze, Workflow, Talentzugang und tatsächliche Ergebnisse.
  Der aktuelle jobs.ch-Hinweis „kostenlos starten / Werbeprodukte ab CHF 290“
  ist Kontext, kein Preisbeweis:
  <https://b2b.jobs.ch/de-arbeitgeber-stelle-job-inserieren>.

## 5. AVG/AVV vor jeder realen Vermittlung

SECO hält fest, dass regelmässige, entgeltliche Zusammenführung von
Stellensuchenden und Arbeitgebenden eine Vermittlungsbewilligung verlangt;
Inlandstätigkeit ist kantonal, grenzüberschreitende Tätigkeit benötigt
zusätzlich eine eidgenössische Bewilligung:
<https://www.seco.admin.ch/de/private-arbeitsvermittlung-und-personalverleih>.
Die konkrete Einordnung richtet sich nach AVG/AVV und dem tatsächlichen
Daten-, Kontakt-, Vertrags- und Geldfluss, nicht nur nach der Bezeichnung
„Stellenportal“ oder „Success Fee“.

- [ ] Sitzkanton/Schweizer Counsel beurteilt den dokumentierten öffentlichen
  Stellenmarkt, Bewerbungspfad, Radar-Suche, Contact Request, Reveal,
  Abonnements, Contact Packs und eine mögliche Success Fee.
- [ ] Vor paid LIVE liegt entweder die erforderliche kantonale
  Vermittlungsbewilligung oder eine schriftliche, flowspezifische Beurteilung
  vor, weshalb keine Bewilligung nötig ist.
- [ ] Grenzüberschreitende Sichtbarkeit, Kandidatenwohnsitz, Arbeitsort und
  Kontaktfluss bleiben bis zur separat geprüften eidgenössischen Freigabe
  begrenzt.
- [ ] AGB/Verträge, Ausschreibung, Reporting, Datenschutz,
  Profil-/Kontaktaufbewahrung, Consent-Evidenz und Löschung sind gegen AVG,
  AVV und DSG geprüft.
- [ ] Success Fee bleibt unabhängig von ihrer Preislogik technisch deaktiviert,
  bis AVG-, Vertrags-, Tax-, Refund- und Operations-Gates geschlossen sind.

Primärtexte: [AVG](https://www.fedlex.admin.ch/eli/cc/1991/392_392_392/de),
[AVV](https://www.fedlex.admin.ch/eli/cc/1991/408_408_408/de) und
[GebV-AVG](https://www.fedlex.admin.ch/eli/cc/1991/425_425_425/de).
Das ist eine Risikoanalyse, keine Rechtsberatung.

## 6. Reale Salary-Radar-Daten

Der bevorzugte amtliche Kandidat ist ein versionierter Snapshot aus der
BFS-Lohnstrukturerhebung 2024 über die offizielle
[PxWeb-API](https://www.pxweb.bfs.admin.ch/api/v1/de/px-x-0304010000_205/px-x-0304010000_205.px).
Die öffentliche Granularität ist Grossregion und CH-ISCO-19-Berufsgruppe, nicht
Kanton. Diese Tabelle ist ein zu prüfender Quellenkandidat, **kein** direkt
passender Ersatz für `SALARY_RADAR_POLICY_V1`: Dimensionen, Perioden,
Quantile, Unsicherheit/Suppression und Stichprobennachweis müssen zuerst gegen
den öffentlichen Produktvertrag geprüft werden. Salarium oder Webseiten werden
nicht gescrapt.

- [ ] Product/Data Owner friert CH-ISCO-19- und Grossregionsmapping,
  Quellenangabe, Jahr, Standardisierung, Median/Perzentile,
  Unsicherheitszeichen, Suppression, Mindeststichprobe und Refresh-Owner ein.
- [ ] Eine neue Policy-/Schema-/DTO-/UI-Version bildet die tatsächlich
  verfügbaren Dimensionen ab. Alter wird nicht zu Seniorität umgedeutet,
  Grossregion nicht als Kanton ausgegeben, Monatslohn nicht ohne freigegebene
  Methodik zum Jahreslohn hochgerechnet und eine fehlende Stichprobengrösse
  niemals erfunden.
- [ ] Kann die Quelle die benötigten Quantile, Unsicherheit oder
  Mindestmengen-Evidence nicht tragen, liefert das Produkt ehrlich kein
  Ergebnis oder benötigt eine andere rechtmässige Quelle; die fiktive
  `sampleSize` des V1-Demo-Vertrags wird nicht übernommen.
- [ ] Kantonseingabe wird im Ergebnis ehrlich als Zuordnung zu einer
  **Grossregion** erklärt; es werden keine kantonsgenauen BFS-Werte erfunden.
- [ ] Ingestion speichert einen unveränderlichen Snapshot mit Quelle,
  Referenz-URL, Datenstand, Methodik, Reviewstatus, Gültigkeit und
  Prüfsumme; Schema-/Freshness-/Provenance-Fehler fallen geschlossen aus.
- [ ] Fachreview und Tests decken Mapping, Quantile, fehlende/unsichere Zellen,
  Aktualisierung und Attribution ab.
- [ ] Erst danach darf `/salary-radar` in Production indexiert und wieder in
  die Sitemap aufgenommen werden.

## 7. Worker und Radar-Wedge

- [ ] Vor unbeaufsichtigtem öffentlichem Self-Service existieren durable
  DB-Queue/Outbox, Lease/Singleton, Idempotenz, Retry/Backoff, Dead-Letter,
  Metriken/Alerts und ein benannter Operator.
- [ ] Restart-, Parallelitäts- und Provider-Ausfalltests belegen Alerts,
  Notifications, Renewal sowie Subscription-/Catalog-/Credit-/Contact-/
  Job-/Boost-Abläufe.
- [ ] Ein begrenzter Concierge-Pilot darf explizite Commands nur mit
  dokumentiertem Zeitplan, Owner, Kontrollliste und Eskalation verwenden.
- [ ] Radar wird als Wedge anhand realer Clusterkohorten geprüft:
  Opt-in-Dichte, eligible Cohort, Search→Contact, Accept, Reveal,
  qualifiziertes Gespräch und bezahlter Zugang/Kontakt. „Moat“ wird erst nach
  belegtem Netzwerkeffekt behauptet.
