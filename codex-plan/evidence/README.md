# Evidence-Vertrag

Evidence belegt ausschliesslich den Zustand des Zielrepositories. Historische
Quellnotizen, nicht reproduzierbare Behauptungen und reine Implementierungsabsicht
gelten nicht als Nachweis.

## Ablage und Benennung

- Pro abgeschlossener Phase entsteht mindestens ein datierter Record unter
  `codex-plan/evidence/YYYY-MM-DD-phase-NN.md`.
- Der Record nennt den unveränderlichen Ziel-Commit, gegen den alle automatischen
  und manuellen Prüfungen ausgeführt wurden. Ein späterer Evidence-Commit darf
  diesen geprüften Code-Commit referenzieren.
- Secrets, vollständige Verbindungs-URLs, personenbezogene Daten und rohe
  Fehlerobjekte werden weder im Record noch in angehängten Logs gespeichert.

## Pflichtfelder eines Records

1. Datum, Zeitzone, Phase, Branch und vollständiger Ziel-Commit.
2. Betriebssystem sowie exakte Node-, npm-, Docker-/Compose- und
   PostgreSQL-Image-Versionen, soweit für die Phase relevant.
3. Kurzbeschreibung des geprüften Scopes und ausdrücklich ausgeschlossener
   Funktionen.
4. Tabelle jedes ausgeführten Befehls mit Arbeitsverzeichnis, Ergebnis,
   Exit-Code und einer knappen, redigierten Beobachtung.
5. Manuelle Prüfungen mit Viewport, Eingabemethode und konkretem Resultat.
6. Bekannte Limitationen, übersprungene Prüfungen und offene Risiken. Eine
   übersprungene Pflichtprüfung verhindert den Abschluss der betroffenen
   Checkbox.
7. Bestätigung, dass der Arbeitsbaum des Ziel-Commits reproduzierbar installiert
   wurde und keine fremden oder generierten lokalen Artefakte als Voraussetzung
   dienten.

## Checkbox-Regel

Zuerst wird der Detailplan anhand eines verlinkten, erfolgreichen Records
aktualisiert. Erst wenn sämtliche Definition-of-Done-Punkte der Detailphase
belegt sind, darf danach die zugehörige Phase in `00-PLAN.md` auf `[x]` wechseln.
Ein fehlgeschlagener oder nur lokal vermuteter Check bleibt `[ ]` und wird im
Record als Limitation benannt.
