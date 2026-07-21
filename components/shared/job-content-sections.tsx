import {
  BanknoteIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  LanguagesIcon,
  MapPinIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  ApplicationContactKind,
  ApplicationEffort,
  JobType,
  Language,
  RemoteType,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import { formatDate, formatSalaryRange, formatWorkload } from "@/lib/utils/format";

export type ApplicantFacingJobContent = Readonly<{
  description: string;
  additionalDescription?: string | null;
  tasks: readonly string[];
  requirements: readonly string[];
  niceToHave: readonly string[];
  offer: string | null;
  benefits: readonly Readonly<{ description: string }>[];
  skills: readonly Readonly<{ id: string; name: string; required: boolean }>[];
  languages: readonly Readonly<{ code: string; minLevel: string }>[];
  inclusionStatement: string | null;
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: readonly string[];
}>;

type JobContentSectionsProps = Readonly<{
  content: ApplicantFacingJobContent;
  headingLevel?: "h2" | "h3";
  presentation?: "public" | "preview";
}>;

export type ApplicantFacingJobFacts = Readonly<{
  locationLabel: string;
  remoteType: string;
  workloadMin: number;
  workloadMax: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: string | null;
  startDate: Date | null;
  startByArrangement: boolean;
  applicationEffort: string;
  dateFact: Readonly<{
    label: "Publiziert" | "Gültig bis";
    value: Date | null;
    missingValue: string;
  }>;
}>;

const JOB_TYPE_LABELS: Readonly<Record<JobType, string>> = {
  PERMANENT: "Festanstellung",
  TEMPORARY: "Befristet",
  FREELANCE: "Freelance",
  INTERNSHIP: "Praktikum",
  APPRENTICESHIP: "Lehrstelle",
  HOLIDAY_JOB: "Ferienjob",
};

const REMOTE_LABELS: Readonly<Record<RemoteType, string>> = {
  ONSITE: "Vor Ort",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

const SALARY_PERIOD_LABELS: Readonly<Record<SalaryPeriod, string>> = {
  YEARLY: "Jahr",
  MONTHLY: "Monat",
  HOURLY: "Stunde",
};

const APPLICATION_EFFORT_LABELS: Readonly<Record<ApplicationEffort, string>> = {
  SIMPLE: "Kurz",
  MEDIUM: "Mittel",
  LONG: "Umfangreich",
};

const APPLICATION_CONTACT_LABELS: Readonly<Record<ApplicationContactKind, string>> = {
  EMAIL: "E-Mail",
  PHONE: "Telefon",
  APPLY_URL: "Externer Bewerbungslink",
};

const CONTENT_LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
  DE: "Deutsch",
  FR: "Französisch",
  IT: "Italienisch",
  EN: "Englisch",
};

const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  CV: "Lebenslauf",
  COVER_LETTER: "Motivationsschreiben",
  CERTIFICATES: "Zeugnisse",
  REFERENCES: "Referenzen",
  PORTFOLIO: "Portfolio",
  OTHER: "Weitere Unterlagen",
};

/**
 * The single applicant-facing content renderer used by the public job page and
 * the employer's persisted Step-5 preview. Its deliberately narrow input keeps
 * employer-only revision and moderation data out of public presentation code.
 */
