# Phase 32 — G4-Audit für LC1

> **Kein Release- oder Production-Go.** Dieses Runbook beschreibt den
> technischen Audit einer lokalen, kontrollierten Demo. Solange Walkthrough,
> Rollback-/Roll-forward-Drill oder unabhängige Approvals fehlen, bleibt das
> Urteil `NO_GO`. LC2–LC6 sind nicht freigegeben.

Normativ gelten der
[Phase-32-Vertrag](../32-production-release-audit.md), das
[LC1-Findingsledger](../release/phase32-lc1-findings-ledger.json) und die
[Evidence-Regeln](../evidence/README.md).

## 1. LC1-Scope einfrieren

Vor dem Lauf werden genau ein sauberer Candidate-Commit und folgender Scope
festgehalten:

- nur lokale, isolierte Ausführung;
- ausschließlich synthetische Seeds und sichtbar gekennzeichnete Mocks;
- keine realen personenbezogenen Daten, Live-Provider oder Zahlungen;
- keine öffentliche Indexierung, Akquisition oder Produktionsbehauptung;
- alle für LC1 ausgeschlossenen Funktionen bleiben serverseitig deaktiviert.

Commit, Tree, Lockfile, Migrationstand und gebautes Artefakt dürfen nach dem
Freeze nicht mehr wechseln. Jede Repository-, Konfigurations- oder
Artefaktänderung invalidiert den Lauf und verlangt einen neuen Candidate.

## 2. Audit ausführen

Aus einem sauberen Clone des eingefrorenen Candidates:

```powershell
npm run release:audit -- --requested-class=LC1
```

Der Lauf darf kein Production-Deployment und keine Live-Provideraktivierung
ausführen. Er erzeugt sein candidate-gebundenes Manifest und die Reports
außerhalb des versionierten Quellbaums unter dem durch `.gitignore`
ausgeschlossenen `test-results/phase32/`. Der Standardpfad des Manifests ist
`test-results/phase32/g4-manifest.json`.

Alle gestarteten Prüfschritte einschließlich SBOM haben neben ihrer
Ausführungsfrist feste Terminierungsfenster. Unter Windows muss
`taskkill /PID … /T /F` selbst mit Exit/Fehler/Deadline ausgewertet werden;
bei Nonzero, Fehler oder ausbleibendem Child-Close folgt ein direkter
`SIGKILL`-Fallback. Unter POSIX wird die Prozessgruppe `SIGTERM`→`SIGKILL`
eskaliert. Kein fehlendes `close` darf den Audit unbegrenzt blockieren;
unbestätigte Terminierung bleibt Exit `124` und damit Gate-Fehler.

Das Manifest muss Commit-, Tree-, Lockfile-, Migration-, Artefakt-, Runtime-,
Laufzeitkonfigurations- und Report-Evidence-Digests enthalten. Der Build wird
als selbstständig startbares Next-Standalone-Paket unter
`candidate-artifact/` gespeichert. HTTP- und Browser-Gates starten dieses
Paket über `server.js` aus einem temporären Verzeichnis **außerhalb** des
Clean Clones und des Repository-Baums. Damit kann Node keine fehlende
Runtime-Abhängigkeit aus dem Quellbaum nachladen. Ein Build aus dem
Quellbaum oder ein späterer Rebuild zählt nicht als derselbe Candidate.

Der Audit persistiert die nicht geheime LC1-Konfiguration in
`lc1-runtime-configuration.json`. Ihr Digest ist an Candidate, Runtime,
Deployment und jeden Report gebunden. Primärlogs sowie relevante
Browser-/Recovery-Rohartefakte bleiben unter `raw-evidence/` erhalten und
werden über strikte Deskriptoren unter `report-evidence/` gebunden. Jeder
Deskriptor enthält Reportklasse, Commit, Artefaktdigest, Logdigest sowie
Pfad, Digest, Dateianzahl und Bytegröße seiner Anhänge.

Der Quellbaum-Secret-Scan reicht nicht als Release-Nachweis. Direkt nach der
kontrollierten Standalone-Assemblierung prüft ein zweiter fail-closed Scan das
exakte deploybare Artefakt auf private Schlüssel, Provider-Tokens, verbotene
Betriebsdateien und exakte konfigurierte Geheimnisse. Sein unverändertes
Protokoll wird unter `raw-evidence/artifact-secret-scan-log/` persistiert und
an den `SECRET_SCAN`-Deskriptor gebunden. Exakte konfigurierte Geheimnisse
werden in jeder regulären Datei byteweise geprüft; eine Binärklassifizierung
darf den Scan nicht umgehen.

