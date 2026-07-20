import { SearchIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicJobSearchInput } from "@/lib/public/query-params";
import type { PublicCatalog } from "@/lib/public/types";

const controlClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function JobSearchForm({
  input,
  catalog,
}: Readonly<{ input: PublicJobSearchInput; catalog: PublicCatalog }>) {
  return (
    <form action="/jobs" method="get" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
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
            <option value="fair">Fair-Job-Score</option>
            <option value="salary-desc">Höchster Lohn</option>
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
          <FilterSelect name="workload" label="Pensum" value={workloadValue(input)} options={[
            ["", "Alle Pensen"], ["20-40", "20–40%"], ["40-60", "40–60%"],
            ["60-80", "60–80%"], ["80-100", "80–100%"], ["100", "100%"],
          ]} />
          <FilterSelect name="jobType" label="Anstellung" value={input.jobTypes[0] ?? ""} options={[
            ["", "Alle Arten"], ["PERMANENT", "Festanstellung"], ["TEMPORARY", "Befristet"],
            ["FREELANCE", "Freelance"], ["INTERNSHIP", "Praktikum"],
            ["APPRENTICESHIP", "Lehrstelle"], ["HOLIDAY_JOB", "Ferienjob"],
          ]} />
          <FilterSelect name="remote" label="Arbeitsmodell" value={input.remoteTypes[0] ?? ""} options={[
            ["", "Alle Modelle"], ["ONSITE", "Vor Ort"], ["HYBRID", "Hybrid"], ["REMOTE", "Remote"],
          ]} />
          <FilterSelect name="effort" label="Bewerbungsaufwand" value={input.efforts[0] ?? ""} options={[
            ["", "Jeder Aufwand"], ["SIMPLE", "Kurz"], ["MEDIUM", "Mittel"], ["LONG", "Umfangreich"],
          ]} />
          <label className="grid gap-1.5 text-sm font-medium">
            Mindestlohn (CHF)
            <Input type="number" name="salary" min={1} max={10_000_000} step={1_000} defaultValue={input.salaryMin} className="h-10" />
          </label>
          <FilterSelect name="language" label="Inseratesprache" value={input.languages[0] ?? ""} options={[
            ["", "Alle Sprachen"], ["DE", "Deutsch"], ["FR", "Französisch"], ["IT", "Italienisch"], ["EN", "Englisch"],
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
        </div>
      </details>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" size="lg"><SearchIcon aria-hidden="true" /> Stellen finden</Button>
        <Link href="/jobs" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Filter zurücksetzen</Link>
      </div>
    </form>
  );
}

function FilterSelect({ name, label, value, options }: Readonly<{
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
}>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <select name={name} defaultValue={value} className={controlClass}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </label>
  );
}

function workloadValue(input: PublicJobSearchInput) {
  return input.workloadMin === undefined || input.workloadMax === undefined
    ? ""
    : `${input.workloadMin}${input.workloadMin === input.workloadMax ? "" : `-${input.workloadMax}`}`;
}

function sortValue(sort: PublicJobSearchInput["sort"]) {
  if (sort === "fair-score") return "fair";
  if (sort === "salary") return "salary-desc";
  return sort;
}
