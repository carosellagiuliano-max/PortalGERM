# Backup-/Restore-Runbook

> **Status:** ausführbarer, verschlüsselter Local-/CI-Recovery-Drill für
> E2E-08. Die Wrapper verweigern Production, Staging, gemeinsame Datenbanken
> und unbekannte Namen. Sie sind kein produktiver Scheduler oder
> Storage-Lifecycle.
> Das geplante LC2–LC6-Ziel und seine noch offenen produktiven RPO/RTO-/
> Retention-Gates stehen im
> [Remediation-Runbookziel](./remediation-production-target.md).

## Sicherheitsvertrag

- `pg_dump --format=custom --no-owner --no-acl` streamt direkt in
  `age --recipient …`.
- Es wird kein unverschlüsselter Dump auf persistente Platte geschrieben.
- Das Ziel endet auf `.dump.age`, liegt absolut ausserhalb des Repositories
  und darf nicht existieren.
- Während des Schreibens wird nur eine eindeutige `.partial-*`-Datei
  verwendet; Fehler entfernen partielle und vom Lauf erzeugte Enddateien.
- Nach erfolgreicher atomarer Umbenennung entsteht daneben genau eine
  `.sha256`-Datei über den Ciphertext.
- Restore verifiziert zuerst den SHA-256, die getrennte leere Ziel-DB und die
  externe Identity-Datei.
- Die Age-Identity liegt absolut ausserhalb des Repositories. Unter Unix darf
  sie keine Group-/Other-Rechte besitzen.
- URLs, Credentials, Identity-Material und Backup-Bytes gehören weder in Git
  noch in BUILD_REPORT/Evidence.

## Erlaubte Drill-Ziele

| Alias | Variable | Erlaubter Datenbankname |
| --- | --- | --- |
| `release-test` | `DATABASE_URL` | `swisstalenthub_release_test_<12–32 hex>` |
| `restore-test` | `TEST_DATABASE_URL` | `swisstalenthub_restore_test_<12–32 hex>` |

Beide Ziele müssen Loopback, Schema `public`, verschieden und frei von
`prod`, `production`, `staging` oder `shared` sein. Systemdatenbanken,
`swisstalenthub` sowie andere Namen werden verweigert. Der Runtime-Vertrag
akzeptiert nur `APP_ENV=local|ci` und kein `NODE_ENV=production`.

## Voraussetzungen

- Node/npm gemäss Runtime-Pins und eine erreichbare PostgreSQL-16-Instanz;
- `age` und `age-keygen`;
- `pg_dump`/`pg_restore` im PATH oder der dokumentierte Docker-Compose-Modus;
- bereits angelegte Source- und **leere** Restore-Datenbank;
- gültiger `BACKUP_AGE_RECIPIENT`;
- existierende `BACKUP_AGE_IDENTITY_FILE` ausserhalb des Repositories;
- ein bereits existierendes externes Ausgabeverzeichnis;
- ausreichend freier Speicher für den verschlüsselten Ciphertext.

Für den lokalen Compose-Dienst:

```text
OPS_POSTGRES_TOOL_MODE=docker-compose
OPS_POSTGRES_DOCKER_SERVICE=postgres
```

`AGE_BINARY` kann einen expliziten Age-Pfad setzen. Diese Hilfsvariablen
aktivieren keine schwächere Ziel-Allowlist.

## Verschlüsseltes Backup

```text
npm run ops:backup -- --source release-test --out <ABSOLUTER_EXTERNER_PFAD.dump.age>
```

Erwartetes Ergebnis:

1. Source wird gegen Alias, Host, Schema und Namens-Allowlist geprüft.
2. `pg_dump` schreibt Custom-Format auf stdout.
3. Age verschlüsselt den Stream direkt.
4. Ciphertext wird atomar auf den Zielnamen umbenannt.
5. `<pfad>.sha256` enthält genau einen 64-stelligen Hex-Digest.
6. Die Ausgabe bestätigt Datenbankname und Digest, niemals die URL.

Der Befehl überschreibt weder Ciphertext noch Sidecar.

