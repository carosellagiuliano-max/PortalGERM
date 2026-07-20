"use client";

import { useActionState, useRef, useState } from "react";
import { FileCheck2Icon, SaveIcon, ShieldCheckIcon } from "lucide-react";

import {
  completeCandidateOnboardingAction,
  saveCandidateProfileAction,
} from "@/app/candidate/jobpass/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type CandidateProfileActionState,
  type CandidateRequirementCode,
} from "@/lib/candidate/profile";
import { cn } from "@/lib/utils";

const MAXIMUM_CV_BYTES = 5 * 1024 * 1024;
const INITIAL_PROFILE_ACTION_STATE: CandidateProfileActionState = Object.freeze({
  status: "idle",
  message: "",
});
const ALLOWED_CV_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const LANGUAGE_OPTIONS = [
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Französisch" },
  { code: "it", label: "Italienisch" },
  { code: "en", label: "Englisch" },
] as const;
const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"] as const;
const JOB_TYPES = [
  ["PERMANENT", "Festanstellung"],
  ["TEMPORARY", "Temporär"],
  ["FREELANCE", "Freelance"],
  ["INTERNSHIP", "Praktikum"],
  ["APPRENTICESHIP", "Lehrstelle"],
  ["HOLIDAY_JOB", "Ferienjob"],
] as const;

export type JobPassFormInitialValues = Readonly<{
  revision: string;
  firstName: string;
  lastName: string;
  publicDisplayName: string;
  email: string;
  phone: string;
  cantonId: string;
  cityLabel: string;
  summary: string;
  desiredTitles: string;
  skillIds: readonly string[];
  languages: readonly Readonly<{ code: string; level: string }>[];
  categoryIds: readonly string[];
  workloadMin: string;
  workloadMax: string;
  desiredSalaryMin: string;
  desiredSalaryMax: string;
  desiredSalaryPeriod: string;
  jobTypes: readonly string[];
  remotePreference: string;
  mobilityRadiusKm: string;
  availabilityDate: string;
  workPermitType: string;
  radarVisible: boolean;
  currentDocument: Readonly<{
    safeFilename: string;
    mimeType: string;
    sizeBytes: number;
  }> | null;
}>;