export function JobContentSections({
  content,
  headingLevel = "h2",
  presentation = "public",
}: JobContentSectionsProps) {
  const preview = presentation === "preview";
  const description = content.description || (preview ? "Noch keine Beschreibung erfasst." : "");
  const documents = content.requiredDocumentKinds
    .filter((kind) => kind !== "NONE")
    .map((kind) => DOCUMENT_LABELS[kind] ?? kind);

  return (
    <>
      <ContentSection headingLevel={headingLevel} presentation={presentation} title="Die Stelle">
        <p className={preview ? "whitespace-pre-wrap text-muted-foreground" : "whitespace-pre-line leading-7 text-muted-foreground"}>
          {description}
        </p>
        {content.additionalDescription ? (
          <p className={preview ? "mt-3 whitespace-pre-wrap text-muted-foreground" : "mt-3 whitespace-pre-line leading-7 text-muted-foreground"}>
            {content.additionalDescription}
          </p>
        ) : null}
      </ContentSection>

      <div className={preview ? "grid gap-7 md:grid-cols-2" : "grid gap-8 md:grid-cols-2"}>
        <ContentSection headingLevel={headingLevel} presentation={presentation} title="Deine Aufgaben">
          <BulletList values={content.tasks} presentation={presentation} />
        </ContentSection>
        <ContentSection headingLevel={headingLevel} presentation={presentation} title="Das bringst du mit">
          <BulletList values={content.requirements} presentation={presentation} />
        </ContentSection>
        {content.niceToHave.length === 0 && !preview ? null : (
          <ContentSection headingLevel={headingLevel} presentation={presentation} title="Von Vorteil">
            <BulletList values={content.niceToHave} presentation={presentation} />
          </ContentSection>
        )}
        {content.offer === null ? null : (
          <ContentSection headingLevel={headingLevel} presentation={presentation} title="Das wird geboten">
            <p className={preview ? "whitespace-pre-wrap text-muted-foreground" : "whitespace-pre-line leading-7 text-muted-foreground"}>
              {content.offer}
            </p>
          </ContentSection>
        )}
        {content.benefits.length === 0 && !preview ? null : (
          <ContentSection
            headingLevel={headingLevel}
            presentation={presentation}
            title={content.offer === null ? "Das wird geboten" : "Konkrete Benefits"}
          >
            <BulletList
              values={content.benefits.map((benefit) => benefit.description)}
              presentation={presentation}
            />
          </ContentSection>
        )}
        {content.skills.length === 0 && !preview ? null : (
          <ContentSection headingLevel={headingLevel} presentation={presentation} title="Fähigkeiten">
            <div className="flex flex-wrap gap-2">
              {content.skills.length === 0 ? (
                <span className="text-muted-foreground">Keine Skills erfasst.</span>
              ) : (
                content.skills.map((skill) => (
                  <Badge key={skill.id} variant={skill.required ? "secondary" : "outline"}>
                    {skill.name}{skill.required ? " · erforderlich" : ""}
                  </Badge>
                ))
              )}
            </div>
          </ContentSection>
        )}
        {content.languages.length === 0 && !preview ? null : (
          <ContentSection headingLevel={headingLevel} presentation={presentation} title="Sprachen">
            <div className="flex flex-wrap gap-2">
              {content.languages.map((language) => (
                <Badge key={`${language.code}-${language.minLevel}`} variant="outline">
                  <LanguagesIcon aria-hidden="true" /> {language.code.toUpperCase()} ab {language.minLevel}
                </Badge>
              ))}
            </div>
          </ContentSection>
        )}
      </div>

      {content.inclusionStatement === null ? null : (
        <ContentSection headingLevel={headingLevel} presentation={presentation} title="Zusammenarbeit & Inklusion">
          <p className={preview ? "whitespace-pre-wrap text-muted-foreground" : "leading-7 text-muted-foreground"}>
            {content.inclusionStatement}
          </p>
        </ContentSection>
      )}

      <ContentSection headingLevel={headingLevel} presentation={presentation} title="Bewerbungsprozess">
        {content.applicationProcessSteps.length > 0 ? (
          <ol className="grid gap-3">
            {content.applicationProcessSteps.map((step, index) => (
              <li key={`${index}-${step}`} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {index + 1}
                </span>
                <span className={preview ? "pt-0.5 text-muted-foreground" : "pt-0.5 leading-6 text-muted-foreground"}>
                  {step}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">
            {preview
              ? "Noch keine Prozessschritte erfasst."
              : "Der genaue Ablauf wird direkt mit dem Unternehmen abgestimmt."}
          </p>
        )}
        <p className={preview ? "mt-4 text-muted-foreground" : "mt-4 text-sm text-muted-foreground"}>
          <strong className="text-foreground">Benötigte Unterlagen:</strong>{" "}
          {documents.length === 0
            ? preview
              ? "Keine Pflichtunterlagen"
              : "Keine Pflichtunterlagen angegeben"
            : documents.join(", ")}
        </p>
      </ContentSection>
    </>
  );
}

export function JobTypeBadge({ jobType }: Readonly<{ jobType: string }>) {
  return <Badge variant="outline">{localizedLabel(JOB_TYPE_LABELS, jobType)}</Badge>;
}

export function applicationContactLabel(kind: string): string {
  return localizedLabel(APPLICATION_CONTACT_LABELS, kind);
}

export function contentLanguageLabel(language: string): string {
  return localizedLabel(CONTENT_LANGUAGE_LABELS, language);
}

export function JobFacts({
  facts,
  presentation = "public",
}: Readonly<{
  facts: ApplicantFacingJobFacts;
  presentation?: "public" | "preview";
}>) {
  const salary =
    facts.salaryMin !== null && facts.salaryMax !== null && facts.salaryPeriod !== null
      ? formatSalaryRange(
          facts.salaryMin,
          facts.salaryMax,
          localizedLabel(SALARY_PERIOD_LABELS, facts.salaryPeriod),
        )
      : "Nicht transparent ausgewiesen";
  const start = facts.startByArrangement
    ? "Nach Vereinbarung"
    : facts.startDate === null
      ? "Nicht angegeben"
      : formatDate(facts.startDate);
  const dateValue = facts.dateFact.value === null
    ? facts.dateFact.missingValue
    : formatDate(facts.dateFact.value);

  return (
    <dl className={presentation === "preview" ? "grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3" : "mt-7 grid gap-3 text-sm sm:grid-cols-2"}>
      <Fact icon={MapPinIcon} label="Arbeitsort" value={`${facts.locationLabel} · ${localizedLabel(REMOTE_LABELS, facts.remoteType)}`} />
      <Fact icon={BriefcaseBusinessIcon} label="Pensum" value={formatWorkload(facts.workloadMin, facts.workloadMax)} />
      <Fact icon={BanknoteIcon} label="Lohn" value={salary} />
      <Fact icon={CalendarDaysIcon} label={facts.dateFact.label} value={dateValue} />
      <Fact icon={CalendarDaysIcon} label="Start" value={start} />
      <Fact icon={BriefcaseBusinessIcon} label="Bewerbungsaufwand" value={localizedLabel(APPLICATION_EFFORT_LABELS, facts.applicationEffort)} />
    </dl>
  );
}

function Fact({ icon: Icon, label, value }: Readonly<{ icon: LucideIcon; label: string; value: string }>) {
  return (
    <div className="flex gap-3 rounded-lg bg-muted/35 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 font-medium">{value}</dd>
      </div>
    </div>
  );
}

function localizedLabel<T extends string>(labels: Readonly<Record<T, string>>, value: string): string {
  return Object.hasOwn(labels, value) ? labels[value as T] : value;
}

function ContentSection({
  title,
  children,
  headingLevel,
  presentation,
}: Readonly<{
  title: string;
  children: React.ReactNode;
  headingLevel: "h2" | "h3";
  presentation: "public" | "preview";
}>) {
  const Heading = headingLevel;
  return (
    <section>
      <Heading className={presentation === "preview" ? "font-semibold" : "text-2xl font-semibold"}>
        {title}
      </Heading>
      <div className={presentation === "preview" ? "mt-2" : "mt-4"}>{children}</div>
    </section>
  );
}

function BulletList({
  values,
  presentation,
}: Readonly<{ values: readonly string[]; presentation: "public" | "preview" }>) {
  return values.length === 0 ? (
    <p className="text-muted-foreground">Keine zusätzlichen Angaben.</p>
  ) : (
    <ul className={presentation === "preview" ? "grid gap-2 text-muted-foreground" : "grid gap-2 leading-7 text-muted-foreground"}>
      {values.map((value, index) => (
        <li key={`${index}-${value}`} className="flex gap-2">
          <span className="text-primary" aria-hidden="true">•</span>
          <span>{value}</span>
        </li>
      ))}
    </ul>
  );
}
