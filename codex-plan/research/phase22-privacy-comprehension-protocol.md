# Phase 22 — vorregistriertes Privacy-/Legal-Verständlichkeitsprotokoll

> Status: **VORBEREITET, NICHT DURCHGEFÜHRT.** Dieses Dokument ist ein
> Testprotokoll und kein Ergebnisbericht. Es enthält keine erfundenen
> Teilnehmenden, Aussagen, Erfolgsquoten oder Freigaben.

## Ziel und harte Schwellen

Untersucht wird, ob reale Nutzerinnen und Nutzer die Wirkung von Export,
Korrektur, Löschung/Retention, Legal-Versionen und optionaler Analyse ohne
fachliche Hilfe korrekt verstehen. Vor Start gelten unveränderlich:

- mindestens fünf Candidate-Teilnehmende und fünf Employer-/Invitee-
  Teilnehmende; Admins, Projektmitarbeitende und unmittelbar beteiligte
  Entwickler zählen nicht;
- Task Success mindestens 80 Prozent **je Segment**, nicht nur aggregiert;
- null kritische Fehlannahmen, insbesondere „COMPLETED bedeutet alles
  gelöscht“, „Download bleibt dauerhaft verfügbar“, „optionale Analyse ist
  Pflicht“ oder „veröffentlichter Text ist automatisch AVG-/DSFA-Freigabe“;
- null kritische/ernste Axe-Befunde auf den geprüften Zuständen;
- ein kritischer Irrtum, ein Privacy-Leak, fehlende freiwillige Einwilligung
  oder ein unzugänglicher irreversibler Schritt stoppt die Cohort-Freigabe.

Die Schwellen werden nicht nach Einsicht in Ergebnisse verändert.

## Rekrutierung und Schutz der Teilnehmenden

| Segment | Mindestzahl | Einschluss | Ausschluss |
| --- | ---: | --- | --- |
| Candidate | 5 | sucht oder wechselte in den letzten 24 Monaten eine Stelle in der Schweiz | Projektteam, Datenschutz-/UX-Fachrolle, nur internes Demo-Konto |
| Employer/Invitee | 5 | rekrutiert für ein Schweizer KMU oder wurde zu einem Recruiting-Tool eingeladen | Projektteam, reine Enterprise-Procurement-Rolle ohne Produktaufgabe |

Vor der Session werden Zweck, freiwillige Teilnahme, Abbruch ohne Nachteil
und Datenverwendung erklärt. Es werden ausschließlich synthetische
Sandboxdaten verwendet. Keine echte Bewerbung, kein echter Lebenslauf und
keine Produktionsidentität werden eingegeben. Aufzeichnung ist standardmäßig
aus; falls fachlich nötig, braucht sie eine getrennte Zustimmung.

Teilnehmende erhalten zufällige IDs (`C01`–`C05`, `E01`–`E05`). Kontaktlisten
liegen getrennt beim Research-Owner. Rohnotizen werden nach 30 Tagen gelöscht;
der anonymisierte Ergebnisbericht enthält nur Aufgabenresultate, Zeiten,
Fehlannahmeklassen und freigegebene Paraphrasen.

## Setup

- Production-Build auf einem unveränderlichen Candidate-Commit;
- frische isolierte PostgreSQL-16-Datenbank und synthetischer Seed;
- Desktop 1.440×900 sowie 360×800; mindestens eine Session pro Segment mit
  Tastatur-only, sofern die Rekrutierung dies zulässt;
- `PRIVACY_*`, `LEGAL_PUBLICATION_*` und `OPTIONAL_ANALYTICS_*` entsprechend
  dem zu prüfenden Sandbox-Szenario, niemals als `LIVE` bezeichnet;
- je ein Fall in `PENDING`, `IDENTITY_CHECK`, `IN_PROGRESS`,
  `RETRY_REQUIRED`, `COMPLETED_WITH_RETENTION`, `EXPIRED` und
  Download-`CONSUMED`;
- ein aktiver Legal Hold und ein kontrollierter Provider-Teilfehler;
- keine Moderatorzugriffe auf andere Subjects oder Company-Tenants.

## Moderatorskript

1. „Bitte denke laut. Ich teste das Produkt, nicht dich.“
2. „Führe die Aufgabe so aus, wie du es alleine tun würdest.“
3. Der Moderator beantwortet keine Bedeutungsfrage, bevor die Aufgabe bewertet
   ist. Er darf nur „Was erwartest du jetzt?“ oder „Was bedeutet dieser Status
   für dich?“ fragen.