export function JobPassForm({
  initial,
  cantons,
  skills,
  categories,
  radarNotice,
}: Readonly<{
  initial: JobPassFormInitialValues;
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  skills: readonly Readonly<{ id: string; name: string }>[];
  categories: readonly Readonly<{ id: string; name: string }>[];
  radarNotice: string;
}>) {
  const [state, action, pending] = useActionState(
    saveCandidateProfileAction,
    INITIAL_PROFILE_ACTION_STATE,
  );
  const otherLanguage = initial.languages.find(
    ({ code }) => !LANGUAGE_OPTIONS.some((option) => option.code === code),
  );

  return (
    <form action={action} className="grid gap-8" noValidate>
      <input type="hidden" name="revision" value={initial.revision} />
      <ActionFeedback state={state} />
      <div key={initial.revision} className="grid gap-8">
        <FieldGroup
          title="Persönliche Angaben"
          description="Diese Angaben gehören zu deinem Konto. Im anonymen Talent Radar werden sie nicht ausgegeben."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField name="firstName" label="Vorname" defaultValue={initial.firstName} state={state} maxLength={100} autoComplete="given-name" />
            <TextField name="lastName" label="Nachname" defaultValue={initial.lastName} state={state} maxLength={100} autoComplete="family-name" />
            <TextField name="publicDisplayName" label="Öffentlicher Anzeigename" defaultValue={initial.publicDisplayName} state={state} maxLength={160} description="Leer lassen für Vorname plus Initiale." />
            <TextField name="email" label="E-Mail" defaultValue={initial.email} state={state} type="email" disabled description="Wird aus deinem Konto übernommen." />
            <TextField name="phone" label="Telefon (optional)" defaultValue={initial.phone} state={state} maxLength={40} autoComplete="tel" />
            <NativeSelect name="cantonId" label="Kanton" defaultValue={initial.cantonId} state={state}>
              <option value="">Bitte wählen</option>
              {cantons.map((canton) => <option key={canton.id} value={canton.id}>{canton.name} ({canton.code.trim()})</option>)}
            </NativeSelect>
            <TextField name="cityLabel" label="Ort" defaultValue={initial.cityLabel} state={state} maxLength={160} autoComplete="address-level2" description="Der exakte Ort bleibt in der anonymen Radar-Ansicht verborgen." />
            <NativeSelect name="workPermitType" label="Arbeitsbewilligung (optional)" defaultValue={initial.workPermitType} state={state}>
              <option value="">Keine Angabe</option>
              <option value="SWISS_OR_EU_EFTA">Schweiz oder EU/EFTA</option>
              {(["B", "C", "G", "L", "F", "N", "S"] as const).map((permit) => <option key={permit} value={permit}>Ausweis {permit}</option>)}
              <option value="OTHER">Andere</option>
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="summary">Kurzprofil (optional)</Label>
            <Textarea id="summary" name="summary" defaultValue={initial.summary} maxLength={500} rows={5} aria-invalid={hasError(state, "summary") || undefined} aria-describedby="summary-help" />
            <div id="summary-help" className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>Maximal 500 Zeichen, bitte keine sensiblen Angaben.</span>
              <span>{initial.summary.length}/500</span>
            </div>
            <FieldError state={state} field="summary" />
          </div>
        </FieldGroup>

        <FieldGroup title="Berufliche Ziele" description="Diese Präferenzen helfen später bei nachvollziehbaren Job-Empfehlungen.">
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="desiredTitles">Wunschberufe</Label>
              <Textarea id="desiredTitles" name="desiredTitles" defaultValue={initial.desiredTitles} rows={3} maxLength={1_500} placeholder="Softwareentwickler:in, Frontend Engineer" aria-invalid={hasError(state, "desiredTitles") || undefined} />
              <p className="text-xs text-muted-foreground">Mit Komma oder neuer Zeile trennen, maximal 12.</p>
              <FieldError state={state} field="desiredTitles" />
            </div>
            <MultiSelect name="categoryIds" label="Bevorzugte Kategorien" values={initial.categoryIds} state={state} options={categories} />
            <SkillPicker values={initial.skillIds} state={state} options={skills} />
            <CheckboxGrid name="jobTypes" label="Bevorzugte Anstellungsarten" values={initial.jobTypes} options={JOB_TYPES} state={state} />
          </div>
        </FieldGroup>

        <FieldGroup title="Sprachen" description="Wähle mindestens eine Sprache und das passende Niveau.">
          <div className="grid gap-3 sm:grid-cols-2">
            {LANGUAGE_OPTIONS.map((language) => {
              const current = initial.languages.find(({ code }) => code === language.code);
              return (
                <LanguageRow key={language.code} code={language.code} label={language.label} level={current?.level ?? "B2"} enabled={current !== undefined} />
              );
            })}
            <div className="grid gap-2 rounded-lg border p-3 sm:col-span-2">
              <Label htmlFor="otherLanguageCode">Weitere Sprache (ISO-Code)</Label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Input id="otherLanguageCode" name="otherLanguageCode" defaultValue={otherLanguage?.code ?? ""} minLength={2} maxLength={2} placeholder="z. B. es" className="h-10" />
                <select name="otherLanguageLevel" defaultValue={otherLanguage?.level ?? "B2"} className={nativeControlClassName(false)} aria-label="Niveau der weiteren Sprache">
                  {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>{level === "NATIVE" ? "Muttersprache" : level}</option>)}
                </select>
              </div>
            </div>
          </div>
          <FieldError state={state} field="languages" />
        </FieldGroup>

        <FieldGroup title="Rahmenbedingungen" description="Optionale Lohnangaben werden nur als grober Bucket in der anonymen Vorschau gezeigt.">
          <div className="grid gap-5 sm:grid-cols-2">
            <NumberField name="workloadMin" label="Pensum min. (%)" defaultValue={initial.workloadMin} state={state} min={1} max={100} step={1} />
            <NumberField name="workloadMax" label="Pensum max. (%)" defaultValue={initial.workloadMax} state={state} min={1} max={100} step={1} />
            <NumberField name="desiredSalaryMin" label="Wunschlohn min. (CHF)" defaultValue={initial.desiredSalaryMin} state={state} min={1} max={10_000_000} step={1_000} />
            <NumberField name="desiredSalaryMax" label="Wunschlohn max. (CHF)" defaultValue={initial.desiredSalaryMax} state={state} min={1} max={10_000_000} step={1_000} />
            <NativeSelect name="desiredSalaryPeriod" label="Lohnperiode" defaultValue={initial.desiredSalaryPeriod} state={state}>
              <option value="">Keine Angabe</option>
              <option value="YEARLY">Pro Jahr (FTE)</option>
              <option value="MONTHLY">Pro Monat</option>
              <option value="HOURLY">Pro Stunde</option>
            </NativeSelect>
            <NativeSelect name="remotePreference" label="Remote-Präferenz" defaultValue={initial.remotePreference} state={state}>
              <option value="">Bitte wählen</option>
              <option value="ONSITE">Vor Ort</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Remote</option>
              <option value="ANY">Flexibel</option>
            </NativeSelect>
            <NumberField name="mobilityRadiusKm" label="Mobilitätsradius (km)" defaultValue={initial.mobilityRadiusKm} state={state} min={0} max={300} step={5} />
            <TextField name="availabilityDate" label="Verfügbar ab" defaultValue={initial.availabilityDate} state={state} type="date" />
          </div>
        </FieldGroup>

        <FieldGroup title="CV-Metadaten" description="Im MVP werden nur Dateiname, Grösse und MIME-Typ über den Mock-Speicher erfasst. Es werden keine Dateibytes übertragen oder gespeichert.">
          <CvMetadataFields
            key={initial.revision}
            currentDocument={initial.currentDocument}
            state={state}
          />
        </FieldGroup>

        <FieldGroup title="Anonymer Talent Radar" description="Die Einwilligung ist freiwillig und getrennt von Marketing oder Nutzungsbedingungen.">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="radarVisible" value="true" defaultChecked={initial.radarVisible} className="mt-1 size-4 shrink-0 accent-primary" />
              <span className="grid gap-1 text-sm leading-6">
                <span className="flex items-center gap-2 font-semibold"><ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />Anonym im Talent Radar sichtbar sein</span>
                <span className="text-muted-foreground">{radarNotice}</span>
              </span>
            </label>
          </div>
        </FieldGroup>
      </div>

      <Button type="submit" size="lg" className="h-11 w-full sm:w-fit" disabled={pending}>
        <SaveIcon aria-hidden="true" />
        {pending ? "SwissJobPass wird gespeichert …" : "SwissJobPass speichern"}
      </Button>
    </form>
  );
}

