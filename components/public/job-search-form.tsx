import { SearchIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  PublicJobSearchInput,
  PublicJobSearchValidationIssue,
} from "@/lib/public/query-params";
import type { PublicCatalog } from "@/lib/public/types";

const controlClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function JobSearchForm({
  input,
  catalog,
}: Readonly<{ input: PublicJobSearchInput; catalog: PublicCatalog }>) {
  const issueMessages = [...new Set(input.validationIssues.map(validationMessage))];
  return (
    <form action="/jobs" method="get" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      {issueMessages.length === 0 ? null : (
        <Alert className="mb-4" role="alert">
          <AlertTitle>Bitte prüfe deine Suchangaben.</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {issueMessages.map((message) => <li key={message}>{message}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(10rem,1fr))]">
        <label className="grid gap-1.5 text-sm font-medium">
          Stichwort
          <Input name="keyword" defaultValue={input.keyword} maxLength={120} placeholder="Beruf, Fähigkeit oder Firma" className="h-10" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Kanton
          <select name="canton" defaultValue={input.cantonSlugs[0] ?? ""} className={controlClass}>
            <option value="">Alle Kantone</option>
            {catalog.cantons.map((canton) => <option key={canton.id} value={canton.slug}>{canton.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Kategorie
          <select name="category" defaultValue={input.categorySlugs[0] ?? ""} className={controlClass}>
            <option value="">Alle Kategorien</option>
            {catalog.categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Sortierung
          <select name="sort" defaultValue={sortValue(input.sort)} className={controlClass}>
            <option value="relevance">Relevanz</option>
            <option value="newest">Neueste zuerst</option>
            <option value="fairjobscore">Fair-Job-Score</option>
            <option value="salary">Höchster Lohn</option>
            <option value="response">Antwortverhalten</option>
          </select>
        </label>
      </div>
      <details className="mt-4 rounded-lg border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium">Weitere Filter</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Stadt
            <select name="city" defaultValue={input.citySlugs[0] ?? ""} className={controlClass}>
              <option value="">Alle Städte</option>
              {catalog.cities.map((city) => <option key={city.id} value={city.slug}>{city.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Umkreis (km)
            <Input
              type="number"
              name="radius"
              min={1}
              max={200}
              step={1}
              defaultValue={input.radiusKm}
              placeholder="z. B. 25"
              className="h-10"
            />
          </label>
          <FilterSelect name="workloadMin" label="Pensum ab" value={numberValue(input.workloadMin)} options={[
            ["", "Keine Untergrenze"], ["0", "0%"], ["20", "20%"], ["40", "40%"],
            ["60", "60%"], ["80", "80%"], ["100", "100%"],
          ]} />
          <FilterSelect name="workloadMax" label="Pensum bis" value={numberValue(input.workloadMax)} options={[
            ["", "Keine Obergrenze"], ["20", "20%"], ["40", "40%"], ["60", "60%"],
            ["80", "80%"], ["100", "100%"],
          ]} />
          <FilterCheckboxGroup name="jobType" label="Anstellung" values={input.jobTypes} options={[
            ["PERMANENT", "Festanstellung"], ["TEMPORARY", "Befristet"],
            ["FREELANCE", "Freelance"], ["INTERNSHIP", "Praktikum"],
            ["APPRENTICESHIP", "Lehrstelle"], ["HOLIDAY_JOB", "Ferienjob"],
          ]} />
          <FilterCheckboxGroup name="remoteType" label="Arbeitsmodell" values={input.remoteTypes} options={[
            ["ONSITE", "Vor Ort"], ["HYBRID", "Hybrid"], ["REMOTE", "Remote"],
          ]} />
          <FilterCheckboxGroup name="applicationEffort" label="Bewerbungsaufwand" values={input.efforts} options={[
            ["SIMPLE", "Kurz"], ["MEDIUM", "Mittel"], ["LONG", "Umfangreich"],
          ]} />
          <label className="grid gap-1.5 text-sm font-medium">
            Mindestlohn (CHF)
            <Input type="number" name="salaryMin" min={1} max={10_000_000} step={1_000} defaultValue={input.salaryMin} className="h-10" />
          </label>
          <FilterSelect name="salaryPeriod" label="Lohnperiode" value={input.salaryPeriod ?? ""} required={input.salaryMin !== undefined || input.sort === "salary"} options={[
            ["", "Periode wählen"], ["YEARLY", "Pro Jahr"], ["MONTHLY", "Pro Monat"],
            ["HOURLY", "Pro Stunde"],
          ]} />
          <FilterCheckboxGroup name="language" label="Inseratesprache" values={input.languages} options={[
            ["DE", "Deutsch"], ["FR", "Französisch"], ["IT", "Italienisch"], ["EN", "Englisch"],
          ]} />
          <label className="flex items-center gap-2 self-end rounded-lg border bg-background px-3 py-2.5 text-sm">
            <input type="checkbox" name="salaryDisclosed" value="true" defaultChecked={input.salaryDisclosedOnly} />
            Lohn offengelegt
          </label>
          <label className="flex items-center gap-2 self-end rounded-lg border bg-background px-3 py-2.5 text-sm">
            <input type="checkbox" name="evidence" value="response" defaultChecked={input.responseEvidenceOnly} />
            Belastbares Antwortsignal
          </label>
          <label className="flex items-center gap-2 self-end rounded-lg border bg-background px-3 py-2.5 text-sm">
            <input type="checkbox" name="companyVerified" value="true" defaultChecked={input.companyVerifiedOnly} />
            Verifizierte Firma
          </label>
          <FilterSelect name="pageSize" label="Treffer pro Seite" value={String(input.pageSize)} options={[
            ["20", "20 Treffer"], ["30", "30 Treffer"], ["50", "50 Treffer"],
          ]} />
        </div>
      </details>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" size="lg"><SearchIcon aria-hidden="true" /> Stellen finden</Button>
        <Link href="/jobs" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Filter zurücksetzen</Link>
      </div>
    </form>
  );
}

function FilterSelect({ name, label, value, options, required = false }: Readonly<{
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  required?: boolean;
}>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <select name={name} defaultValue={value} className={controlClass} required={required}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </label>
  );
}

function FilterCheckboxGroup({ name, label, values, options }: Readonly<{
  name: string;
  label: string;
  values: readonly string[];
  options: readonly (readonly [string, string])[];
}>) {
  return (
    <fieldset className="rounded-lg border bg-background p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="mt-1 grid gap-2">
        {options.map(([optionValue, text]) => (
          <label key={optionValue} className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              name={name}
              value={optionValue}
              defaultChecked={values.includes(optionValue)}
            />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function numberValue(value: number | undefined) {
  return value === undefined ? "" : String(value);
}

function sortValue(sort: PublicJobSearchInput["sort"]) {
  if (sort === "fair-score") return "fairjobscore";
  return sort;
}

function validationMessage(issue: PublicJobSearchValidationIssue): string {
  if (issue.field === "salaryPeriod" && issue.code === "REQUIRED") {
    return "Wähle für Mindestlohn oder Lohnsortierung eine Lohnperiode.";
  }
  if (issue.field === "salaryPeriod") {
    return "Die Lohnperiode ist ungültig. Wähle Jahr, Monat oder Stunde.";
  }
  if (issue.field === "workloadMin" && issue.code === "CONFLICT") {
    return "Das minimale Pensum darf nicht über dem maximalen Pensum liegen.";
  }
  if (issue.field === "city" && issue.code === "REQUIRED") {
    return "Wähle für die Umkreissuche genau eine Stadt.";
  }
  if (issue.field === "city" && issue.code === "CONFLICT") {
    return "Die Umkreissuche unterstützt genau eine Stadt.";
  }
  const label = VALIDATION_FIELD_LABELS[issue.field];
  return issue.code === "OUT_OF_RANGE"
    ? `${label}: Der Wert liegt ausserhalb des erlaubten Bereichs.`
    : `${label}: Der Wert ist ungültig und wurde nicht angewendet.`;
}

const VALIDATION_FIELD_LABELS: Readonly<Record<PublicJobSearchValidationIssue["field"], string>> = {
  keyword: "Stichwort",
  canton: "Kanton",
  city: "Stadt",
  radius: "Umkreis",
  category: "Kategorie",
  workloadMin: "Pensum ab",
  workloadMax: "Pensum bis",
  jobType: "Anstellung",
  remoteType: "Arbeitsmodell",
  language: "Inseratesprache",
  applicationEffort: "Bewerbungsaufwand",
  salaryMin: "Mindestlohn",
  salaryPeriod: "Lohnperiode",
  salaryDisclosed: "Lohntransparenz",
  evidence: "Antwortsignal",
  companyVerified: "Firmenverifikation",
  sort: "Sortierung",
  pageSize: "Treffer pro Seite",
  after: "Seitenlink",
};
