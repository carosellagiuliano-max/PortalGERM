# Phase 01 — Foundation, Toolchain und Repository-Governance

> Detail zu [00-PLAN.md](./00-PLAN.md) und Schritt 01 in [implementation-plan.md](./implementation-plan.md). **PortalGERM target status: NOT IMPLEMENTED.** Die 34 Quellhäkchen und alten WSL-Verifikationsnotizen wurden bewusst nicht übernommen.

## Ziel und geschäftlicher Nutzen

Eine reproduzierbare, plattformneutrale Next.js-/PostgreSQL-Basis schaffen, auf der spätere Produktflüsse sicher gebaut und nachgewiesen werden können. Der Nutzerwert ist noch kein Feature; der Geschäftswert ist die Vermeidung von Setup-, Build-, Datenbank- und Evidence-Drift.

## Rollen und Scope

- **Nutzerrollen:** alle späteren Rollen indirekt; in dieser Phase keine private Rolle oder Demo-Anmeldung.
- **In Scope:** App-Skeleton, Design-Tokens/UI-Primitives, Postgres/Prisma-Grundlage, Env-Validation, Tests/CI-Basis, Health, plattformneutrale Scripts, Dokumentation/Evidence.
- **Out of Scope:** Domainmodelle (02), Auth (06), Produktseiten (07+), funktionale Mock-Provider (04).
- **Requirements:** REQ-QA-001/002, REQ-OPS-001, REQ-DOC-001.

## Voraussetzungen

- [ ] Plan, ADR-012/013/015/016/023/027 und Source of Truth gelesen.
- [ ] Node.js ≥ 20 und kompatible npm-Version verfügbar; exact versions to be pinned.
- [ ] Lokale/CI PostgreSQL-Instanz erreichbar oder Docker Compose funktionsfähig.
- [ ] Ziel-Arbeitsbaum geprüft; keine fremden Änderungen überschreiben.

## Deliverables

### Toolchain und Paketkonfiguration