Das Browser-Gate trennt zwei Profile: Die vollständige Regression darf ihre
expliziten Test-/Sandbox-Gates verwenden; ihr Log und ihre Rohbelege bleiben
als gebundene Anhänge erhalten. Anschließend läuft ein eigener
Chromium-/Firefox-/WebKit-Smoke mit den exakt eingefrorenen
LC1-Disabled-Gates. Nur dieser zweite Lauf ist das primäre
LC1-Konfigurations-Evidence; beide Profile müssen ohne Fail/Skip/Retry grün
sein.

Die Evidence-Aliase des Findingsledgers werden erst durch passende
Report-Evidence desselben Candidates aufgelöst. Ein historischer Phasenrecord,
ein bloßer Alias oder ein Reportname ohne erneut gehashte Rohartefakte ist
kein G4-Nachweis.

## 3. Manuelle Evidence ergänzen

Walkthrough, lokaler Rollback-/Roll-forward-Drill und Approvals werden nur mit
dem unveränderten Candidate und gespeicherten Artefakt in das ignorierte
Manifest aufgenommen:

- Rollen-, Mobile-, Keyboard- und vereinbarter Accessibility-Walkthrough;
- lokaler Rollback und erneuter Start des gespeicherten Candidate-Artefakts
  gemäß [Rollback-Runbook](./rollback.md);
- vier unabhängige, scopegebundene Ed25519-Attestierungen für `RELEASE`,
  `SECURITY`, `PRODUCT` und `OPERATIONS`; der Audit-Operator darf sich nicht
  selbst freigeben.

Nicht ausgeführte Schritte bleiben `null`, `NOT_RUN`, `DENIED` oder
anderweitig blockierend gemäß Schema. Fehlende Evidence darf weder manuell
noch durch einen Platzhalter auf `PASS` oder `APPROVED` gesetzt werden.

Die externe Evidence wird nicht von Hand in das erzeugte Manifest kopiert.
Ein Bundle mit Schema `phase32-external-g4-bundle-v1` bindet Walkthrough,
Rollback-Drill und Approval-Attestierungen an `LC1`, Candidate-Commit,
Artefaktdigest und lokale Deployment-ID. Vor der Freigabe wird ein
kanonischer Pre-Approval-Evidence-Root aus Candidate, Konfiguration, SBOM,
Runtime, Deployment, allen Reports/Raw-Evidence-Deskriptoren,
Findings-Ledger/-Bindings, Walkthrough und Rollback berechnet. Jede der vier
Attestierungen signiert genau diesen Root.

Die vier Attestierungen werden gegen ein separat verwaltetes,
SHA-256-gebundenes Register vertrauenswürdiger öffentlicher
Ed25519-Schlüssel geprüft. Das Register muss seinerseits von dem im Candidate
unter
[Phase-32-Approval-Root-Trust-Anchor](../release/phase32-approval-root-trust-anchor.json)
provisionierten, unabhängig kontrollierten Ed25519-Root-Schlüssel signiert
sein. Der aktuelle Record ist bewusst `UNPROVISIONED`; bis zu einer separat
autorisierten Key-Ceremony ist `APPROVED` technisch unmöglich. Private
Schlüssel gehören weder in Bundle, Register, Repository noch Audit-Artefakte.
Bundle- und Registerpfad samt ihren erwarteten SHA-256-Werten werden vor der
Finalisierung explizit gesetzt:

```powershell
$env:PHASE32_EXTERNAL_G4_BUNDLE_PATH = "D:\controlled-evidence\phase32-lc1.json"
$env:PHASE32_EXTERNAL_G4_BUNDLE_SHA256 = "<64 lowercase hex characters>"
$env:PHASE32_APPROVAL_KEY_REGISTRY_PATH = "D:\controlled-evidence\phase32-approval-keys.json"
$env:PHASE32_APPROVAL_KEY_REGISTRY_SHA256 = "<64 lowercase hex characters>"
$env:PHASE32_APPROVAL_ROOT_PUBLIC_KEY_SHA256 = "<independently protected Ed25519 SPKI SHA-256>"
npm run release:finalize
```

