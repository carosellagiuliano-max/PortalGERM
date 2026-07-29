# Phase 29 — vorregistriertes moderiertes UX-/Trust-Protokoll v1

> Status: **VORBEREITET, NICHT DURCHGEFÜHRT.** Dieses Dokument ist ein
> unveränderliches Testprotokoll, kein Ergebnisbericht. Es enthält keine
> erfundenen Teilnehmenden, Aussagen, Quoten, Screenreader-Abnahmen oder
> Produktfreigaben.

## Forschungsziel und Stop-Regeln

Geprüft wird, ob reale Schweizer Kandidat:innen, Employer/Recruiter und
Admin/Ops die kritischen Aufgaben ohne fachliche Hilfe abschliessen und die
Wirkung von CV-Empfänger, Firmenverifizierung, Talent-Radar-Freigabe sowie
Preis, Limiten und Kündigung korrekt erklären können.

Vor der ersten Session gelten unveränderlich:

- Runde 1 und Runde 2 rekrutieren jeweils mindestens fünf Candidates, fünf
  Employer/Recruiter und drei Admin/Ops aus den definierten Zielsegmenten;
- allgemeiner Task-Erfolg mindestens 80 Prozent **je Aufgabe und Segment**;
  bei drei Admin-Teilnehmenden sind daher drei unassistierte Erfolge nötig;
- null kritische Sackgassen und null unzugängliche Hauptaktionen;
- kritisches Teach-back zu CV-Empfänger, Verification-Scope, Radar/Reveal,
  Preis/Limits/Kündigung muss bei 100 Prozent der gültigen Sessions korrekt
  sein;
- Moderatorhilfe, technische Rettung oder nachträgliche Erklärung zählt nie
  als unassistierter Erfolg;
- ein P0-Privacy-/Security-Leak, eine irreführende irreversible Aktion oder ein
  kritischer Teach-back-Irrtum stoppt den betroffenen Launchscope sofort.

Schwellen, Aufgaben und Kodierung werden nach Beginn der ersten Session nicht
abgeschwächt. Änderungen erzeugen eine neue Protokollversion und eine neue
Baseline.

## Segmente und Rekrutierung

| Segment | Mindestzahl je Runde | Einschluss | Ausschluss |
| --- | ---: | --- | --- |
| Candidate | 5 | sucht aktuell oder suchte in den letzten 24 Monaten eine Stelle in der Schweiz; Mischung aus Desktop/Mobile | Projektteam, Recruiting-/UX-Fachtestende, ausschliesslich internes Demo-Konto |
| Employer/Recruiter | 5 | rekrutiert regelmässig für ein Schweizer KMU; mindestens zwei Personen mit 3–30 Einstellungen/Jahr | reine Enterprise-Procurement-Rolle ohne operative Recruitingaufgabe |
| Admin/Ops | 3 | moderiert Stellen/Firmen/Reports oder betreibt Support-/Operations-Queues | Entwickler:innen der geprüften Flows, Personen ohne vergleichbare Operationsaufgabe |

Runde 2 verwendet eine neue, vergleichbare Kohorte. Personen aus Runde 1
dürfen nur zusätzlich an einem explizit als Wiederholung gekennzeichneten
Langzeit-Retest teilnehmen und ersetzen keine neue Person.

## Consent, Datenschutz und Aufbewahrung

Vor jedem Test werden Zweck, freiwillige Teilnahme, Abbruch ohne Nachteil,
verarbeitete Daten, Speicherort, Zugriff, Löschfrist und Kontakt für Widerruf
verständlich erklärt. Die Person stimmt Teilnahme und eine optionale
Aufzeichnung getrennt zu.

- Ausschliesslich isolierte TEST-Konten und synthetische Stellen, Firmen,
  Lebensläufe, Nachrichten und Zahlungsdaten verwenden.
- Keine echte Bewerbung, kein echter CV, keine Produktionsidentität und keine
  Zahlungsinformation eingeben.
- Teilnehmende erhalten zufällige IDs (`R1-C01`, `R1-E01`, `R1-A01` usw.).
  Rekrutierungskontakte bleiben ausserhalb des Produktrepositories.
- Rohnotizen/Aufnahmen liegen verschlüsselt im freigegebenen Researchspeicher,
  Zugriff nur Research- und Privacy-Owner, Löschung spätestens 30 Tage nach
  Freigabe oder sofort nach wirksamem Widerruf.
- Im Repository landen nur aggregierte Resultate, Fehlerklassen, freigegebene
  Paraphrasen, Build-/Protokollversion und Löschbestätigung. Keine PII, Tokens,
  CV-Inhalte, Revealwerte, privaten Nachrichten oder Screenshots realer Daten.

Fehlender Consent oder ein falsches Segment macht die Session ungültig; ihre
Aufgaben dürfen nicht in Quoten eingehen.

## Unveränderliches Testsetup