function CvMetadataFields({
  currentDocument,
  state,
}: Readonly<{
  currentDocument: JobPassFormInitialValues["currentDocument"];
  state: CandidateProfileActionState;
}>) {
  const [selectedCv, setSelectedCv] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      {currentDocument === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
          <span className="flex items-center gap-2"><FileCheck2Icon className="size-4 text-primary" aria-hidden="true" />{currentDocument.safeFilename} · {formatBytes(currentDocument.sizeBytes)}</span>
          <label className="flex items-center gap-2"><input type="checkbox" name="removeCv" value="true" className="size-4 accent-primary" /> CV entfernen</label>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="candidate-cv">CV auswählen (PDF, PNG, JPEG oder WebP)</Label>
        <Input
          ref={fileInput}
          id="candidate-cv"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            validateSelectedFile(
              event.currentTarget.files?.[0] ?? null,
              setSelectedCv,
              setFileError,
            );
            if (event.currentTarget.files?.[0] !== undefined && fileInput.current !== null && !ALLOWED_CV_MIME_TYPES.has(event.currentTarget.files[0].type)) {
              fileInput.current.value = "";
            }
          }}
          aria-invalid={fileError.length > 0 || undefined}
          aria-describedby="candidate-cv-help"
        />
        <p id="candidate-cv-help" className="text-xs leading-5 text-muted-foreground">Maximal 5 MB. Die Dateiauswahl bleibt lokal; gesendet werden ausschliesslich die drei Metadatenfelder.</p>
        {fileError ? <p className="text-sm text-destructive" role="alert">{fileError}</p> : null}
        <FieldError state={state} field="cv" />
        {selectedCv === null ? null : <p className="text-sm font-medium">Bereit: {selectedCv.name} · {formatBytes(selectedCv.size)}</p>}
      </div>
      <input type="hidden" name="cvFileName" value={selectedCv?.name ?? ""} />
      <input type="hidden" name="cvMimeType" value={selectedCv?.type ?? ""} />
      <input type="hidden" name="cvSizeBytes" value={selectedCv?.size ?? ""} />
    </>
  );
}