`release:finalize` baut nicht erneut. Es verifiziert das gespeicherte und
bereits von HTTP-/Browser-Gates gestartete `candidate-artifact/`, alle
Report-Evidence-Deskriptoren, persistierten Rohartefakte, die
Laufzeitkonfiguration sowie SBOM-, Runtime-, Deployment-, Findingsquellen-
und Repositorydigests und ergänzt nur die externe Evidence desselben
Candidates. Der Orchestrator akzeptiert Bundle und Vertrauensregister nur bei
exakter Digest- und Candidatebindung. Root-Anchor, root-signiertes Register
und Approval-Signaturen müssen kryptografisch gültig und am aktuellen
Verifikationszeitpunkt gültig sowie nicht widerrufen sein. Der kanonische
Ed25519-SPKI-Fingerprint des Root-Schlüssels muss zusätzlich mit dem separat
geschützten CI-/Governance-Pin
`PHASE32_APPROVAL_ROOT_PUBLIC_KEY_SHA256` übereinstimmen; Candidate-Angaben
allein sind keine Trust-Quelle. Scope, Approver, Schlüssel und
Schlüsselmaterial müssen je Freigabe verschieden sein. Die Fragmente
durchlaufen anschließend denselben strikten G4-Manifestvalidator.
Ein fehlender/unprovisionierter Root-Anchor oder ein fehlendes, veraltetes
oder formal ungültiges Bundle/Register bricht die Finalisierung ab; es wird
nicht still als `NO_GO`-Ersatz interpretiert.

## 4. Manifest verifizieren

```powershell
npm run release:verify -- --manifest=test-results/phase32/g4-manifest.json
```

Die Verifikation prüft Schema, Repository, Standalone-Artefakt,
Laufzeitkonfiguration, Rohartefakt-/Report-Deskriptoren, Candidatebindung,
Findings, Pflichtreports, Walkthrough und Drill. Ein Manifest mit
`APPROVED` wird zusätzlich nur mit allen vier gesetzten Bundle-/Register-
Variablen, erneut berechnetem Pre-Approval-Evidence-Root und erneuter
Root→Registry→Approval-Ed25519-Prüfung akzeptiert. Ein technisch gültiges
`NO_GO`-Manifest kann strukturell korrekt sein; ein erfolgreicher
Verifier-Prozess ist deshalb allein keine Launchfreigabe. Maßgeblich ist die
abgeleitete `launchDecision`.

Mindestens einer der folgenden Fälle erzwingt `NO_GO`:

- fehlender oder candidate-fremder Walkthrough;
- fehlender, fehlgeschlagener oder candidate-fremder
  Rollback-/Roll-forward-Drill;
- fehlende, abgelaufene, widerrufene, operator-eigene, kryptografisch
  ungültige oder candidate-fremde Approval-Attestierungen;
- fehlender/unprovisionierter Root-Trust-Anchor oder ein nicht root-signiertes,
  nicht exakt gehashtes beziehungsweise nicht erneut verifiziertes
  Vertrauensregister;
- ein abweichender Pre-Approval-Evidence-Root;
- Dirty Worktree, anderer Commit, Rebuild, Digestabweichung, Skip, Retry oder
  fehlender Pflichtreport;
- nicht aufgelöste Evidence oder ein LC1-relevantes offenes P0/P1-Finding.

## 5. Zulässiges Urteil

Ohne vollständig belegten Walkthrough, Rollback und unabhängige Approvals ist
der aktuelle Abschluss:

| Gegenstand                       | Ehrlicher Status                           |
| -------------------------------- | ------------------------------------------ |
| Technische LC1-Automation        | erst nach dem Candidate-Lauf gemäß Reports |
| Candidate-gebundener Walkthrough | `NOT_RUN`, bis tatsächlich protokolliert   |
| Rollback-/Roll-forward-Drill     | `NOT_RUN`, bis tatsächlich protokolliert   |
| Unabhängige Approvals            | `MISSING`, bis tatsächlich erteilt         |
| Launchentscheidung               | `NO_GO`                                    |
| LC2–LC6                          | `NOT APPROVED`                             |
| Production-Deployment            | nicht ausgeführt und nicht autorisiert     |

Selbst ein späteres `APPROVED` für LC1 erlaubt ausschließlich den im Manifest
eingefrorenen lokalen Demo-Scope. Es erlaubt kein Staging- oder
Production-Deployment und sagt nichts über LC2–LC6 aus. Für höhere Klassen
gelten deren eigene Legal-, Privacy-, Provider-, Operations-, Markt- und
Releasegates aus dem [Phase-32-Vertrag](../32-production-release-audit.md).
