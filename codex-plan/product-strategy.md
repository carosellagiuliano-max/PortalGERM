# SwissTalentHub — Produkt-, Marketplace- und Wachstumsstrategie

> **Status:** Verbindliche Produktgrundlage für die Implementierungsplanung. Preise, Volumen und Marktkennzahlen sind Hypothesen, bis echte Kunden- und Nutzungsdaten vorliegen. Dieses Dokument ersetzt keine Rechts-, Steuer- oder Datenschutzberatung.

## 1. Executive Summary

SwissTalentHub wird als **Schweizer Karriere-Entscheidungsplattform mit Stellenmarktplatz** positioniert. Der Markteintritt erfolgt nicht gleichzeitig für alle Regionen und Berufe: Die Plattform startet als kontrollierter, deutschsprachiger Cluster für Schweizer KMU mit wiederkehrendem Rekrutierungsbedarf und Kandidatinnen und Kandidaten, die Lohntransparenz, nachvollziehbare Stellenqualität und diskrete Wechselmöglichkeiten schätzen.

Die strategische Wette besteht aus vier verbundenen Nutzenbausteinen:

1. **Entscheidungsnutzen vor Registrierung:** Stellen, Lohnband, Fair-Job-Score und Arbeitgeberinformationen sind öffentlich verständlich.
2. **Wiederkehrender Kandidatennutzen:** SwissJobPass, gespeicherte Suchen, Jobabos, Bewerbungsstatus und freiwilliger anonymer Talent Radar bringen Nutzer zurück.
3. **Messbarer Arbeitgebernutzen:** schneller publizieren, Inserate anhand konkreter Hinweise verbessern, Bewerbungen strukturiert bearbeiten und Resultate je Stelle sehen.
4. **Vertrauensbasierte Monetarisierung:** Arbeitgeber bezahlen für Kontingente, Arbeitsabläufe, Reichweite und kontrollierten Talentzugang; bezahlte Reichweite beeinflusst niemals den Fair-Job-Score.

Das MVP validiert zuerst einen liquiden Marktplatz und drei End-to-End-Schleifen: **Suchen → Bewerben → Status**, **Stelle erstellen → moderieren → Bewerbung bearbeiten** und **Planlimit → Mock-Kauf → serverseitige Freischaltung**. Breite Integrationen, automatisierte Vermittlungsentscheide und operative Sonderfälle werden erst nach Nutzungsnachweis ergänzt.

## 2. Vision, Positionierung und strategische Leitplanken

### Vision

Menschen in der Schweiz sollen eine berufliche Entscheidung nicht aufgrund einer dünnen Stellenanzeige treffen müssen. Arbeitgeber sollen mit transparenten, gut geführten Rekrutierungsprozessen sichtbar erfolgreicher werden können.

### Positionierung

**Für qualifizierte Berufsleute und Schweizer KMU ist SwissTalentHub die Karriere-Entscheidungsplattform, die Stellenqualität, Lohnorientierung und Passung nachvollziehbar macht und zugleich diskrete Kontaktaufnahme ermöglicht. Anders als eine reine Reichweitenbörse verbindet sie transparente Inserate, einen persönlichen SwissJobPass und einen anonymen Talent Radar mit einem operativ nutzbaren Recruiting-Cockpit.**

### Launch-Wedge

- **Primäre Arbeitgeber:** eigenständige Schweizer KMU mit 20–249 Mitarbeitenden, 3–30 Einstellungen pro Jahr und ohne ausgereiftes ATS oder grosses internes Recruiting-Team.
- **Primäre Kandidaten:** aktiv oder latent wechselbereite Fachkräfte mit Berufserfahrung, die ihren Marktwert verstehen und Kontrolle über ihre Daten behalten wollen.
- **Startcluster als Hypothese:** deutschsprachige Regionen Zürich/Aargau/Bern; zunächst Pflege/Gesundheit und Engineering/Technik. Vor öffentlichem Launch muss durch Interviews und Angebotsakquise bestätigt werden, dass je Cluster genügend reale Stellen und Kandidateninteresse entstehen.
- **Sekundär:** Berufseinsteiger, Quereinsteiger, weitere Kantone/Sprachen, grössere Arbeitgeber und interne Recruiter.
- **Später:** Agenturen mit mehreren Mandanten, Enterprise-ATS-Integrationen und landesweit optimierte französische/italienische Inhalte.