- Production-Build aus einem dokumentierten Commit und Digest;
- frische isolierte PostgreSQL-16-Datenbank mit synthetischem Seed;
- Rollen-/Capability-/Tenantzustände wie im Releaseartefakt, keine
  Moderator-Backdoors;
- mindestens je Segment zwei Desktop-Sessions (1.440×900), zwei
  Mobil-Sessions (360×800, zusätzlich 320-Pixel-Reflow) und eine
  Keyboard-only-Session;
- Runde 2 verwendet denselben Aufgabentext, dieselben Startzustände und
  Messregeln wie Runde 1;
- Browser, Betriebssystem, Eingabegerät, Zoom, Assistive Technology und
  relevante Feature-Flags werden pro Session erfasst;
- reale NVDA-/VoiceOver-Abnahmen werden separat von geschulten Testenden
  protokolliert und nicht aus Axe- oder Browserautomation abgeleitet.

## Moderatorskript

1. „Wir testen das Produkt, nicht dich. Bitte denke laut und handle so, wie du
   es alleine tun würdest.“
2. Der Moderator liest nur den festgelegten Aufgabentext vor und nennt keine
   Navigation, Bedeutung oder Lösung.
3. Zulässige neutrale Rückfragen sind ausschliesslich: „Was erwartest du als
   Nächstes?“, „Was bedeutet dieser Status für dich?“ und „Bist du fertig?“
4. Jede inhaltliche Hilfe wird mit Zeitpunkt und Grund erfasst; die Aufgabe
   erhält `ASSISTED` und zählt nicht als Erfolg.
5. Nach sicherheits-, privacy- oder zahlungsrelevanten Aufgaben folgt das
   wörtlich festgelegte Teach-back, bevor der Moderator erklärt oder debrieft.
6. Bei Stress, möglicher Eingabe echter PII, Tenantwechsel oder unerwarteter
   Produktionsverbindung wird sofort abgebrochen und der Testscope gesperrt.

## Runde-1-Aufgaben

### Candidate

| ID | Aufgabe und Zeitbudget | Unassistierter Erfolg | Kritischer Fehler/Teach-back |
| --- | --- | --- | --- |
| C-1 | In höchstens 6 min eine passende Stelle suchen, Fair-Job-Information prüfen und Bewerbungsweg beginnen | Filter, Stelle und korrekter interner/externer Bewerbungsweg ohne Hilfe gefunden | externen Klick als eingereichte Bewerbung verstehen |
| C-2 | In höchstens 8 min SwissJobPass in mehreren Schritten ändern, Seite verlassen, zurückkehren und letzten sicheren Stand erklären | Stepper, Autosave/Resume und sichtbarer Konflikthinweis verstanden; neueste bestätigte Version bleibt | glaubt, unbestätigte/veraltete Eingabe habe neuere Daten überschrieben |
| C-3 | In höchstens 6 min CV bereitstellen und erklären, wer ihn wann lesen darf | Candidate erkennt konkreten Employer-Empfänger und den gebundenen Bewerbungs-/Grantpfad | CV sei öffentlich, für alle Firmen oder dauerhaft frei zugänglich |
| C-4 | In höchstens 6 min Radar aktivieren, anonyme Vorschau erklären und konkrete Identitätsfelder freigeben/widerrufen | verborgene Felder, konkrete Empfängerfirma, gewählte Werte und Widerrufsgrenze korrekt | Name/CV bereits anonym sichtbar; bereits kopierte Daten würden rückwirkend „ungesehen“ |
| C-5 | In höchstens 5 min Privacy-/Notification-Entscheidung finden und ändern | freiwillige vs. essentielle Verarbeitung und nächste Wirkung korrekt | notwendige Service-Evidence mit Marketing verwechseln |

### Employer/Recruiter

| ID | Aufgabe und Zeitbudget | Unassistierter Erfolg | Kritischer Fehler/Teach-back |
| --- | --- | --- | --- |
| E-1 | In höchstens 7 min Firma vervollständigen und Verifizierungsstatus erklären | Firmenprofil und Verifizierungsabzeichen als getrennte Zustände verstanden | Badge als behördliche, finanzielle oder umfassende Qualitätsgarantie deuten |
| E-2 | In höchstens 8 min Job erstellen/einreichen und erwarteten Admin-/Publishstatus erklären | Revision, Prüfung, Veröffentlichung und erlaubte nächste Aktion korrekt | Entwurf/Einreichung als bereits öffentlich verstehen |
| E-3 | In höchstens 7 min Candidate-Pipeline bearbeiten, ohne unzulässige Daten/Aktionen zu erwarten | nur zugewiesene/erlaubte Bewerbung und klare Statuswirkung | fremde Firma/Bewerbung oder mobile UI als Berechtigungs-Bypass erwarten |
| E-4 | In höchstens 6 min Radar-Kontakt anfragen und Candidate-Freigabe erklären | anonyme Vorschau, Candidate-Consent und empfangene Felder getrennt | Zugriff auf Identität/CV vor ausdrücklicher Candidate-Freigabe erwarten |
| E-5 | In höchstens 7 min Planpreis, MWST, Limiten und Kündigung prüfen | CHF-Total, Limiten, Periodenende, Free-Downgrade und Teamwirkung korrekt | sofortige Rückzahlung, unbegrenzte Nutzung oder folgenlose Kündigung annehmen |

