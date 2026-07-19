# Glossary

> Domain terms used across the plan and the product UI. Keep this in sync when terminology changes.

| Term | Meaning |
|---|---|
| **SwissTalentHub** | The product: a Swiss nationwide job & career-decision portal MVP. |
| **Fair-Job-Score** | Versionierter, deterministischer 0–100-Score für beobachtbare Transparenz eines Inserats (u. a. Lohnband, konkrete Aufgaben/Anforderungen, Pensum/Vertrag, Arbeitsort/Remote, Prozess, Antwortziel). Firmenverifizierung ist ein separates Badge. Bezahlte Features sind niemals Inputs. |
| **Match-Score** | Versionierte, erklärbare Kandidaten-Entscheidungshilfe für Skills, Sprache, Region/Mobilität, Pensum, Lohn, Vertrag/Remote und Verfügbarkeit. Fehlende Daten beeinflussen die Konfidenz getrennt. P0 keine Arbeitgeber-Rangfolge oder automatische Entscheidung. |
| **SwissJobPass** | The candidate's structured profile (skills, languages, salary expectation, workload, mobility, availability, CV metadata) at `/candidate/jobpass`. |
| **Talent Radar** | Anonymous, opt-in talent pool. Employers need current Radar entitlement to browse **anonymous** candidate cards and additionally one fundable allowance/credit to send a contact request; credits alone never grant access. The candidate's identity stays hidden until **they** reveal it. |
| **Reveal / IdentityRevealGrant** | Kandidateninitiierte, protokollierte Freigabe ausgewählter geschlossener `RevealField`s an genau eine aktuell berechtigte Firma in einer akzeptierten Anfrage/Conversation. Nie global und nie durch den Arbeitgeber ausgelöst; jeder Read prüft Widerruf/Scope erneut. |
| **Opaque Radar ID** | Zufälliger, serverseitig je Company und 30-Tage-Epoche gemappter 128-Bit-Token für eine anonyme Radar-Karte. Weder Datenbank-PK noch Handle dienen als Autorisierungs- oder Korrelations-ID; Eligibility-Verlust invalidiert ihn sofort. |
| **Jobabo** | German for a saved job alert (`JobAlert`) — keyword/location/category criteria that would notify the candidate (mock email in MVP). |
| **Geboostet** | Public "sponsored/boosted" label on a job whose employer bought a **Job Boost** for extra visibility. Boosts affect ranking, **never** Fair-Job-Score. |
| **Job Boost** | Ein 7-Tage-Boost wird aus der Plan-Allowance, einem Admin-Grant oder als konkretes Produkt finanziert; der 30-Tage-Boost ist stets ein konkreter ProductVersion-Kauf. Beide platzieren ein eligible Job befristet und klar gekennzeichnet im Sponsored-Bereich relevanter Ergebnisse und verändern weder Relevanz-Eligibility noch Fair-Job-Score. |
| **Featured Job / Employer** | Inaktive P2-Kataloghypothesen für klar gekennzeichnetes, knappes Sponsored-Inventar. Falls nach späterem Inventar-/Reichweitengate aktiviert, verwenden sie versionierte Placement-/Order-Daten statt eines unkontrollierten Bool/Datumsfelds und bleiben vom Fair-Score getrennt. |
| **Stellenmeldepflicht** | Swiss job-vacancy reporting obligation. A versioned **mock Job-Room adapter** returns `REQUIRES_REPORTING`, `NOT_REQUIRED` or fail-closed `UNKNOWN` with reason/source and the mandatory "Orientierung, keine Rechtsberatung" disclaimer — no real arbeit.swiss call. |
| **Lohn-Radar / Salary Radar** | Public salary-orientation tool returning a CHF range from seeded `SalaryBand` rows, with a disclaimer. |
| **Contact Pack** | Einmalprodukt, das Talent-Kontakt-Credits als Ledger-Grant erzeugt, aber nie Radar-Zugang. Jede Anfrage verbraucht serverseitig atomar Plan-, dann gekaufte, dann Admin-Credits und speichert die Funding Source. |
| **Business Cockpit** | Globales Platform-Admin/Sales-Dashboard für MRR-Run-rate, Firmen nahe Limits, Boost-Potenzial, Leads, Churn-Risiko und nachvollziehbare Aktionen unter `/admin/business-cockpit`. Company Owner/Admin sehen dort nichts und erhalten nur tenant-eigene Billing-/Nutzungs-/Analytics-Daten. |
| **Plan / PlanVersion** | Wiederkehrendes Arbeitgeberpaket und seine unveränderliche Version: Free Basic, Starter, Pro, Business oder Enterprise. Bestehende Subscriptions behalten die gebuchte Version/Preissnapshots. |
| **Entitlement** | Zeitgebundenes, serverseitig berechnetes Recht oder Limit (z. B. aktive Jobs, Seats, Analytics, Radar). Eine Marketing-Featureliste ist kein Entitlement. |
| **Feature gate** | Serverseitige Policy, die ein Entitlement/Limit prüft und einen strukturierten `LIMIT`-Grund mit passendem Upgrade-Weg liefert — nie still oder nur clientseitig. |
| **Credit Ledger** | Append-only Bewegungen für Grants, Verbrauch, Ablauf und Korrektur. Der angezeigte Saldo ist aus Ledger-Einträgen ableitbar und darf bei Parallelzugriff nie negativ werden. |
| **Funding Source** | Herkunft eines verbrauchten Credits, z. B. monatliche Plan-Allowance, gekauftes Contact Pack oder auditierter Admin-Grant. |
| **Product Quality Gate** | Cross-cutting checklist in [product-quality-gates.md](./product-quality-gates.md). Every feature must have user story, route, data model, server action/API, validation, authorization, privacy, audit, UX states, mobile handling, seed data, tests, and documentation before it is considered complete. |
| **Needs verification** | Honest status for a planned or implemented item whose command/manual check has not yet been run successfully. A checkbox must stay unchecked while an item is in this state. |
| **Evidence Record** | Datierter Nachweis mit Zielrepository-Commit, Umgebung, Befehl/Manual Check, Exit/Resultat und Limitation. Voraussetzung für jedes Implementierungs-`[x]`. |
| **Requirement ID** | Stabile Kennung wie `REQ-TR-004`, die Anforderung, Phase, Modell, Policy, UX, Test und Abnahme verbindet. |
| **Mock provider** | Local adapter for an actual external boundary without network calls. It returns deterministic provider behavior; the owning domain persists truthful state (the pure Payment Mock itself writes none). Analytics/Invoice HTML are internal domain code, not provider mocks. |
| **Real-provider integration** | Post-MVP work to connect Stripe, email delivery, storage, AI, Job-Room, maps, or PDF generation. Requires explicit approval, secrets, security review, legal/privacy review, and operational monitoring. |
| **Rappen** | CHF minor unit (1 CHF = 100 Rappen). All billing/catalog amounts are stored as integer Rappen (see [decisions.md](./decisions.md) ADR-002). |
| **RBAC** | Role-based access control: global `Role` (Candidate/Employer/Recruiter/Admin) **plus** company-level `CompanyMembershipRole` (Owner/Admin/Recruiter/Viewer). Both enforced server-side. |
| **IDOR** | Insecure Direct Object Reference — accessing another tenant's entity by guessing its id. Prevented by server-side ownership checks on every id taken from a request. |
| **Company context** | Aktive Firma, die aus einer gültigen Membership serverseitig gewählt wird. Ein Client-`companyId` allein verleiht keinen Zugriff. |
| **Company Claim** | Evidenzbasierte Anfrage, einer bestehenden Firma beizutreten. UID/Name/E-Mail-Domain sind nur Match-Signale; bis Adminfreigabe existiert keine Membership und Claim verleiht weder Firmenzugriff noch Verifizierungsbadge. |
| **Data provenance** | `LIVE`, `DEMO` oder `TEST` auf öffentlich renderbaren Daten. Demo/Test ist in Production/SEO/Marktmetriken ausgeschlossen und in lokalen/Preview-UIs sichtbar gekennzeichnet. |
| **JobAssignment** | Zusätzliche Zuweisung eines Recruiters zu bestimmten Jobs/Bewerbungen innerhalb einer Firma. |
| **RecruiterMandate** | P1: befristetes, widerrufbares Mandat einer externen Agentur für eine Kundenfirma und definierte Jobs/Rechte. |
| **Safe DTO** | Allowlist-basiertes Serverobjekt, das nur für Rolle und Zweck erlaubte Felder enthält; besonders wichtig im Talent Radar und bei Bewerbungen. |
| **Marketplace cluster** | Messbare Kombination aus Region und Berufsfeld. Liquidität und SEO-Freigabe werden pro Cluster statt nur national beurteilt. |
| **Liquidity gate** | Interne Mindestbedingung für reale Stellen, aktivierte Kandidaten, Bewerbungen, Antwortquote und hilfreichen Content, bevor ein Cluster beworben/indexiert wird. |
| **Activated candidate** | Kandidat mit `CandidateProfile.onboardingStatus=COMPLETE`, gesetzt nur durch das versionierte Mindestfeld-Prädikat. Prozent, Bewerbung oder Jobabo ändern diesen Status nicht implizit. |
| **North Star** | „Qualifizierte, fristgerecht beantwortete Karrieregespräche pro aktivem Cluster und Monat“ — keine reine View- oder Signup-Zahl. |
| **P0 / P1 / P2** | P0 = kontrolliertes MVP zwingend; P1 = Pilot/Marktstart; P2 = nach echtem Feedback. `später` ist eigenes Folgeprojekt, `verworfen` wird bewusst nicht gebaut. |
| **DSG** | Swiss Federal Act on Data Protection. The MVP is "DSG-freundlich vorbereitet" — **never** claimed as full legal compliance. |