4. Nach jeder Aufgabe gibt die Person in eigenen Worten Wirkung, verbleibende
   Daten und nächste Handlung wieder.
5. Bei Unsicherheit, Stress oder möglicher Eingabe echter PII wird gestoppt.

## Aufgaben — Candidate

| ID | Aufgabe | Erfolg | Kritischer Fehler |
| --- | --- | --- | --- |
| C-1 | Datenschutzbereich finden und erklären, welche Analysedaten standardmäßig aus sind | beide optionalen Familien erkannt; Essential Evidence nicht mit Werbung verwechselt | Person glaubt, Nutzung erfordere Tracking |
| C-2 | Export anfordern, Identität bestätigen und Einmal-Download erklären | eigener Fall; 15-Minuten-/Single-use-Wirkung korrekt | dauerhafter Link oder fremder Zugriff erwartet |
| C-3 | `RETRY_REQUIRED` interpretieren und nächste sichere Handlung nennen | kein False Complete; Retry/Support verstanden | Person glaubt, Export/Löschung sei abgeschlossen |
| C-4 | Löschung mit Application-/Accounting-/Legal-Hold-Retention erklären | gelöscht/anonymisiert vs. minimal retained korrekt getrennt | „alles gelöscht“ oder Hold als versteckte Vollkopie verstanden |
| C-5 | Korrektur eines kanonischen Felds und eines fachlich zu prüfenden Felds unterscheiden | automatische Korrektur und Referral korrekt | unveränderliche Evidence soll überschrieben werden |
| C-6 | Analytics aktivieren und sofort widerrufen | Freiwilligkeit, Policy-Version und Wirkung auf neue Events korrekt | Widerruf wird als rückwirkende Auditlöschung verstanden |

## Aufgaben — Employer/Invitee

| ID | Aufgabe | Erfolg | Kritischer Fehler |
| --- | --- | --- | --- |
| E-1 | erklären, welche eigenen und Company-Daten ein Export enthalten darf | eigene Membership/Invite-Evidence erkannt; keine pauschalen Kollegendaten | fremde Company-/Bewerberdaten erwartet |
| E-2 | Invitee-/Lead-Daten in einem Auszug identifizieren | eigene Einladung/Lead-Übermittlung erkannt | fremde Invitees/Leads erwartet |
| E-3 | veröffentlichte Legal-Version, Hash und Gültigkeit finden | exakte Publication verstanden | Draft oder abgelaufene/revoked Version gilt als aktuell |
| E-4 | AVG-/AVV-/DSFA-Gate vom veröffentlichten Text unterscheiden | Flowfreigabe als separater externer Entscheid erkannt | Veröffentlichung wird als automatische Rechtsfreigabe verstanden |
| E-5 | optionales Conversion-Tracking ablehnen/widerrufen | default-off und sofortige Suppression neuer optionaler Events verstanden | Pflichttracking oder versteckter Werbepixel angenommen |
| E-6 | Teilfehler/Retention in einem Privacy-Fall erklären | offener Processor und begrenzte Retention korrekt | „grüner Status“ trotz offenem Processor erwartet |

## Messung und Kodierung

Für jede Aufgabe werden Start-/Endzeit, `PASS`, `PASS_WITH_PROMPT`, `FAIL`,
Abbruch, Navigationsfehler, Fachfehler und wörtlich paraphrasierte Erklärung
erfasst. `PASS_WITH_PROMPT` zählt nicht als Task Success. Zwei Personen
kodieren kritische Fehlannahmen unabhängig; Uneinigkeit wird vor Freigabe
aufgelöst und im Bericht sichtbar dokumentiert.

| Segment | n | PASS ohne Prompt | Quote | kritische Irrtümer | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Candidate | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| Employer/Invitee | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |

## Ergebnis- und Entscheidungsprozess

Der anonymisierte Bericht verlinkt Candidate-Commit, Build-Digest,
Flagzustand, Aufgabenmatrix und geschlossene Befunde. Jeder rote Befund erhält
Owner, Schweregrad, betroffenen Zustand, Fix, Regressionstest und
Re-Test-Teilnehmende. Erst Privacy, UX Research und QA dürfen gemeinsam
`PASS` setzen. Dieses Protokoll allein schließt weder `22-AC-09` noch ein
Legal-, Provider-, Cohort- oder Production-Gate.