### Admin/Ops

| ID | Aufgabe und Zeitbudget | Unassistierter Erfolg | Kritischer Fehler/Teach-back |
| --- | --- | --- | --- |
| A-1 | In höchstens 6 min einen Jobfall filtern, öffnen und erlaubte Entscheidung vorbereiten | Queue, Begründung, Statusfolge und Auditwirkung korrekt | statische Karte für ausgeführte Aktion halten oder Status ohne Prüfung ändern |
| A-2 | In höchstens 7 min Firmenverifizierung mit Nachweisen triagieren | private Evidence, öffentliche Badge-Wirkung und unabhängige Freigabe getrennt | private Evidence öffentlich machen oder Badge-Scope übertreiben |
| A-3 | In höchstens 7 min Report/Trust-Fall zuweisen, Severity prüfen und sichere nächste Aktion nennen | Assignee, Ziel, Status, Capability/Step-up und Audit nachvollzogen | fremde Tenantdaten oder nicht erlaubte Aktion sichtbar/ausführbar erwarten |
| A-4 | In höchstens 5 min Audit-/Supporteintrag finden und sensible Grenzen erklären | Filter, Correlation, redigierte Daten und zuständige Rolle korrekt | Secrets/volle PII im Audit oder Supportzugriff ohne Capability erwarten |

## Kritische Teach-back-Fragen

Die Fragen werden wortgleich gestellt:

1. „Welche konkrete Person oder Firma kann den CV jetzt sehen, und wodurch
   erhält sie Zugriff?“
2. „Was bestätigt das Firmenabzeichen – und was bestätigt es ausdrücklich
   nicht?“
3. „Welche Daten sieht eine Firma vor und nach deiner Radar-Freigabe? Was kann
   ein späterer Widerruf nicht rückgängig machen?“
4. „Wie hoch ist der Totalpreis, welche Limiten gelten, wann endet das bezahlte
   Recht und was passiert danach mit Team und Daten?“

Eine Antwort ist nur korrekt, wenn Empfänger/Scope, Zeitpunkt, Begrenzung und
nächste Wirkung ohne Moderatorergänzung genannt werden.

## Messung und Kodierung

Pro Aufgabe werden Start/Ende, Sekunden, `PASS`, `ASSISTED`, `FAIL`,
`ABANDONED`, Navigationsfehler, Fachfehler, technische Sackgasse, Anzahl
Fehlversuche und Teach-back-Klasse erfasst. `ASSISTED` zählt als Misserfolg.
Median und p90 werden nur mit gültigen Sessions berichtet; bei kleinen
Segmenten wird zusätzlich jede Einzelzeit sichtbar gemacht.

Zwei Personen kodieren P0/P1-Fehlannahmen unabhängig. Uneinigkeit wird vor
Freigabe geklärt und dokumentiert. Keine Quote darf Candidate, Employer und
Admin zu einem günstigeren Gesamtwert vermischen.

| Runde | Segment | n gültig | unassistierter Erfolg je Task | kritische Sackgassen | kritisches Teach-back | Status |
| --- | --- | ---: | --- | ---: | --- | --- |
| 1 | Candidate | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| 1 | Employer/Recruiter | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| 1 | Admin/Ops | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| 2 | Candidate | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| 2 | Employer/Recruiter | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |
| 2 | Admin/Ops | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NICHT ERHOBEN` | `NOT RUN` |

## Findings, Fixes und Runde 2

Jedes Finding erhält Severity, betroffene Rolle/Aufgabe/Zustand, reproduzierbare
Beobachtung, Domain Owner, Releasewirkung, Fixcommit, automatisierten
Regressionstest und Runde-2-Retest. Fachfehler gehen an die besitzende Phase;
Phase 29 kaschiert keine falsche Policy mit UI-Text.

Runde 2 beginnt erst, wenn alle P0-Findings geschlossen und P1-Findings
entweder geschlossen oder mit unabhängigem No-go-Owner aus dem Scope entfernt
sind. Sie wiederholt dieselben Aufgaben mit einer neuen Kohorte. Schlechtere
Resultate, ein offener P0 oder eine verfehlte Schwelle führen zu `NO-GO`.

Das Aggregat wird in
[`phase29-aggregated-results-template.md`](./phase29-aggregated-results-template.md)
eingetragen. Dieses Protokoll allein schliesst weder `29A`, `29B`, manuelle
NVDA-/VoiceOver-Abnahme noch ein Staging-, Legal-, Markt- oder LIVE-Gate.