- [ ] Next.js App Router, React, TypeScript strict, Tailwind und shadcn/ui in kompatiblen **exakt gelockten** Versionen installieren.
- [ ] `packageManager` und `engines` dokumentieren/pinnen; `npm ci` in Clean Clone verifizieren.
- [ ] `@prisma/client` als Runtime-Dependency; Prisma/tsx/Vitest/ESLint als passende Dev-Dependencies.
- [ ] `package.json`-Scripts plattformneutral: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e` (darf bis 17 als klarer Placeholder exit non-zero/skip policy dokumentieren), `env:init`, `env:validate`, `db:generate`, `db:migrate`, `db:seed`, `db:studio`.
- [ ] Kein `NEXT_PRIVATE_OUTPUT_TRACE_ROOT=$PWD` oder anderes POSIX-only npm-Script; falls nötig `cross-env` oder Node-Wrapper.
- [ ] Prisma Client wird in Install/Build/CI explizit generiert; kein nur lokal vorhandenes ignoriertes Artefakt als Voraussetzung.

### Verzeichnis- und App-Skeleton

- [ ] `app/(public)`, `app/(auth)`, `app/candidate`, `app/employer`, `app/admin` und `app/api` vorbereitet.
- [ ] `components/ui`, `components/shared`, rollen-/domänenspezifische Ordner gemäss Blueprint.
- [ ] `lib/{config,db,auth,validation,security,policies,domains,providers,privacy,audit,analytics,notifications,search,scoring,utils}`.
- [ ] `prisma/{schema.prisma,migrations,seed}` und `tests/{unit,integration,e2e,fixtures}`.
- [ ] `app/layout.tsx` mit `lang="de-CH"`, Inter oder begründeter Font, Metadata, Toaster und Skip Link.
- [ ] Basis-Homepage kommuniziert Foundation ehrlich; jede sichtbare Navigation/CTA funktioniert oder ist klar als noch nicht verfügbar gekennzeichnet.
- [ ] `loading.tsx`, `error.tsx`, `not-found.tsx` als sichere, barrierearme Basis.

### UI- und Designsystem-Basis

- [ ] originale Swiss-clean Tokens in `globals.css`; keine kopierten Portal-Farben/Layout/Copy.
- [ ] notwendige shadcn/ui-Primitives (Button, Input, Label, Card, Badge, Dialog, Menu, Form, Select, Tabs, Sonner, Tooltip, Separator, Progress, Avatar, Alert, Sheet, Popover, Checkbox, Radio, Textarea).
- [ ] Komponenten funktionieren mit Tastatur/Fokus; 360px-Shell und Mobile Navigation getestet.
- [ ] Tailwind-v4-vs-anderer-Version-Konfiguration entspricht tatsächlich installierter Version; keine tote `tailwind.config.ts`-Anforderung.

### Prisma, PostgreSQL und Env

- [ ] PostgreSQL Datasource und generator in `prisma/schema.prisma`; noch keine Fachmodelle vortäuschen.
- [ ] `prisma.config.ts`/Migration-Pfad und minimale Baseline-Migration bewusst festgelegt.
- [ ] `.env.example` documents required `DATABASE_URL`, `APP_URL`, `NEXT_PUBLIC_APP_NAME`, `SESSION_SECRET`, `AUDIT_IP_HASH_KEYS`, `RADAR_OPAQUE_LOOKUP_KEYS`, `RADAR_OPAQUE_ENCRYPTION_KEYS`, `REVEAL_CONFIRMATION_KEYS`, `PII_REVEAL_KEYS`, `RATE_LIMIT_BACKEND=postgres`, non-production-only `ENABLE_LOCAL_MOCK_MAILBOX=false`/`DEV_MAILBOX_SECRET`, Ops-only `BACKUP_AGE_RECIPIENT` plus external secret-mounted `BACKUP_AGE_IDENTITY_FILE` path, and clearly inactive provider placeholders. Tax values are versioned domain data, not Env defaults.
- [ ] Secret/keyring format is exact: `SESSION_SECRET` is base64 for 32 random bytes; every `*_KEYS` is comma-separated `version:base64-32-byte-key` with the first entry the active writer and remaining unique versions read-only for rotation. HMAC and AES keyrings are never reused. `DEV_MAILBOX_SECRET` is ≥32 random bytes. `.env.example` contains unmistakable non-secret placeholders; Production/Staging startup fails on placeholder/missing/duplicate version, wrong decoded length, mailbox enabled or `RATE_LIMIT_BACKEND!=postgres`. Rotation writes with the new first version, reads old versions until an audited migration/retention cutoff, and never deletes an old key while referenced rows exist.
- [ ] Zod-`envSchema` loads server-only, returns only typed non-secret config and key handles, fails with variable name/reason but never value, and is tested for every invalid/rotation case. Cross-platform `npm run env:init` refuses Production, creates ignored `.env.local` only when absent, generates local secrets without echoing them to logs and supports a no-write CI validation mode; `npm run env:validate` validates the active process environment. The Ops identity path always points outside the repository and its key material is never copied into Env or logs.
- [ ] `.env*` korrekt ignoriert; keine echten Secrets getrackt.
- [ ] `docker-compose.yml` für PostgreSQL 16 (oder begründete Version), Healthcheck und named volume; keine automatisch destructive reset command.

### Security-/Operations-Basis

- [ ] `/health/live` liefert minimalen Prozessstatus ohne Konfiguration/PII.
- [ ] Grundheader (`nosniff`, frame protection, Referrer/Permissions Policy); vollständige CSP/HSTS-Laufzeit in 16.
- [ ] strukturierter Logger/Correlation-ID-Interface vorbereitet, noch ohne sensitive Daten.
- [ ] CI führt Clean Install, Lint, Typecheck, Unit, Prisma Generate/Validate und Build aus; Integration-DB wird isoliert.
- [ ] `codex-plan/evidence/README.md` definiert Evidence-Record-Format.

## Dateien/Ordner

`package.json`, Lockfile, `tsconfig.json`, `next.config.ts`, Tailwind/PostCSS/ESLint/Vitest config, `.gitignore`, `.env.example`, `docker-compose.yml`, `.github/workflows/*`, `app/*`, `components/*`, `lib/config|db|utils`, `prisma/*`, `tests/*`, Root `README.md`, `codex-plan/evidence/*`.

## Server Actions/APIs, Validierung und Berechtigungen

- Noch keine fachliche Mutation.
- `/health/live` ist öffentlich, read-only, rate-friendly und offenbart weder DB URL noch Versions-/Secretdetails.
- Env-Validierung ist die einzige Pflicht-Zod-Grenze; spätere Actions verwenden das in Phase 03 definierte Resultatmodell.
- Kein Middleware-RBAC-Placeholder, der Sicherheit vortäuscht.

## Audit, Analytics und Benachrichtigung

Noch keine fachlichen Events. Logger-Interface und Correlation ID dürfen aufgebaut werden. Kein externer Analytics-/Email-Aufruf.

## UX-, Mobile- und Accessibility-Zustände

- Loading/Error/404-Grundseiten in de-CH, keine Stacktraces.
- Foundation-Empty/Unavailable-Copy nennt echten nächsten Schritt und keine Fake-Funktion.
- Shell bei 360px, Desktop, Tastatur und sichtbarem Fokus geprüft.
- Kein Mobile-Menü durch simples Verstecken aller Navigationsoptionen ersetzen.

## Seed-/Testdaten

- Keine Demo-Arbeitgeber/-Jobs/-Kandidaten.
- Minimaler DB-Smoke darf eine isolierte technische Testtabelle/Migrationsmetadata nutzen; fachlicher Seed in Phase 05.
- Test-Env muss eindeutig von Development/Production getrennt sein.

## Tests und Akzeptanzkriterien

- [ ] `envSchema` akzeptiert gültige Testwerte und redigiert Fehler.
- [ ] Root-Layout rendert `lang=de-CH`, Skip Link und funktionale Basisnavigation.
- [ ] `/` und `/health/live` liefern HTTP 200 im Production Build.
- [ ] 404/Error zeigen sichere Texte; Errorlog enthält Correlation ID, keine Secret-Canary.
- [ ] PostgreSQL-Verbindung in isolierter Umgebung erfolgreich; Prisma Generate/Validate grün.
- [ ] Windows/npm-cmd und CI führen `dev`/`build` ohne POSIX-Env-Syntaxfehler aus.
- [ ] 360px ohne horizontalen Overflow; Navigation erreichbar; keyboard smoke besteht.
- [ ] Clean Clone `npm ci` + Quality Commands exit 0.

## Verifikationsbefehle und erwartete Resultate

```powershell
npm ci                       # exit 0 from lockfile
npm run db:generate          # Prisma Client generated
npx prisma validate          # schema valid
docker compose config --quiet
npm run lint                 # 0 errors
npm run typecheck            # 0 errors
npm test                     # foundation unit tests pass
npm run build                # production build succeeds
```

Zusätzlich Production Server starten und `/`, unbekannte Route und `/health/live` per HTTP prüfen; DB-Smoke dokumentieren. Jeder Nachweis nennt Zielcommit, OS, Node/npm, Exit-Code und Limitation.

## Risiken und bekannte Einschränkungen

- Quell-`node_modules` war plattforminkonsistent; niemals kopieren, stets `npm ci`.
- Source-Versionen/Next-Dokumentation können beim Zielstart bereits anders sein; ADR-012 aktualisieren.
- Foundation ist kein Demo-ready Produkt und erhält keine Produktstatusbehauptung.
- CSP, Auth, Rate Limiting, DB-Fachschema und Provider folgen später, bleiben aber nicht als „fertig“ markiert.

## Definition of Done

Alle Deliverables/Akzeptanzpunkte sind im Ziel implementiert und mit neuer Evidence belegt; DB und Production Build funktionieren reproduzierbar; Scripts sind Windows/CI-kompatibel; keine sichtbare Fake-CTA; keine geerbten Quellhäkchen. Erst danach darf Phase 01 im Masterplan `[x]` werden.
