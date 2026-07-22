import Link from "next/link";

import { RADAR_CANTON_CODES_V1 } from "@/lib/talentradar/privacy-policy-v1";

type FilterValues = Readonly<{
  skillId?: string;
  cantonCode?: string;
  salaryBudgetCeilingChf?: string;
  workloadMinimumPercent?: string;
  languageCode?: string;
  languageMinimumLevel?: string;
  remotePreference?: string;
}>;

const cantons: Readonly<Record<string, string>> = Object.freeze({
  AG: "Aargau", AI: "Appenzell Innerrhoden", AR: "Appenzell Ausserrhoden",
  BE: "Bern", BL: "Basel-Landschaft", BS: "Basel-Stadt", FR: "Freiburg",
  GE: "Genf", GL: "Glarus", GR: "Graubünden", JU: "Jura", LU: "Luzern",
  NE: "Neuenburg", NW: "Nidwalden", OW: "Obwalden", SG: "St. Gallen",
  SH: "Schaffhausen", SO: "Solothurn", SZ: "Schwyz", TG: "Thurgau",
  TI: "Tessin", UR: "Uri", VD: "Waadt", VS: "Wallis", ZG: "Zug",
  ZH: "Zürich",
});

const languages = Object.freeze([
  ["de", "Deutsch"],
  ["fr", "Französisch"],
  ["it", "Italienisch"],
  ["en", "Englisch"],
  ["es", "Spanisch"],
  ["pt", "Portugiesisch"],
] as const);

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export function FilterBar({
  values,
  skills,
}: Readonly<{
  values: FilterValues;
  skills: readonly Readonly<{ id: string; name: string }>[];
}>) {
  return (
    <form
      method="get"
      className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-4"
      aria-labelledby="radar-filter-title"
    >
      <div className="lg:col-span-4">
        <h2 id="radar-filter-title" className="font-medium">
          Suchfilter
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle Kriterien werden gemeinsam angewendet. Seltene Treffer werden
          durch die Mindestgrösse geschützt.
        </p>
      </div>

      <FilterSelect label="Skill" name="skillId" value={values.skillId}>
        <option value="">Alle Skills</option>
        {skills.map((skill) => (
          <option key={skill.id} value={skill.id}>{skill.name}</option>
        ))}
      </FilterSelect>

      <FilterSelect label="Kanton" name="cantonCode" value={values.cantonCode}>
        <option value="">Alle Kantone</option>
        {RADAR_CANTON_CODES_V1.map((code) => (
          <option key={code} value={code}>{cantons[code] ?? code}</option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Maximales Jahresbudget (FTE)"
        name="salaryBudgetCeilingChf"
        value={values.salaryBudgetCeilingChf}
      >
        <option value="">Kein Budgetfilter</option>
        {Array.from({ length: 22 }, (_, index) => 40_000 + index * 10_000).map((amount) => (
          <option key={amount} value={amount}>
            CHF {amount.toLocaleString("de-CH")}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Mindestpensum"
        name="workloadMinimumPercent"
        value={values.workloadMinimumPercent}
      >
        <option value="">Alle Pensen</option>
        {[20, 40, 60, 80, 100].map((amount) => (
          <option key={amount} value={amount}>mindestens {amount}%</option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Sprache"
        name="languageCode"
        value={values.languageCode}
      >
        <option value="">Keine Sprachvorgabe</option>
        {languages.map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Mindest-Sprachniveau"
        name="languageMinimumLevel"
        value={values.languageMinimumLevel}
      >
        <option value="">Kein Niveau</option>
        <option value="BASIC">Grundkenntnisse (A1/A2)</option>
        <option value="WORKING">Beruflich (B1/B2)</option>
        <option value="ADVANCED">Fortgeschritten (C1/C2/Muttersprache)</option>
      </FilterSelect>

      <FilterSelect
        label="Arbeitsmodell"
        name="remotePreference"
        value={values.remotePreference}
      >
        <option value="">Alle Modelle</option>
        <option value="ONSITE">Vor Ort</option>
        <option value="HYBRID">Hybrid</option>
        <option value="REMOTE">Remote</option>
        <option value="ANY">Flexibel</option>
      </FilterSelect>

      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Anwenden
        </button>
        <Link
          href="/employer/talent-radar"
          className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
        >
          Zurücksetzen
        </Link>
      </div>
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  children,
}: Readonly<{
  label: string;
  name: string;
  value?: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={fieldClass}>
        {children}
      </select>
    </label>
  );
}