## Isolierter Restore

```text
npm run ops:restore -- --in <ABSOLUTER_EXTERNER_PFAD.dump.age> --target restore-test
```

Der Befehl:

1. prüft Ciphertext und benachbarten SHA-256-Sidecar;
2. verweigert gleiche Source/Target-Identität und eine nicht leere Ziel-DB;
3. streamt `age --decrypt --identity …` direkt in
   `pg_restore --exit-on-error --clean --if-exists --no-owner`;
4. führt gegen das Restore-Ziel `prisma migrate deploy`,
   `npm run seed:verify` und `npm run db:smoke` aus.

Ein fehlgeschlagener Restore kann ein partiell beschriebenes Ziel
hinterlassen. Dieses Ziel darf nicht weiterverwendet werden; der Drill-
Orchestrator entfernt es über seine exakte Namens-Allowlist.

## Post-Restore-Smoke

Nach einem erfolgreichen Restore und vorhandenen Production-Build:

```text
npm run ops:release-smoke
npm run ops:password-reset-smoke
```

`DATABASE_URL` zeigt dabei auf das erlaubte Restore-Ziel.
`ops:release-smoke` prüft öffentliche Desktop-/360px-Routen und Login für
Candidate, Employer, Recruiter und Admin bei blockiertem externem Netzwerk.
`ops:password-reset-smoke` prüft Forgot Password → geschützte lokale Mailbox →
einmaliges Reset → Login. Beide Befehle sind lokale Release-Evidence, keine
reale Mailzustellung.

## Vollständiger E2E-08-Drill

Der bevorzugte Orchestrator ist:

```text
npm run test:release
```

Er verlangt die dokumentierte lokale Maintenance-DB `swisstalenthub`,
erzeugt drei zufällige allowlist-konforme Datenbanken, erstellt einen echten
`git clone --no-local`, führt Install/Migration/zweifachen Seed/Production-
Guard/Build/Backup/Restore/Smokes/Audits aus und entfernt Clone, Ciphertext,
Identity sowie Drill-Datenbanken im `finally`-Pfad.

Das maschinenlesbare Ergebnis liegt lokal unter
`test-results/phase18/run-manifest.json`. Es darf keine Secrets oder
Backup-Bytes enthalten.

## Evidence und Cleanup

Der datierte Record enthält:

- Release-Commit, Branch, Start/Ende und Toolversionen;
- Source-, Restore- und Guard-Datenbanknamen, niemals URLs;
- stabilen Seed-Manifest-Hash;
- Ciphertext-SHA-256, verschlüsselte Bytezahl und externe
  Retention-Klassifikation;
- gemessene RPO-/RTO-Dauer gegenüber den Hypothesen;
- jeden Teilbefehl mit Exit-Code;
- Bestätigung, dass Clone, Identity, Ciphertext und Drill-DBs entfernt wurden.

Nach einem manuellen Drill werden Ciphertext, Sidecar, Identity-Datei und
beide Drill-Datenbanken ebenfalls ausdrücklich entfernt. Vor jedem Drop wird
der exakte Zielname erneut gegen die Allowlist geprüft.

## Retention und Production-Grenzen

Der Architektur-Zielwert lautet `30` tägliche plus `12` monatliche
verschlüsselte Objekte, RPO ≤24 h und RTO ≤8 h. Im lokalen Drill ist das
Backup absichtlich **ephemeral**. Es existiert kein konfigurierter
Object-Storage-Lifecycle, keine genehmigte produktive Retention und keine
Business-Freigabe der RPO/RTO-Hypothesen.

Vor Production sind deshalb zusätzlich erforderlich:

- dedizierter Ops-Runner und freigegebener Storage-Standort;
- Secret Manager mit Zwei-Personen-Recovery-Zugriff;
- Lifecycle/Deletion und Restore-Drill-Kalender;
- benannter Backup-/Incident Owner;
- genehmigte RPO/RTO und dokumentierte Eskalation;
- Legal-/Privacy-Prüfung von Standort und Aufbewahrung.