export function CompleteProfileForm({
  missing,
}: Readonly<{ missing: readonly CandidateRequirementCode[] }>) {
  const [state, action, pending] = useActionState(
    completeCandidateOnboardingAction,
    INITIAL_PROFILE_ACTION_STATE,
  );
  const shownMissing = state.missingRequirements ?? missing;
  return (
    <form action={action} className="grid gap-4">
      <ActionFeedback state={state} />
      {shownMissing.length ? (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-semibold">Für den Abschluss noch erforderlich:</p>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {shownMissing.map((code) => <li key={code}>• {requirementLabel(code)}</li>)}
          </ul>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full sm:w-fit" disabled={pending || shownMissing.length > 0}>
        <FileCheck2Icon aria-hidden="true" />
        {pending ? "Abschluss wird geprüft …" : "SwissJobPass verbindlich abschliessen"}
      </Button>
    </form>
  );
}

function FieldGroup({ title, description, children }: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
  return (
    <fieldset className="grid min-w-0 gap-5 rounded-xl border p-4 sm:p-5">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
      <p className="-mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      {children}
    </fieldset>
  );
}

function TextField({ name, label, state, description, ...props }: Readonly<{ name: string; label: string; state: CandidateProfileActionState; description?: string }> & React.ComponentProps<"input">) {
  const invalid = hasError(state, name);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="h-11" aria-invalid={invalid || undefined} aria-describedby={description ? `${name}-help` : undefined} {...props} />
      {description ? <p id={`${name}-help`} className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      <FieldError state={state} field={name} />
    </div>
  );
}

function NumberField(props: Readonly<{ name: string; label: string; state: CandidateProfileActionState; defaultValue: string; min: number; max: number; step: number }>) {
  return <TextField {...props} type="number" inputMode="numeric" />;
}

function NativeSelect({ name, label, state, children, defaultValue }: Readonly<{ name: string; label: string; state: CandidateProfileActionState; children: React.ReactNode; defaultValue: string }>) {
  const invalid = hasError(state, name);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} defaultValue={defaultValue} className={nativeControlClassName(invalid)} aria-invalid={invalid || undefined}>{children}</select>
      <FieldError state={state} field={name} />
    </div>
  );
}

function MultiSelect({ name, label, values, options, state }: Readonly<{ name: string; label: string; values: readonly string[]; options: readonly Readonly<{ id: string; name: string }>[]; state: CandidateProfileActionState }>) {
  const invalid = hasError(state, name);
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} multiple size={Math.min(8, Math.max(4, options.length))} defaultValue={[...values]} className={cn(nativeControlClassName(invalid), "h-auto min-h-32 py-2")} aria-invalid={invalid || undefined}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">Mehrfachauswahl mit Strg/Cmd oder Umschalttaste.</p>
      <FieldError state={state} field={name} />
    </div>
  );
}

function SkillPicker({
  values,
  options,
  state,
}: Readonly<{
  values: readonly string[];
  options: readonly Readonly<{ id: string; name: string }>[];
  state: CandidateProfileActionState;
}>) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(values));
  const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
  const suggestions = options
    .filter(
      (option) =>
        normalizedQuery.length === 0 ||
        option.name.toLocaleLowerCase("de-CH").includes(normalizedQuery),
    )
    .slice(0, 20);
  const selectedOptions = options.filter((option) => selected.has(option.id));

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="skill-search">Kompetenzen suchen</Label>
        <Input
          id="skill-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="z. B. TypeScript, Pflege, Buchhaltung"
          autoComplete="off"
          className="h-11"
          aria-controls="skill-suggestions"
        />
      </div>
      {selectedOptions.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Gewählte Kompetenzen">
          {selectedOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="rounded-full border bg-secondary px-3 py-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  next.delete(option.id);
                  return next;
                })
              }
              aria-label={`${option.name} entfernen`}
            >
              {option.name} ×
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Noch keine Kompetenz gewählt.</p>
      )}
      <div
        id="skill-suggestions"
        className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2"
        role="group"
        aria-label="Kompetenzvorschläge"
      >
        {suggestions.length ? (
          suggestions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={selected.has(option.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(option.id);
                    else next.delete(option.id);
                    return next;
                  });
                }}
                className="size-4 accent-primary"
              />
              {option.name}
            </label>
          ))
        ) : (
          <p className="p-2 text-sm text-muted-foreground">Keine passende Kompetenz gefunden.</p>
        )}
      </div>
      {[...selected].map((skillId) => (
        <input key={skillId} type="hidden" name="skillIds" value={skillId} />
      ))}
      <p className="text-xs text-muted-foreground">Bis zu 50 Kompetenzen; die Auswahl wird serverseitig gegen den Skill-Katalog geprüft.</p>
      <FieldError state={state} field="skillIds" />
    </div>
  );
}