Die KMU-Fokussierung ist plausibel, weil KMU laut BFS mehr als 99 % der marktwirtschaftlichen Unternehmen und über zwei Drittel der Beschäftigung ausmachen; daraus wird **keine** Aussage über Zahlungsbereitschaft abgeleitet. Quelle: [BFS, Porträt der Schweizer KMU](https://www.swissstats.bfs.admin.ch/data/webviewer/appId/ch.admin.bfs.swissstat/article/issue230616612100-01/package).

### Nicht-Ziele des MVP

- kein Ersatz für ein vollwertiges Enterprise-ATS;
- keine automatisierte Einstellungsentscheidung oder automatische Kandidatenablehnung;
- keine Erfolgsgebühr ohne vorgängige rechtliche Prüfung;
- kein Scraping fremder Stellenportale und kein ungeklärter Feed-Import;
- keine Behauptung vollständiger DSG-Konformität oder Produktionsreife;
- keine künstliche Marktplatzaktivität in einer Produktionsumgebung;
- keine landesweit perfekte Mehrsprachigkeit vor validiertem deutschsprachigem Kernablauf.

## 3. Zielgruppen, Kernprobleme und überprüfbare Nutzenversprechen

| Rolle / Segment | Kernproblem | Konkretes Nutzenversprechen | Nachweis im Produkt | Primärer Erfolgsindikator |
|---|---|---|---|---|
| Aktive Kandidaten | Anzeigen sind unvollständig; Bewerbung verschwindet in einer Blackbox | Vor der Bewerbung Lohn, Transparenzmerkmale und Prozessversprechen erkennen; Bewerbung und Antwortstatus an einem Ort verfolgen | Stellen-Detail, Fair-Job-Score-Begründung, Application Timeline | qualifizierte Bewerbungen; Statusaktualität |
| Latent Wechselwillige | Interesse ohne öffentliche Sichtbarkeit; Marktwert unklar | Markt und Lohn erkunden, SwissJobPass vorbereiten und anonym opt-in erreichbar werden | Salary Radar, gespeicherte Suchen, Radar-Vorschau, Reveal-Kontrolle | wiederkehrende aktive Kandidaten; akzeptierte Kontakte |
| KMU-Arbeitgeber | wenig Recruiting-Kapazität; unklare Inseratqualität und Resultate | In einem geführten Ablauf bessere Stellen erstellen, Bewerbungen bearbeiten und Wirkung messen | Job-Wizard, Score-Vorschläge, Pipeline, stellenbezogene Analytics | Zeit bis Publikation; qualifizierte Bewerbungen/Stelle |
| Unternehmens-Recruiter | Zusammenarbeit, Zuständigkeit und Kandidatenstatus zerfallen in E-Mail | Einladung, Job-Zuweisung, Pipeline und Auditspur innerhalb eines Unternehmens | Mitgliedschaften, Job Assignments, Activities | Antwortzeit; bearbeitete Bewerbungen |
| Externe Recruiter | Mandantendaten müssen strikt getrennt sein | P1: ausdrücklich erteilte, widerrufbare Mandate je Unternehmen/Job statt globalem Zugriff | RecruiterMandate + JobAssignment | aktive Mandate ohne Cross-Tenant-Vorfall |
| Administrator/Betrieb | Moderation, Billing, Support und Sales sind über viele Tabellen verteilt | priorisierte Arbeitslisten mit nächster Aktion, Verantwortlichem und Frist | Business Cockpit, Moderationsqueues, Sales Tasks | Queue-Alter; abgeschlossene Aktionen |
| Partner | Relevante Stellen oder Zielgruppen, aber keine gemeinsame technische Basis | lizenzierte, nachvollziehbare Zufuhr mit Herkunft, Consent und Qualitätskontrolle | Feed-Vertrag, ImportRun, Source Attribution | gültige, einzigartige Imports; Partner-Conversions |

## 4. Differenzierung und Vertrauenssystem

### Differenzierende Produktmechaniken

- **Fair-Job-Score:** versionierte, erklärbare Bewertung beobachtbarer Inseratmerkmale. Keine Zahlung und kein Boost darf den Score verändern.
- **SwissJobPass:** Kandidatenprofil als wiederverwendbare Entscheidungs- und Bewerbungsgrundlage, nicht bloss ein hochgeladener Lebenslauf.
- **Salary Radar:** Orientierung und Akquisitionsinstrument; zeigt Datengrundlage, Stichprobengrösse/Abdeckung und Unsicherheit statt Scheingenauigkeit.
- **Anti-Ghosting:** Arbeitgeber können ein Antwortziel zusagen; die Plattform misst tatsächliche Antwortzeit. Ein Badge wird nur bei genügend Evidenz gezeigt.
- **Anonymer Talent Radar:** Opt-in, minimaler anonymer Datensatz, kontaktbezogene Freigabe durch den Kandidaten und vollständige Auditspur.
- **Resultat-Cockpit:** Arbeitgeber sehen nicht nur Views, sondern den Trichter von qualifizierter Ansicht bis beantworteter Bewerbung und konkrete Verbesserungsaktionen.

### Vertrauensregeln

- Arbeitgeberverifizierung ist ein separates Vertrauenssignal und kein käuflicher Score-Bestandteil.
- Gesponserte Platzierung trägt auf jeder Darstellung das Label **„Geboostet“**.
- Salary Radar und Match-Score zeigen Eingaben, Grenzen und Aktualität.
- Demo-/Seed-Daten sind nur in lokalen Demo-Umgebungen sichtbar und eindeutig als Demo markiert; sie dürfen nie als reale Nachfrage erscheinen.
- Jede öffentliche Kennzahl braucht eine definierte Datenquelle, einen Zeitraum und eine Mindestdatenmenge.

## 5. Marketplace-Startstrategie

### Prinzip

Liquidität wird pro **Region × Berufsfeld** gemessen. Eine landesweite Gesamtzahl kann einen leeren lokalen Markt verdecken. Ein Cluster wird erst öffentlich beworben, wenn Angebot, Nachfrage und betriebliche Reaktionsfähigkeit gemeinsam den Launch-Gate erfüllen.

### Vier Startstufen

1. **Discovery und Concierge (6–8 Wochen):** 20 Kandidateninterviews, 15 Arbeitgeberinterviews, 5 Design-Partner. Stellen werden mit Einwilligung manuell eingepflegt; kein öffentlicher Eindruck eines fertigen Marktplatzes.
2. **Angebot aufbauen:** 15–20 verifizierte Design-Partner, kostenloses erstes Inserat, lokaler XML/JSON-Dateiimport nur bei Nutzungsrecht, redaktionelle Qualitätshilfe. CSV und URL-Fetch sind im P0 nicht unterstützt. Zielhypothese: mindestens 50 aktuelle reale Stellen je Startcluster.
3. **Nachfrage aktivieren:** Salary-Radar- und Karriereinhalte, Hochschul-/Verbandskooperationen, Kandidaten-Warteliste, Jobabos und Empfehlungen. Kandidaten werden nur nach ausdrücklicher Einwilligung in den Talent Radar aufgenommen.
4. **Kontrollierter öffentlicher Launch:** Clusterweise Landingpages und Sales-Kampagnen; schwache Cluster bleiben `noindex` und erhalten keine irreführende Angebotsbehauptung.

### Launch-Gates (interne Hypothesen, keine Marktwerte)

| Gate je Cluster | Ziel vor öffentlicher Akquise | Stop-/Lernsignal |
|---|---:|---|
| verifizierte Arbeitgeber | ≥ 15 | weniger als 5 wiederholen nach Gratisinserat |
| publizierte, nicht abgelaufene Stellen | ≥ 50 | > 20 % älter als Qualitäts-/Aktualitätsgrenze |
| aktivierte Kandidaten (`CandidateProfile=COMPLETE` nach dem verbindlichen Mindestfeld-Prädikat) | ≥ 200 | Registrierung ohne Aktivierung > 70 % |
| Bewerbungen pro Stelle in 30 Tagen | Median ≥ 3 | viele Views, aber Median < 1 |
| Arbeitgeberantwort | ≥ 70 % binnen zugesagter Frist | Ghosting > 30 % |
| Suchergebnisabdeckung | ≥ 80 % der beworbenen Suchkombinationen liefern 5+ relevante Stellen | programmatic SEO erzeugt dünne Seiten |

Diese Werte sind Startannahmen und werden nach den ersten zwei Kohorten nur über eine neue versionierte Policy angepasst. `CLUSTER_LAUNCH_POLICY_V1` in Phase 15 definiert Fenster, Denominatoren, Dedupe, LIVE-Ausschluss und die getrennte Product-/Ops-Freigabe; ein Gate ist kein öffentliches Leistungsversprechen.

### Erlaubte Angebotsquellen

- direkt erstellte Stellen verifizierter Arbeitgeber;
- vertraglich erlaubte Feeds von Design-Partnern und ATS-Anbietern;
- Partner-/Verbandsfeeds mit dokumentierter Lizenz und Herkunft;
- manuelle Erfassung im Auftrag eines Arbeitgebers mit Freigabeprozess.

Jeder Import speichert Quelle, Nutzungsgrundlage, Zeitstempel, Original-ID, Prüfsumme, Ablaufdatum und Dublettenentscheidung. Fremde Portale werden nicht gescrapt.

## 6. Kandidatenreise

| Schritt | Nutzerziel und Hauptaktion | Abbruch-/Vertrauensbarriere | Produktunterstützung und Benachrichtigung | Conversion / Datenschutz |
|---|---|---|---|---|
| 1 Entdecken | relevante Stelle, Lohnseite oder Ratgeber öffnen | unbekannte Marke | klare de-CH-Nutzenbotschaft, Quelle/Aktualität, schnelle mobile Seite | `public_value_view`; keine Registrierungspflicht |
| 2 Verstehen | Nutzen und Differenzierung prüfen | Marketing ohne Beleg | Score-Beispiel, Datenschutz-Kurzfassung, reale Arbeitgeberkennzeichnung | Klick auf Suche/Salary Radar |
| 3 Suchen | Stellen per Beruf, Region, Pensum filtern | leere/irrelevante Resultate | URL-basierte Filter, Ergebniszahl, Alternativen, keine Sackgasse | `search_success`; nur notwendige Analytics |
| 4 Entscheiden | Lohn, Score und Arbeitgeber beurteilen | Score wirkt willkürlich | Faktoren, Datenstand, fehlende Angaben, Boost-Label | Detail→Merken/Bewerben |
| 5 Merken/Bewerben | Stelle speichern oder Bewerbung starten | früher Registrierungszwang | Entwurf lokal/kurzlebig halten; Registrierung erst beim Persistieren | sichere `next`-Weiterleitung; Einwilligung getrennt |
| 6 Registrieren | Konto erstellen | Aufwand, E-Mail-Missbrauch | kurzes Formular, generische Auth-Fehler, Zweckhinweis | Konto erstellt; kein Radar-Opt-in als Default |
| 7 SwissJobPass | Mindestprofil vervollständigen | langes Formular, CV-Sorge | Progress, „später fortsetzen“, strukturierte Felder, CV-Metadaten-Mock | Aktivierung nur durch `completeCandidateOnboarding` nach Mindestfeldern; Prozent ist Anzeige, Bewerbung bleibt unabhängig |
| 8 Empfehlungen | passendere Stellen sehen | unverständlicher Match-Score | erklärbarer kandidaten-seitiger Score, Änderungsoptionen | Empfehlung geöffnet/gespeichert |
| 9 Jobabo | Suche speichern | zu viele E-Mails | Frequenzwahl, Preview, Pause/Abmelden in einem Schritt | Jobabo aktiv; Consent protokolliert |
| 10 Bewerben | Bewerbung prüfen und absenden | Unsicherheit über Empfänger/Daten | Datenvorschau, Duplikatsschutz, Bestätigung | `application_submitted`; nur Empfängerfirma erhält Daten |
| 11 Verfolgen | Status und nächste Schritte sehen | Status veraltet | Timeline, „zuletzt aktualisiert“, Rückzugsmöglichkeit | 7-/14-Tage-Reaktivierung bei offenem Status |
| 12 Kommunizieren | sichere Nachricht senden | Spam/Missbrauch | Thread-Kontext, Melden/Blockieren, Benachrichtigungspräferenz | Antwortquote; Inhalte nicht in Analytics-Logs |
| 13 Radar wählen | anonym erreichbar werden | Identitätsleck | feldweise Vorschau, Opt-in ohne Dark Pattern, jederzeit pausierbar | ausdrücklicher Consent + Version |
| 14 Kontakt prüfen | Anfrage akzeptieren/ablehnen | unklarer Arbeitgeber/Zweck | verifizierte Firma, Rolle, Nachricht, Ablaufdatum | Ablehnung ohne Identitätsfreigabe |
| 15 Identität freigeben | gezielt für Firma/Thread offenlegen | Freigabe ist faktisch nicht rückholbar | Bestätigungsdialog nennt Felder und Empfänger; Audit/Bestätigung | RevealGrant je Firma/Thread; kein globales Reveal |
| 16 Wiederkehren | neue Chancen/Status sehen | irrelevante Benachrichtigungen | digest-basierte Empfehlungen, Status- und Alert-Mails, Präferenzzentrum | WAU/MAU, Alert→Detail, kein Zwangs-Opt-in |

## 7. Arbeitgeberreise

| Phase | Ziel / Hauptaktion | Kritische Zustände und Regeln | Conversion-/Retention-Mechanik |
|---|---|---|---|
| Entdecken | ROI, Zielgruppe und Prozess verstehen | branchenspezifische Landingpage, Preis-/Leistung ohne versteckte Gebühren, Demo-Anfrage | Demo-Lead oder „erste Stelle vorbereiten“ |
| Registrieren | Benutzer, Firma und Owner-Mitgliedschaft anlegen | Dubletten-/Claim-Prozess, E-Mail-Domain als Signal statt automatischer Beweis | Onboarding-Checkliste |
| Verifizieren | Firma beanspruchen und Nachweise liefern | `CHANGES_REQUESTED` wird im selben VerificationRequest resubmittet; nach `REJECTED/REVOKED` entsteht ein neuer superseding Request; Begründung/Events/Audit, Company-Sperre separat | Profilvertrauen und Publikationsfreigabe |
| Team | Nutzer einladen und Rollen vergeben | Ablauf/Single-use der Einladung, Seat-Limit, letzter Owner nicht entfernbar, Unternehmenswechsel | zusätzlicher Seat als nutzwertbasierter Upgrade-Trigger |
| Stelle erstellen | 5-Schritt-Draft mit Auto-Save | serverseitige Revalidierung, klare Gehalts-/Pensumsfelder, Score-Vorschläge | Time-to-first-draft, Completion Rate |
| Meldepflicht prüfen | Orientierung vor Publikation | jährlich versionierter Mock-Datensatz; offizieller Check bleibt massgeblich | reduziert Unsicherheit, kein Rechtsversprechen |
| Moderation | einreichen, Rückfragen beantworten | Statusmaschine, Ablehnungsgrund, Revision, SLA, Benachrichtigung | Time-to-publish |
| Publizieren | reale Stelle live schalten | Kontingent atomar prüfen, Ablauf/Paused, Vorschau, Erfolg | erste Stelle gratis; Upgrade erst bei belegtem Zusatznutzen |
| Bewerbungen | Triage, Status, Notiz, Nachricht | Ownership/JobAssignment, Kandidatenrückzug, IDOR-Schutz, Statushistorie | Antwortquote und Time-to-first-response |
| Optimieren | Trichter und konkrete Empfehlungen sehen | Mindestmengen/Datenschutz, kein Vanity-only-Dashboard | „viele Views, wenig Starts“ → Inserat verbessern vor Boost |
| Talent Radar | passende Opt-in-Kandidaten anonym suchen und gezielt anfragen | Entitlement vor Query, Kohortenschutz, atomarer Contact-Verbrauch, Accept/Decline vor separatem Reveal | Suche → Kontakt → Annahme; Identität nur nach kandidateninitiiertem Grant |
| Upgrade | Limit oder Premiumworkflow erweitern | nachvollziehbarer Vergleich, ADR-028-Proration/Allowance-Flooring, idempotenter Mock-Kauf | kontextueller Trigger; kein künstliches Blockieren des Grundablaufs |
| Verlängern | Resultat und Nutzung beurteilen | 30/14/7-Tage-Hinweise, Export/Rechnungen, Kündigung ohne Hindernis | Resultatbericht, Jahresoption nach erfolgreichem Monat |
| Downgrade/Kündigen | Kosten reduzieren | Vorteile bis zum exklusiven `currentPeriodEnd`; Überschussstellen bleiben lesbar, aber neue Publikation blockiert; klare Datenfolgen | Pause/Downsell vor Verlust, Exit-Grund freiwillig |
| Zahlungsausfall | Zugang geordnet behandeln | P2 realer Provider: Grace Period, Dunning, keine rückwirkende Datenlöschung | Reaktivierung, Audit |
| Sperre/Missbrauch | Betrieb schützen | Firma gesperrt → aktive Stellen pausieren, Sessions/Rollen prüfen, Einspruchskanal | Vertrauensschutz vor Umsatz |

## 8. Recruiter-, Admin- und Betriebsprozesse

### Recruiter P0

- Einladung durch Company Owner/Admin; Mitgliedschaft genau einer Firma pro Kontext.
- Zugriff nur auf zugewiesene Jobs und deren Bewerbungen, sofern die Mitgliedschaftsrolle dies verlangt.
- Darf Pipeline/Kommunikation bearbeiten, aber weder Billing, Company Ownership noch Verifizierung ändern.
- Entfernung widerruft neue Zugriffe sofort; historische Aktionen bleiben auditierbar.
- Ein Recruiter mit mehreren Firmen wählt einen aktiven Firmenkontext; jede Query trägt und prüft `companyId` serverseitig.

### Agenturmodell P1

`RecruiterMandate` verbindet Agentur-Benutzer, Kundenfirma, erlaubte Jobs, Rechte, Gültigkeit und erteilenden Owner. Mandate sind widerrufbar und dürfen keinen firmenübergreifenden Kandidatenexport erlauben.

### Betriebsqueues

| Queue | Sortierung / SLA-Hypothese | Hauptaktionen | Schutz |
|---|---|---|---|
| Job-Moderation | Risiko, Alter, Launch-Cluster | genehmigen, Rückfrage, ablehnen, duplizieren | Vier-Augen-Prinzip P1 bei Risiko |
| Firmenprüfung | Nachweis vollständig, Alter | verifizieren, Nachweis anfordern, sperren | Begründung + Audit |
| Missbrauch | Schweregrad, offene Gefahr | Inhalt ausblenden, Nutzer/Firma einschränken, Fall schliessen | minimale PII, Need-to-know |
| Import | Fehlerquote, Dublette, Aktualität | Vorschau, einzelne Zeile freigeben, Rollback | Quelle/Lizenz dokumentiert |
| Billing | offene/fehlerhafte Orders | prüfen, stornieren, Gutschrift später | idempotente Zustände; kein manuelles Ledger-Überschreiben |
| Sales | Produktqualifiziertes Signal | Aufgabe zuweisen, Kontakt/Outcome protokollieren | Marketing-Consent und Löschfristen |
| Support/Privacy | Frist/Risiko | Export/Delete-Mock, Identitätsprüfung, Antwort | keine sensiblen Daten in Freitextlogs |
| Content/SEO | Reviewstatus, Aktualität, Cluster-Gate | Preview, Review, Publish/Unpublish, Aktualisierung zuweisen | sichere Revision; Publish umgeht nie Liquiditäts-/Indexgate |

### Business Cockpit: Handlung statt Kennzahlenwand

Jede Empfehlung enthält `reasonCode`, Evidenzzeitraum, Firma/Job, erwartete Aktion, Priorität, verantwortliche Person, Fälligkeit und Outcome. Beispiele:

- Kontingent ≥ 80 % und nachgewiesene Bewerbungsaktivität → Upgrade-Gespräch.
- Viele Detailansichten, wenige Bewerbungsstarts → Inhalt/Formular prüfen; Boost erst als zweite Option.
- Lange Antwortzeit → Workflow-/Teamhinweis statt Reichweitenverkauf.
- Abo endet in 30 Tagen und Nutzung ist hoch → Resultatbericht + Jahresangebot.
- Ungenutzte Credits → Anleitung, nicht zusätzlicher Verkauf.
- Cluster mit zu wenig Stellen → Akquise-Task; entsprechende SEO-Seite bleibt `noindex`.

**P0-Basis:** operative Queue-Alter, qualifizierte Leads, Cluster-Lücken und einfache regelbasierte Aktionen mit Evidenz/Owner/Outcome. **P1-Erweiterung (Owner Phase 12 nach P0-Billing-Gate):** `/admin/analytics`, 30/14/7-Tage-Verlängerungs-, ungenutzte/auslaufende Credits-, Inaktivitäts-/Churn- und Funnel-Signale als idempotente SystemTasks/Notifications mit Evidenz, Owner, Due und Outcome; sie dürfen die P0-Moderation nicht blockieren.

## 9. Growth-, SEO- und Vertriebssystem

| Kanal | Zielgruppe / Kernbotschaft | Einstieg / CTA | Conversion und Folgeprozess | Messgrösse / Datenschutz |
|---|---|---|---|---|
| Job-SEO | aktive Suchende: transparente reale Stelle | Jobdetail → bewerben/merken | Bewerbungsstart; ähnliche reale Stellen | qualifizierte organische Sessions; keine private Daten |
| Beruf×Region | Suchende im liquiden Cluster | kuratierte Landingpage → Jobabo | Alert-Erstellung, wöchentlicher Digest | Index nur bei Mindestbestand + einzigartigem Inhalt |
| Salary Radar | aktive/latente Fachkräfte | Ergebnis → Suche speichern/JobPass | personalisierte Orientierung nach Registrierung | Ergebnisnutzung; keine Scheingenauigkeit/kein PII-Leak |
| Ratgeber | Karriereentscheider | Checkliste/Artikel → relevante Suche | thematischer Digest | organische Aktivierung, Consent für E-Mail |
| Empfehlungen | zufriedene Kandidaten | Stelle/öffentliche Seite teilen | Deep Link ohne Referral-Leak | Share→qualifizierter Besuch; keine Bewerbungsdaten |
| Reaktivierung | registrierte Kandidaten | Status/Alert/Digest → Detail | Präferenz/Frequenz beachten | Reaktivierungsrate, Abmeldungen |
| Branchen-Landingpages | KMU | Beispielresultat → Demo/erste Stelle | Lead-Scoring, menschlicher Follow-up | Lead→Demo; Rechtsgrund/Consent |
| Design-Partner-Outbound | ausgewählte KMU | Interview/Concierge-Onboarding | CRM Task, 3 Kontaktversuche max. als Policy-Hypothese | Demo→erste publizierte Stelle |
| Produktgetriebener Upgrade | aktive Free-Arbeitgeber | kontextuelle Limitseite → Vergleich | Mock-Checkout; Resultatbericht | Limit→Kauf, kein Dark Pattern |
| Partner | Verbände/Bildung/ATS | Co-Landingpage/Feed | Attribution und Qualitätsreview | aktive Jobs/Kandidaten je Partner; Vertrag nötig |

**Referral P1:** Ein rotierbarer, opaker Code darf nur auf öffentliche Stellen/Seiten verweisen. `ReferralLink` und `ReferralAttribution` speichern Quelle, Ziel, pseudonyme Session, Zeitfenster und Conversion ohne Candidate-, Application- oder Kontaktinhalt. Dedupe, Rate-Limit, Self-Referral-/Bot-Erkennung und Löschung verhindern Missbrauch; finanzielle Rewards bleiben bis separater Legal-/Fraud-Freigabe deaktiviert.

### Programmatic-SEO-Gate

Eine Seite wird nur indexiert, wenn sie (a) ausreichend aktuelle reale Stellen, (b) einzigartige regionale/berufliche Orientierung, (c) stabile Canonical-Logik und (d) einen hilfreichen Empty-State besitzt. Dünne Kombinationen werden konsolidiert oder `noindex`; Seitenanzahl ist kein Erfolgsindikator.

## 10. Monetarisierung und Paketlogik

### Grundprinzipien

- Kandidaten-Kernfunktionen bleiben kostenlos.
- Der Preis orientiert sich an gleichzeitig aktiven Stellen, Teamworkflow, Resultattransparenz und kontrolliertem Talentzugang.
- Limits werden serverseitig als Entitlements ausgewertet und im UI vor der Aktion erklärt.
- Inkludierte Kontakte/Boosts laufen über ein Ledger; sie können nicht negativ werden oder doppelt gewährt werden.
- Jahrespreise sind Hypothesen; empfohlen wird **10 Monatsraten für 12 Monate** nach validierter Monatsnutzung, nicht beim ersten Besuch.
- P0 zeigt und verkauft ausschliesslich Monatskonditionen. Jahres-PlanVersionen dürfen als **inaktive** Forschungsfixtures existieren, werden aber erst nach dokumentierter Commercial-Freigabe öffentlich oder kaufbar.
- Die Basis-Firmenverifizierung ist ein Vertrauens- und Publikationsprozess für **jeden** Plan, einschliesslich Free. Kein Paket kauft den Status; bezahlte Pakete dürfen später nur klar getrennte Concierge-/SLA-Leistungen enthalten.

### Fünf Pläne (zu validierende Verpackung)

| Plan | Zielkunde | Monat / Jahr* | Kernleistung | Bewusste Grenze / sinnvoller Upgrade-Auslöser |
|---|---|---:|---|---|
| Free Basic | erstes Inserat / Test | CHF 0 | 1 aktive Stelle, 1 Seat, Basisprofil, Pipeline, Basisresultate | zweite aktive Stelle, Teammitglied oder tieferer Funnel |
| Starter | kleines KMU mit gelegentlichen Einstellungen | CHF 149 / 1'490 | 3 aktive Stellen, 2 Seats, Basisanalytics | wiederkehrend ≥ 3 Stellen, erweiterte Analytics |
| Pro | wachsendes KMU / internes Recruiting | CHF 399 / 3'990 | 10 Stellen, 5 Seats, erweitertes Profil, Funnel-Analytics, Talent-Radar-Grundzugang, 3 Boost-Credits, 10 Kontakte/Monat | Kontakt-/Seat-/Stellenbedarf, Importbedarf |
| Business | laufender Personalbedarf | CHF 899 / 8'990 | 30 Stellen, 15 Seats, Talent Radar Pro, 10 Boosts, 50 Kontakte/Monat; betreuter Import erst nach P1-Freigabe | mehrere Mandanten/ATS/Vertragsbilling |
| Enterprise | komplexe Organisation | individuell | vertraglich exakt gespeicherte Kontingente; SSO/ATS/API und SLA erst nach MVP/eigener Freigabe | kein Self-Service; Vertrag + Security Review |

\* Preis- und Rabattannahmen, keine bestätigte Zahlungsbereitschaft. Die Jahreswerte sind interne P1-Forschung und im P0 weder öffentlich noch kaufbar. Alle Rechnungsbeträge in Rappen; MWST-Logik konfigurierbar. Der aktuelle Schweizer Normalsatz beträgt 8,1 % laut [ESTV](https://www.estv.admin.ch/de/mwst-steuersaetze-schweiz), doch Steuerpflicht und konkrete Behandlung benötigen fachliche Prüfung.

### Einmalige Produkte und Priorität

| Produkt | Priorität | Begründung / Regel |
|---|---|---|
| Job Boost 7 / 30 Tage | P0 | direkter, messbarer Reichweitenwert; immer „Geboostet“, kein Score-Effekt |
| Talent-Kontakte 10 / 50 | P0 | Add-on nur für bereits Talent-Radar-berechtigte Firmen; erweitert einen genutzten Workflow, gewährt selbst keinen Radar-Zugang; atomarer Verbrauch und Ablaufregel |
| Zusatzstelle 30 Tage | P1 | Downsell für saisonalen Bedarf; darf Abo nicht kannibalisieren |
| Featured Job / Employer | P2 | erst nach Reichweiten-/Inventarbeleg; Job Boost deckt P0-Reichweite bereits ab |
| Import-Setup | P1 als betreute Leistung | operativer Aufwand wird bezahlt; kein falscher vollautomatischer Eindruck |
| Newsletter Placement / Social Push | P2 | erst mit nachweisbarer Reichweite verkaufen; Einwilligungen/Kanalregeln nötig |
| Success Fee | später, deaktiviert | rechtliche und geschäftliche Prüfung erforderlich; keine Admin-Aktivierung im MVP |

### Upgrade- und Churn-Mechanismen

- Upgrade nur am erkannten Bedarf: Stellenlimit, Seat, tiefere Funnelanalyse, genutzter Talent-Radar-Workflow oder Import.
- Vor Kauf zeigt das System neue Entitlements, Laufzeit/Periodenende, MWST und ADR-028 Upgrade-/Downgrade-Auswirkung; P0 verspricht keine automatische Verlängerung.
- 30/14/7 Tage vor Laufzeitende: Nutzungs- und Resultatbericht, nicht nur Mahnung.
- Kündigung bleibt einfach; freiwilliger Grund, Export und Enddatum werden bestätigt.
- ADR-028 ist die Implementierungsbaseline: Downgrade lässt historische Daten lesbar, suspendiert nicht retained Seats und widerruft Pending Invitations am Periodenrand; überzählige Stellen bleiben nur bis zum zwingend begrenzten validThrough sichtbar, neue Publikation/Reaktivierung ist blockiert. Finance/Product validates the hypothesis before real payment but implementation does not reinterpret it.
- Retention beruht auf Workflow-/Datenwert, nicht auf künstlicher Datengefangenschaft.

## 11. Wirtschaftlichkeitsmodell — Szenarien, keine Prognose

### Formeln

- `MRR = zahlende aktive Arbeitgeber × wiederkehrender ARPA`
- `Brutto-LTV ≈ ARPA × Bruttomarge ÷ monatlicher Logo-Churn`
- `CAC Payback (Monate) ≈ CAC ÷ (ARPA × Bruttomarge)`
- `operativer Deckungsbeitrag = Abo-Umsatz + Einmalumsatz − direkte Support-/Infrastruktur-/Zahlungskosten`

### Validierungsszenarien

| Annahme | Lean (Monat 12) | Basis (Monat 18) | Scale-Test (Monat 24) |
|---|---:|---:|---:|
| aktive Arbeitgeber | 250 | 600 | 1'200 |
| zahlender Anteil | 18 % | 25 % | 30 % |
| zahlende Arbeitgeber | 45 | 150 | 360 |
| wiederkehrender ARPA | CHF 280 | CHF 330 | CHF 380 |
| MRR | CHF 12'600 | CHF 49'500 | CHF 136'800 |
| Einmalumsatz/Monat | CHF 4'000 | CHF 12'000 | CHF 30'000 |
| monatlicher Logo-Churn | 4,5 % | 3,0 % | 2,5 % |
| angenommene Bruttomarge | 75 % | 78 % | 82 % |
| CAC je zahlendem Arbeitgeber | CHF 1'500 | CHF 1'100 | CHF 900 |
| Brutto-LTV (Formelwert) | CHF 4'667 | CHF 8'580 | CHF 12'464 |
| LTV/CAC | 3,1 | 7,8 | 13,8 |
| Bewerbungen je publizierter Stelle | 3 | 6 | 8 |
| direkte Kosten je aktivem Arbeitgeber/Monat | CHF 35 | CHF 22 | CHF 16 |
| Support je zahlendem Arbeitgeber/Monat | 1,2 h | 0,7 h | 0,4 h |
| Infrastruktur/Tools/Monat | CHF 3'000 | CHF 7'000 | CHF 16'000 |

Das Basis-Szenario läge bei angenommenen fixen Personal-, Sales-, Rechts- und Betriebskosten von CHF 42'000, direkten Arbeitgeberkosten von CHF 13'200 und Infrastruktur/Tools von CHF 7'000 gegenüber CHF 61'500 Monatsumsatz bei rund **CHF −700** operativem Ergebnis, also nahe, aber noch unter Break-even. Das ist eine **Rechenannahme**, kein Finanzversprechen. Vor Skalierung gelten als Guardrails: LTV/CAC > 3, CAC-Payback < 12 Monate, monatlicher Logo-Churn < 4 %, positive Deckung je Plan und Supportaufwand < 1 Stunde je zahlendem Arbeitgeber/Monat.

## 12. KPI-System und Messplan

### North Star

**Qualifizierte, fristgerecht beantwortete Karrieregespräche pro aktivem Cluster und Monat.** `METRIC_DEFINITIONS_V1` zählt genau einmal je `APPLICATION:<id>` (erste Arbeitgeberantwort bis zum bei Einreichung gesnapshotteten Antwortziel) oder `RADAR:<contactRequestId>` (erste Arbeitgebernachricht binnen 48 h nach Accept). Cluster stammt aus dem eingereichten Job-Revision- beziehungsweise ContactRequest-Snapshot; Monat ist die erste qualifizierende Antwort in Europe/Zurich. Nur zu diesem Zeitpunkt aktivierte LIVE-Cluster und aktive Nicht-Demo-Akteure zählen; Retries, weitere Nachrichten und Statuswechsel deduplizieren. Diese Kennzahl verbindet Kandidatennutzen, Arbeitgeberwert und Marketplace-Liquidität besser als reine Seitenaufrufe.

### KPI-Baum

- **Liquidität:** aktuelle Jobs/Cluster, aktivierte Kandidaten/Cluster, Suchabdeckung, Zeit zur ersten qualifizierten Bewerbung.
- **Kandidat:** Besuch→Suche, Detail→Merken/Bewerben, Registrierung→Aktivierung, Jobabo-Retention, Bewerbungsantwortquote, Radar-Kontaktannahme.
- **Arbeitgeber:** Registrierung→verifizierte Firma, Draft→Publikation, Zeit bis Publikation, qualifizierte Bewerbungen/Stelle, Antwort-SLA, Free→Paid.
- **Umsatz:** MRR, ARR-Run-Rate, ARPA, Expansion, Logo-/Revenue-Churn, Produktumsatz, Refund-/Fehlerquote später.
- **Vertrauen:** Lohntransparenzrate, Score-Abdeckung, gesponserte Kennzeichnung, Beschwerden, Identitätsfreigaben, Privacy-Anfragen, Cross-Tenant-Vorfälle (Ziel 0).
- **Betrieb:** Queue-Alter, Moderations-SLA, Importfehler/Dubletten, Supportzeit, Kosten je aktivem Arbeitgeber.

### Event-Minimum

Geschlossene Schema-v1-Events: `SEARCH_SUBMITTED`, `SEARCH_RESULTS_VIEWED`, `JOB_DETAIL_VIEWED`, `JOB_SAVED`, `APPLY_INTENT_STARTED`, `APPLICATION_SUBMITTED`, `APPLICATION_STATUS_CHANGED`, `JOB_ALERT_ACTIVATED`, `CANDIDATE_PROFILE_COMPLETED`, `RADAR_OPTED_IN`, `CONTACT_REQUEST_SENT`, `CONTACT_REQUEST_ACCEPTED`, `IDENTITY_REVEAL_GRANTED`, `COMPANY_VERIFIED`, `JOB_DRAFT_CREATED`, `JOB_SUBMITTED`, `JOB_PUBLISHED`, `EMPLOYER_RESPONSE_RECORDED`, `LIMIT_REACHED`, `CHECKOUT_STARTED`, `CHECKOUT_COMPLETED`, `SUBSCRIPTION_CHANGED`, `BOOST_ACTIVATED`, `MODERATION_ACTIONED` sowie Registrierungs-/Lead-Events aus Phase 03.

Events enthalten pseudonyme Actor-/Tenant-IDs, Zweck, Zeit und minimal notwendige Properties; keine Nachrichtentexte, CV-Inhalte, Tokens oder unnötige PII. Phase 03 friert die P0-Hypothese vor Implementierung versioniert ein: raw Product Analytics 90 Tage, minimierte essential Analytics-Projektionen 400 Tage, akteursfreie Tagesaggregate 25 Monate; Production benötigt Privacy/Legal-Freigabe oder eine dokumentierte kürzere Policy.

## 13. Datenschutz-, Rechts- und Fairnessgrenzen der Strategie

- Talent Radar ist standardmässig aus und folgt Privacy by Design/Default. Der EDÖB beschreibt diese Grundsätze als Anforderungen des revidierten DSG; das Produkt bleibt dennoch nur „datenschutzfreundlich vorbereitet“. Quelle: [EDÖB, neues Datenschutzgesetz](https://www.edoeb.admin.ch/de/das-neue-datenschutzgesetz-aus-sicht-des-edob).
- Die Stellenmeldepflicht-Liste ändert jährlich. 2026 gilt laut arbeit.swiss der Schwellenwert von 5 % und die offizielle Prüfung/RAV-Beurteilung bleibt massgeblich. Der MVP speichert deshalb eine versionierte Mock-Liste, Jahresgültigkeit, Ergebnisgrund und den Link zum offiziellen Check. Quelle: [arbeit.swiss, Stellenmeldepflicht 2026](https://www.arbeit.swiss/de/arbeitgebende/stellenmeldepflicht-2026).
- Match-Score ist im MVP ein erklärbares Kandidatenwerkzeug. Arbeitgeberseitige Rangfolge oder automatische Entscheidungen sind P1 und benötigen Fairness-, Rechts- und Bias-Prüfung.
- Besonders schützenswerte oder potenziell diskriminierende Merkmale sind keine Score-Eingaben.
- Rechtstexte, Aufbewahrungsfristen, Auftragsbearbeiter, internationale Bekanntgaben, Verifizierungsmethoden, Refunds und reale Zahlungsprozesse bleiben vor Produktionsbetrieb offene Fachprüfungen.

## 14. Priorisierte Produktentscheidungen

### P0 — funktionsfähiges kontrolliertes MVP

- öffentliche Suche/Detail/Firma/Salary Radar mit echten Seed-/Design-Partner-Daten im richtigen Umfeld;
- Auth, Candidate JobPass, Merken/Bewerben/Status/Jobabo;
- Company Claim/Verification, Team-Basics, Job-Draft/Moderation/Publikation, Pipeline;
- fünf versionierte Planhypothesen im Katalog; Free als automatische no-Subscription-Basis, nur monatliche Starter/Pro als P0-Self-Service-Checkout, Business/Enterprise bis P1 nur als ehrlicher Sales-/Lead-Pfad; Mock-Kauf, Rechnung, Usage, Boost und Contact-Ledger;
- anonymer Talent Radar mit Contact/Accept/Reject/Reveal;
- Adminqueues, Support-Intake, Import-Vorschau und regelbasierte P0-Business-Cockpit-Aktionen;
- Security/Privacy/Audit/Tests/Observability als vertikale Anforderungen.

### P1 — überzeugender Marktstart

- Business/Enterprise-Verkaufsworkflow, Jahrespläne, zusätzliche Teamrollen;
- Agenturmandate, Multi-Client-Kontexte und erweiterte Delegation; **P0** umfasst bereits robuste interne Company-Einladung/Annahme/Entfernung/Rollenwechsel sowie job-spezifische Assignment-Erteilung/Widerruf mit sofortiger Wirkung;
- Growth-Landingpages nur nach Liquiditätsgate, missbrauchsgeschützte Referral-Attribution, Content-Workflow;
- erweiterte Funnelanalytics, Retention-/Churn-Signale, betreutes Import-Setup;
- echte Hintergrundjobs und Benachrichtigungs-Outbox.

### P2 / später

- reale Provider, ATS/API/SSO, vollständige Mehrsprachigkeit, ausgefeilte Volltextsuche;
- employerseitige Match-Rangfolge nach Prüfung, mobile Apps, Refund-Automation;
- Success Fee ausschließlich nach Rechts- und Geschäftsmodellprüfung.

### Verworfen für das MVP

- Scraping, fingierte Marktplatzaktivität, globale Identitätsfreigabe, bezahlte Score-Erhöhung, automatische Ablehnung, ungeprüfte Erfolgshonorare und tausende dünne SEO-Seiten.