function CheckboxGrid({ name, label, values, options, state }: Readonly<{ name: string; label: string; values: readonly string[]; options: readonly (readonly [string, string])[]; state: CandidateProfileActionState }>) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map(([value, optionLabel]) => (
          <label key={value} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" name={name} value={value} defaultChecked={values.includes(value)} className="size-4 accent-primary" />{optionLabel}</label>
        ))}
      </div>
      <FieldError state={state} field={name} />
    </div>
  );
}

function LanguageRow({ code, label, level, enabled }: Readonly<{ code: string; label: string; level: string; enabled: boolean }>) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 rounded-lg border p-3">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name={`languageEnabled_${code}`} value="true" defaultChecked={enabled} className="size-4 accent-primary" />{label}</label>
      <select name={`languageLevel_${code}`} defaultValue={level} className={nativeControlClassName(false)} aria-label={`${label} Niveau`}>
        {LANGUAGE_LEVELS.map((item) => <option key={item} value={item}>{item === "NATIVE" ? "Muttersprache" : item}</option>)}
      </select>
    </div>
  );
}

function ActionFeedback({ state }: Readonly<{ state: CandidateProfileActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
      <AlertTitle>
        {state.status === "success"
          ? "Gespeichert"
          : state.code === "PROFILE_CONFLICT"
            ? "Neuere Änderung erkannt"
            : "Bitte prüfen"}
      </AlertTitle>
      <AlertDescription>
        <p>{state.message}</p>
        {state.code === "PROFILE_CONFLICT" ? (
          <p className="mt-2">
            <button
              type="button"
              className="underline underline-offset-3 hover:text-foreground"
              onClick={() => window.location.reload()}
            >
              Aktuellen SwissJobPass neu laden
            </button>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function FieldError({ state, field }: Readonly<{ state: CandidateProfileActionState; field: string }>) {
  const messages = state.fieldErrors?.[field];
  if (!messages?.length) return null;
  return <div className="text-sm text-destructive" role="alert">{messages.map((message) => <p key={message}>{message}</p>)}</div>;
}

function hasError(state: CandidateProfileActionState, field: string) {
  return Boolean(state.fieldErrors?.[field]?.length);
}

function nativeControlClassName(invalid: boolean) {
  return cn(
    "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
    invalid && "border-destructive",
  );
}

function validateSelectedFile(file: File | null, setFile: (file: File | null) => void, setError: (message: string) => void) {
  if (file === null) {
    setFile(null);
    setError("");
    return;
  }
  if (!ALLOWED_CV_MIME_TYPES.has(file.type)) {
    setFile(null);
    setError("Erlaubt sind PDF, PNG, JPEG und WebP.");
    return;
  }
  if (file.size <= 0 || file.size > MAXIMUM_CV_BYTES) {
    setFile(null);
    setError("Die Datei muss grösser als 0 Byte und höchstens 5 MB sein.");
    return;
  }
  setFile(file);
  setError("");
}

function formatBytes(value: number) {
  return value < 1_024 * 1_024
    ? `${Math.ceil(value / 1_024)} KB`
    : `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function requirementLabel(code: CandidateRequirementCode) {
  return {
    FIRST_NAME: "Vorname",
    LAST_NAME: "Nachname",
    CANTON: "Kanton",
    TITLE_OR_CATEGORY: "Wunschberuf oder Kategorie",
    SKILL: "mindestens eine Kompetenz",
    LANGUAGE: "mindestens eine Sprache",
    WORKLOAD_RANGE: "gültiges Pensum von/bis",
    REMOTE_PREFERENCE: "Remote-Präferenz",
    JOB_TYPE: "mindestens eine Anstellungsart",
  }[code];
}
