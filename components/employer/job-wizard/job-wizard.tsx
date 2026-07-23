"use client";

import { useActionState } from "react";

import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react";

import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import {
  applicationContactLabel,
  contentLanguageLabel,
  JobContentSections,
  JobFacts,
  JobTypeBadge,
} from "@/components/shared/job-content-sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APPLICATION_CONTACT_KINDS,
  APPLICATION_EFFORTS,
  INITIAL_EMPLOYER_JOB_FORM_STATE,
  JOB_BENEFIT_CODES,
  JOB_TYPES,
  REMOTE_TYPES,
  REQUIRED_DOCUMENT_KINDS,
  SALARY_PERIODS,
  type EmployerJobCatalog,
  type EmployerJobFormState,
  type EmployerJobFullDetail,
} from "@/lib/employer/job-contracts";
import { getFairJobEmployerHintDe } from "@/lib/scoring/fair-job-employer-hints";

type JobFormAction = (state: EmployerJobFormState, formData: FormData) => Promise<EmployerJobFormState>;

export function NewJobWizard({
  catalog,
  action,
  idempotencyKey,
  defaultValidThrough,
}: Readonly<{
  catalog: EmployerJobCatalog;
  action: JobFormAction;
  idempotencyKey: string;
  defaultValidThrough: string;
}>) {
  const [state, formAction, pending] = useActionState(action, INITIAL_EMPLOYER_JOB_FORM_STATE);
  return (
    <Card>
      <CardHeader>
        <p className="eyebrow">Schritt 1 von 5</p>
        <CardTitle as="h2">Grundlagen</CardTitle>
        <CardDescription>Beim Speichern entsteht sofort ein Firmenentwurf. Ein Recruiter erhält dabei atomar die EDITOR-Zuweisung.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5">
          <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey ?? idempotencyKey} />
          <StepOneFields catalog={catalog} defaultValidThrough={defaultValidThrough} />
          <ActionFeedback state={state} />
          <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Entwurf wird angelegt …" : "Entwurf anlegen und weiter"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

export type EmployerJobWizardActions = Readonly<{
  saveStep: JobFormAction;
  reportingCheck: JobFormAction;
  aiSuggestion: JobFormAction;
  submit: JobFormAction;
  pause: JobFormAction;
  pauseAndRevise: JobFormAction;
  clonePaused: JobFormAction;
  cloneRejected: JobFormAction;
  reactivate: JobFormAction;
  close: JobFormAction;
}>;

export type EmployerJobWizardIdempotencyKeys = Readonly<{
  step1: string;
  step2: string;
  step3: string;
  reporting: string;
  submit: string;
  pause: string;
  pauseEdit: string;
  clonePaused: string;
  cloneRejected: string;
  reactivate: string;
  close: string;
}>;

export function EmployerJobWizard({
  job,
  catalog,
  step,
  actions,
  idempotencyKeys,
  additionalJobCheckoutHref,
}: Readonly<{
  job: EmployerJobFullDetail;
  catalog: EmployerJobCatalog;
  step: number;
  actions: EmployerJobWizardActions;
  idempotencyKeys: EmployerJobWizardIdempotencyKeys;
  additionalJobCheckoutHref: string | null;
}>) {
  const revision = job.revision;
  const [saveState, saveAction, savePending] = useActionState(actions.saveStep, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [reportState, reportAction, reportPending] = useActionState(actions.reportingCheck, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [aiState, aiAction, aiPending] = useActionState(actions.aiSuggestion, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [submitState, submitAction, submitPending] = useActionState(actions.submit, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [pauseState, pauseAction, pausePending] = useActionState(actions.pause, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [pauseEditState, pauseEditAction, pauseEditPending] = useActionState(actions.pauseAndRevise, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [clonePausedState, clonePausedAction, clonePausedPending] = useActionState(actions.clonePaused, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [cloneRejectedState, cloneRejectedAction, cloneRejectedPending] = useActionState(actions.cloneRejected, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(actions.reactivate, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [closeState, closeAction, closePending] = useActionState(actions.close, INITIAL_EMPLOYER_JOB_FORM_STATE);
  if (revision === null) {
    return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Revision fehlt</AlertTitle><AlertDescription>Dieser Job hat keine aktuelle Revision und kann nicht im Wizard bearbeitet werden.</AlertDescription></Alert>;
  }
  const editable = job.capabilities.mutateDraft && (job.status === "DRAFT" || job.status === "CHANGES_REQUESTED");
  const lifecycleStates = [pauseState, pauseEditState, clonePausedState, cloneRejectedState, reactivateState, closeState];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-5">
        <WizardNavigation jobId={job.id} activeStep={step} enabled={editable} />
        {!editable && step < 5 ? (
          <Alert><AlertTriangleIcon /><AlertTitle>Revision ist schreibgeschützt</AlertTitle><AlertDescription>Für diesen Status bzw. diese Zuweisungsrolle ist nur die nachvollziehbare Vorschau verfügbar.</AlertDescription></Alert>
        ) : null}
        {step === 1 ? (
          <WizardCard title="Grundlagen" description="Pensum, Ort, Laufzeit, Start und strukturierte Sprachprofile.">
            <form action={saveAction} className="grid gap-5">
              <CommandFields job={job} idempotencyKey={saveState.nextIdempotencyKey ?? idempotencyKeys.step1} />
              <input type="hidden" name="step" value="1" />
              <StepOneFields catalog={catalog} revision={revision} defaultValidThrough={toDateInput(revision.validThrough)} disabled={!editable} />
              <ActionFeedback state={saveState} />
              {editable ? <SubmitButton pending={savePending} label="Schritt 1 speichern" /> : null}
            </form>
          </WizardCard>
        ) : null}
        {step === 2 ? (
          <WizardCard title="Beschreibung" description="Geordnete, konkrete Aufgaben und Anforderungen bleiben als strukturierte Daten erhalten.">
            <form action={saveAction} className="grid gap-5">
              <CommandFields job={job} idempotencyKey={saveState.nextIdempotencyKey ?? idempotencyKeys.step2} />
              <input type="hidden" name="step" value="2" />
              <StepTwoFields catalog={catalog} revision={revision} disabled={!editable} />
              <ActionFeedback state={saveState} />
              {editable ? <SubmitButton pending={savePending} label="Schritt 2 speichern" /> : null}
            </form>
          </WizardCard>
        ) : null}
        {step === 3 ? (
          <WizardCard title="Lohn & Fairness" description="Diese persistierten Felder speisen den serverseitigen Fair-Job-Score; Client-Evidenz wird nicht übernommen.">
            <form action={saveAction} className="grid gap-5">
              <CommandFields job={job} idempotencyKey={saveState.nextIdempotencyKey ?? idempotencyKeys.step3} />
              <input type="hidden" name="step" value="3" />
              <StepThreeFields revision={revision} disabled={!editable} />
              <ActionFeedback state={saveState} />
              {editable ? <SubmitButton pending={savePending} label="Schritt 3 speichern" /> : null}
            </form>
          </WizardCard>
        ) : null}
        {step === 4 ? (
          <WizardCard title="Schweiz-Compliance" description="Die Mock-Prüfung wird mit vollständigem Datensatz-, Quellen- und Disclaimer-Snapshot gespeichert.">
            {revision.reportingCheck === null ? null : <ReportingEvidence check={revision.reportingCheck} />}
            {editable ? (
              <form action={reportAction} className="mt-5 grid gap-4">
                <CommandFields job={job} idempotencyKey={reportState.nextIdempotencyKey ?? idempotencyKeys.reporting} />
                <Field label="Berufsart" htmlFor="occupationCodeId">
                  <select id="occupationCodeId" name="occupationCodeId" required className={selectClass} defaultValue="">
                    <option value="" disabled>Berufsart wählen</option>
                    {catalog.occupations.map((occupation) => <option key={occupation.id} value={occupation.id}>{occupation.code} · {occupation.label}</option>)}
                  </select>
                </Field>
                <ActionFeedback state={reportState} />
                <SubmitButton pending={reportPending} label="Meldepflicht prüfen und speichern" />
              </form>
            ) : null}
          </WizardCard>
        ) : null}
        {step === 5 ? (
          <div className="grid gap-5">
            <JobPreview job={job} catalog={catalog} />
            <ScorePreview job={job} />
            {editable ? (
              <WizardCard title="Lokale Mock-Textassistenz" description="Vorschläge werden serverseitig erzeugt, nie automatisch gespeichert und enthalten keine externen Netzwerkaufrufe.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <AiForm action={aiAction} jobId={job.id} operation="IMPROVE" text={revision.offer ?? revision.description} label="Jobtext verbessern" pending={aiPending} />
                  <AiForm action={aiAction} jobId={job.id} operation="INCLUSIVE" text={[revision.title, revision.companyIntro, ...revision.tasks, ...revision.requirements, revision.offer].filter(Boolean).join("\n")} label="Text inklusiver formulieren" pending={aiPending} />
                  <AiForm action={aiAction} jobId={job.id} operation="SHORTEN_REQUIREMENTS" text={revision.requirements.join("\n")} label="Anforderungen kürzen" pending={aiPending} />
                  <AiForm action={aiAction} jobId={job.id} operation="SALARY_TRANSPARENCY" text="" label="Lohntransparenz-Hinweis" pending={aiPending} />
                </div>
                <ActionFeedback state={aiState} />
                {aiState.suggestion === undefined ? null : <pre className="mt-4 whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm leading-6">{aiState.suggestion}</pre>}
              </WizardCard>
            ) : null}
            {editable ? (
              <Card className="border-primary/30">
                <CardHeader><CardTitle as="h2">Zur Moderation einreichen</CardTitle><CardDescription>Alle fünf Schritte werden erneut aus der Datenbank validiert. Danach werden Revision und Fair-Score-Snapshot unveränderbar.</CardDescription></CardHeader>
                <CardContent>
                  <form action={submitAction} className="grid gap-4">
                    <CommandFields job={job} idempotencyKey={submitState.nextIdempotencyKey ?? idempotencyKeys.submit} />
                    <ActionFeedback state={submitState} />
                    <Button type="submit" disabled={submitPending}>{submitPending ? "Wird validiert …" : "Zur Prüfung einreichen"}</Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="grid gap-4 xl:sticky xl:top-6">
        <Card>
          <CardHeader><CardTitle as="h2">Inseratestatus</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between"><span>Status</span><Badge variant="outline">{job.status}</Badge></div>
            <div className="flex items-center justify-between"><span>Revision</span><span>#{revision.revisionNumber} · v{revision.version}</span></div>
            <div className="grid grid-cols-3 gap-2 text-center"><Metric value={job.views} label="Views" /><Metric value={job.saves} label="Saves" /><Metric value={job.applications} label="Bewerb." /></div>
            <p className="text-xs text-muted-foreground">Boost: {job.boostStatus ?? "nicht aktiv"}. Eine Aktivierungsaktion folgt erst in Phase 13.</p>
          </CardContent>
        </Card>
        {job.capabilities.manageLifecycle ? (
          <Card>
            <CardHeader><CardTitle as="h2">Statusaktionen</CardTitle><CardDescription>Jede Aktion prüft Job- und Revisionsversion erneut.</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {job.status === "PUBLISHED" ? <>
                <LifecycleForm action={pauseAction} job={job} keyValue={pauseState.nextIdempotencyKey ?? idempotencyKeys.pause} label="Unverändert pausieren" pending={pausePending} />
                <LifecycleForm action={pauseEditAction} job={job} keyValue={pauseEditState.nextIdempotencyKey ?? idempotencyKeys.pauseEdit} label="Pausieren & neue Revision" pending={pauseEditPending} />
              </> : null}
              {job.status === "PAUSED" ? <>
                <LifecycleForm action={reactivateAction} job={job} keyValue={reactivateState.nextIdempotencyKey ?? idempotencyKeys.reactivate} label="Unverändert reaktivieren" pending={reactivatePending} />
                <LifecycleForm action={clonePausedAction} job={job} keyValue={clonePausedState.nextIdempotencyKey ?? idempotencyKeys.clonePaused} label="Neue Revision erstellen" pending={clonePausedPending} />
              </> : null}
              {job.status === "REJECTED" ? <LifecycleForm action={cloneRejectedAction} job={job} keyValue={cloneRejectedState.nextIdempotencyKey ?? idempotencyKeys.cloneRejected} label="Als neuen Entwurf öffnen" pending={cloneRejectedPending} /> : null}
              {job.status === "PUBLISHED" || job.status === "PAUSED" || job.status === "EXPIRED" ? <LifecycleForm action={closeAction} job={job} keyValue={closeState.nextIdempotencyKey ?? idempotencyKeys.close} label="Inserat schliessen" pending={closePending} destructive /> : null}
              {lifecycleStates.map((state, index) => <ActionFeedback key={index} state={state} />)}
            </CardContent>
          </Card>
        ) : null}
        {additionalJobCheckoutHref === null ? null : (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle as="h2">Zusatzstelle freischalten</CardTitle>
              <CardDescription>
                Für diese freigegebene, noch nicht veröffentlichte Stelle ist
                ein zielgebundenes 30-Tage-Permit verfügbar. Der Kauf
                veröffentlicht die Stelle nicht automatisch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={additionalJobCheckoutHref} className={buttonVariants()}>
                Zusatzstelle für diesen Job ansehen
              </Link>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle as="h2">Letzte Ereignisse</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {job.statusEvents.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Statusereignisse.</p> : job.statusEvents.map((event, index) => (
              <div key={`${event.kind}-${event.createdAt.toISOString()}-${index}`} className="border-l-2 pl-3 text-sm">
                <p className="font-medium">{event.kind}</p><p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)} · {event.fromStatus ?? "Neu"} → {event.toStatus}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function StepOneFields({ catalog, revision, defaultValidThrough, disabled = false }: Readonly<{ catalog: EmployerJobCatalog; revision?: EmployerJobFullDetail["revision"]; defaultValidThrough: string; disabled?: boolean }>) {
  const value = revision ?? undefined;
  return <>
    <Field label="Stellentitel" htmlFor="title"><Input id="title" name="title" required minLength={3} maxLength={200} defaultValue={value?.title ?? ""} disabled={disabled} /></Field>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Kategorie" htmlFor="categoryId"><select id="categoryId" name="categoryId" required className={selectClass} defaultValue={value?.categoryId ?? ""} disabled={disabled}><option value="" disabled>Kategorie wählen</option>{catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
      <Field label="Vertragsart" htmlFor="jobType"><select id="jobType" name="jobType" className={selectClass} defaultValue={value?.jobType ?? "PERMANENT"} disabled={disabled}>{JOB_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Pensum min. %" htmlFor="workloadMin"><Input id="workloadMin" name="workloadMin" type="number" min={1} max={100} required defaultValue={value?.workloadMin ?? 80} disabled={disabled} /></Field>
      <Field label="Pensum max. %" htmlFor="workloadMax"><Input id="workloadMax" name="workloadMax" type="number" min={1} max={100} required defaultValue={value?.workloadMax ?? 100} disabled={disabled} /></Field>
      <Field label="Arbeitsmodell" htmlFor="remoteType"><select id="remoteType" name="remoteType" className={selectClass} defaultValue={value?.remoteType ?? "HYBRID"} disabled={disabled}>{REMOTE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Remote-Land (nur bei vollständig Remote)" htmlFor="remoteCountryCode"><Input id="remoteCountryCode" name="remoteCountryCode" maxLength={2} placeholder="CH" defaultValue={value?.remoteType === "REMOTE" ? value.remoteCountryCode ?? "CH" : ""} disabled={disabled} /></Field>
      <Field label="Kanton" htmlFor="cantonId"><select id="cantonId" name="cantonId" className={selectClass} defaultValue={value?.cantonId ?? ""} disabled={disabled}><option value="">Kein Kanton</option>{catalog.cantons.map((canton) => <option key={canton.id} value={canton.id}>{canton.code} · {canton.name}</option>)}</select></Field>
      <Field label="Ort (Pflicht bei Onsite/Hybrid)" htmlFor="cityId"><select id="cityId" name="cityId" className={selectClass} defaultValue={value?.cityId ?? ""} disabled={disabled}><option value="">Kein Ort bei vollständig Remote</option>{catalog.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></Field>
      <Field label="Freie Ortsangabe" htmlFor="locationLabel"><Input id="locationLabel" name="locationLabel" maxLength={200} defaultValue={value?.locationLabel ?? ""} disabled={disabled} /></Field>
      <Field label="Gültig bis" htmlFor="validThrough"><Input id="validThrough" name="validThrough" type="date" defaultValue={defaultValidThrough} disabled={disabled} /></Field>
      <Field label="Startdatum" htmlFor="startDate"><Input id="startDate" name="startDate" type="date" defaultValue={toDateInput(value?.startDate ?? null)} disabled={disabled} /></Field>
      <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm"><input name="startByArrangement" type="checkbox" value="true" defaultChecked={value?.startByArrangement ?? true} disabled={disabled} /> Start nach Vereinbarung</label>
    </div>
    <Field label="Sprachen (eine Zeile je Sprache: de:B2)" htmlFor="languages"><Textarea id="languages" name="languages" rows={4} placeholder={"de:B2\nfr:B1"} defaultValue={value?.languages.map((language) => `${language.code}:${language.minLevel}`).join("\n") ?? "de:B2"} disabled={disabled} /></Field>
  </>;
}

function StepTwoFields({ catalog, revision, disabled }: Readonly<{ catalog: EmployerJobCatalog; revision: NonNullable<EmployerJobFullDetail["revision"]>; disabled: boolean }>) {
  const selectedSkills = new Set(revision.skills.map(({ id }) => id));
  return <>
    <Field label="Firmenintro" htmlFor="companyIntro"><Textarea id="companyIntro" name="companyIntro" rows={4} minLength={20} maxLength={1200} required defaultValue={revision.companyIntro ?? ""} disabled={disabled} /></Field>
    <Field label="Aufgaben (eine konkrete Aufgabe pro Zeile)" htmlFor="tasks"><Textarea id="tasks" name="tasks" rows={7} required defaultValue={revision.tasks.join("\n")} disabled={disabled} /></Field>
    <Field label="Muss-Anforderungen (eine pro Zeile)" htmlFor="requirements"><Textarea id="requirements" name="requirements" rows={7} required defaultValue={revision.requirements.join("\n")} disabled={disabled} /></Field>
    <Field label="Kann-Anforderungen" htmlFor="niceToHave"><Textarea id="niceToHave" name="niceToHave" rows={5} defaultValue={revision.niceToHave.join("\n")} disabled={disabled} /></Field>
    <Field label="Unser Angebot" htmlFor="offer"><Textarea id="offer" name="offer" rows={6} required defaultValue={revision.offer ?? ""} disabled={disabled} /></Field>
    <fieldset className="grid gap-2"><legend className="text-sm font-medium">Skills</legend><div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">{catalog.skills.map((skill) => <label key={skill.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="skillIds" value={skill.id} defaultChecked={selectedSkills.has(skill.id)} disabled={disabled} /> {skill.name}</label>)}</div></fieldset>
    <Field label="Benefits (CODE|konkrete Beschreibung, max. 10)" htmlFor="benefits"><Textarea id="benefits" name="benefits" rows={7} placeholder={`${JOB_BENEFIT_CODES[0]}|Flexible Arbeitszeiten mit dokumentiertem Gleitzeitrahmen`} defaultValue={revision.benefits.map((benefit) => `${benefit.benefitCode}|${benefit.description}`).join("\n")} disabled={disabled} /><p className="mt-1 text-xs text-muted-foreground">Erlaubte Codes: {JOB_BENEFIT_CODES.join(", ")}</p></Field>
  </>;
}

function StepThreeFields({ revision, disabled }: Readonly<{ revision: NonNullable<EmployerJobFullDetail["revision"]>; disabled: boolean }>) {
  const selectedDocs = new Set(revision.requiredDocumentKinds);
  return <>
    <div className="grid gap-4 md:grid-cols-3">
      <Field label="Lohnperiode" htmlFor="salaryPeriod"><select id="salaryPeriod" name="salaryPeriod" className={selectClass} defaultValue={revision.salaryPeriod ?? ""} disabled={disabled}><option value="">Keine Angabe</option>{SALARY_PERIODS.map((period) => <option key={period}>{period}</option>)}</select></Field>
      <Field label="Lohn min. CHF" htmlFor="salaryMin"><Input id="salaryMin" name="salaryMin" type="number" min={0} defaultValue={revision.salaryMin ?? ""} disabled={disabled} /></Field>
      <Field label="Lohn max. CHF" htmlFor="salaryMax"><Input id="salaryMax" name="salaryMax" type="number" min={0} defaultValue={revision.salaryMax ?? ""} disabled={disabled} /></Field>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Antwortziel in Tagen" htmlFor="responseTargetDays"><Input id="responseTargetDays" name="responseTargetDays" type="number" min={1} max={30} required defaultValue={revision.responseTargetDays} disabled={disabled} /></Field>
      <Field label="Bewerbungsaufwand" htmlFor="applicationEffort"><select id="applicationEffort" name="applicationEffort" className={selectClass} defaultValue={revision.applicationEffort} disabled={disabled}>{APPLICATION_EFFORTS.map((effort) => <option key={effort}>{effort}</option>)}</select></Field>
    </div>
    <Field label="Bewerbungsprozess (ein Schritt pro Zeile)" htmlFor="applicationProcessSteps"><Textarea id="applicationProcessSteps" name="applicationProcessSteps" rows={5} required defaultValue={revision.applicationProcessSteps.join("\n")} disabled={disabled} /></Field>
    <fieldset className="grid gap-2"><legend className="text-sm font-medium">Benötigte Unterlagen</legend><div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">{REQUIRED_DOCUMENT_KINDS.map((kind) => <label key={kind} className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiredDocumentKinds" value={kind} defaultChecked={selectedDocs.has(kind)} disabled={disabled} /> {kind}</label>)}</div></fieldset>
    <Field label="Inklusionshinweis" htmlFor="inclusionStatement"><Textarea id="inclusionStatement" name="inclusionStatement" rows={4} maxLength={1000} defaultValue={revision.inclusionStatement ?? ""} disabled={disabled} /></Field>
    <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
      <Field label="Bewerbungskontakt" htmlFor="applicationContactKind"><select id="applicationContactKind" name="applicationContactKind" className={selectClass} defaultValue={revision.applicationContactKind} disabled={disabled}>{APPLICATION_CONTACT_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
      <Field label="Öffentlicher Kontaktwert" htmlFor="applicationContactValue"><Input id="applicationContactValue" name="applicationContactValue" required maxLength={512} defaultValue={revision.applicationContactValue} disabled={disabled} /></Field>
    </div>
  </>;
}

function WizardNavigation({ jobId, activeStep, enabled }: Readonly<{ jobId: string; activeStep: number; enabled: boolean }>) {
  return <nav aria-label="Wizard-Schritte" className="grid grid-cols-2 gap-2 sm:grid-cols-5">{["Grundlagen", "Beschreibung", "Fairness", "Compliance", "Vorschau"].map((label, index) => { const number = index + 1; return <Link key={label} href={`/employer/jobs/${jobId}?step=${number}`} aria-current={number === activeStep ? "step" : undefined} className={`rounded-lg border px-3 py-2 text-center text-sm ${number === activeStep ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>{number}. {label}</Link>; })}<span className="sr-only">{enabled ? "Bearbeitung möglich" : "Nur Ansicht"}</span></nav>;
}

export function JobPreview({ job, catalog }: Readonly<{ job: EmployerJobFullDetail; catalog: EmployerJobCatalog }>) {
  const revision = job.revision!;
  const category = catalog.categories.find(({ id }) => id === revision.categoryId)?.name ?? revision.categoryId;
  const canton = catalog.cantons.find(({ id }) => id === revision.cantonId);
  const city = catalog.cities.find(({ id }) => id === revision.cityId);
  const location = city?.name ?? canton?.name ?? revision.locationLabel ?? "Schweiz";
  return (
    <WizardCard title={revision.title} description="Vorschau aus den aktuell persistierten Revisionsdaten; Prüf- und Score-Evidenz werden separat dargestellt.">
      <div className="grid gap-7 text-sm leading-7">
        <div className="flex flex-wrap gap-2"><JobTypeBadge jobType={revision.jobType} /></div>
        <JobFacts
          facts={{
            locationLabel: location,
            remoteType: revision.remoteType,
            workloadMin: revision.workloadMin,
            workloadMax: revision.workloadMax,
            salaryMin: revision.salaryMin,
            salaryMax: revision.salaryMax,
            salaryPeriod: revision.salaryPeriod,
            startDate: revision.startDate,
            startByArrangement: revision.startByArrangement,
            applicationEffort: revision.applicationEffort,
            dateFact: {
              label: "Gültig bis",
              value: revision.validThrough,
              missingValue: "Nicht angegeben",
            },
          }}
          presentation="preview"
        />

        <JobContentSections
          content={{
            description: revision.companyIntro ?? revision.description,
            additionalDescription:
              revision.companyIntro !== null && revision.description !== "" && revision.description !== revision.companyIntro
                ? revision.description
                : null,
            tasks: revision.tasks,
            requirements: revision.requirements,
            niceToHave: revision.niceToHave,
            offer: revision.offer,
            benefits: revision.benefits,
            skills: revision.skills,
            languages: revision.languages,
            inclusionStatement: revision.inclusionStatement,
            applicationProcessSteps: revision.applicationProcessSteps,
            requiredDocumentKinds: revision.requiredDocumentKinds,
          }}
          headingLevel="h3"
          presentation="preview"
        />
        <section className="rounded-lg border bg-muted/30 p-4">
          <h3 className="font-semibold">Entwurfs- und Kontaktkontext</h3>
          <p>Kategorie: {category}</p>
          <p>Inhaltssprache: {contentLanguageLabel(revision.contentLanguage)}</p>
          <p>Öffentlicher Kontakt: {applicationContactLabel(revision.applicationContactKind)} · {revision.applicationContactValue}</p>
          <p>Antwortziel: {revision.responseTargetDays} Tage</p>
        </section>
      </div>
    </WizardCard>
  );
}

function ScorePreview({ job }: Readonly<{ job: EmployerJobFullDetail }>) {
  const score = job.score;
  if (score === null) return null;
  return <WizardCard title={`Fair-Job-Score: ${score.score}/100`} description={`Deterministische Berechnung ${score.version}; ein Boost verändert diesen Wert nie.`}>
    <div className="grid gap-2 sm:grid-cols-2">{Object.entries(score.evidence).map(([factor, evidence]) => <div key={factor} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>{factor}</span><Badge variant={evidence === "MET" ? "default" : "outline"}>{evidence}</Badge></div>)}</div>
    {score.employerSuggestions.length === 0 ? <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2Icon className="size-4" /> Keine regelbasierte Verbesserung offen.</p> : <div className="mt-4"><h3 className="font-medium">Verbesserungen</h3><ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{score.employerSuggestions.map((suggestion) => <li key={suggestion}>{getFairJobEmployerHintDe(suggestion)}</li>)}</ul></div>}
  </WizardCard>;
}

function ReportingEvidence({ check }: Readonly<{ check: NonNullable<NonNullable<EmployerJobFullDetail["revision"]>["reportingCheck"]> }>) {
  return <Alert><CheckCircle2Icon /><AlertTitle>{check.result} · {check.occupationCode} {check.occupationLabel}</AlertTitle><AlertDescription><p>{check.reason}</p><p>Datensatz {check.datasetVersion} / {check.dataYear} · {check.source}</p><p>{check.disclaimer}</p>{check.referenceUrl === null ? null : <p><a href={check.referenceUrl} target="_blank" rel="noreferrer noopener">Offizielle Quelle öffnen</a></p>}</AlertDescription></Alert>;
}

function AiForm({ action, jobId, operation, text, label, pending }: Readonly<{ action: (formData: FormData) => void; jobId: string; operation: string; text: string; label: string; pending: boolean }>) {
  return <form action={action}><input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="operation" value={operation} /><input type="hidden" name="text" value={text} /><Button type="submit" variant="outline" className="w-full" disabled={pending}><SparklesIcon /> {label}</Button></form>;
}

function LifecycleForm({ action, job, keyValue, label, pending, destructive = false }: Readonly<{ action: (formData: FormData) => void; job: EmployerJobFullDetail; keyValue: string; label: string; pending: boolean; destructive?: boolean }>) {
  return <form action={action}><CommandFields job={job} idempotencyKey={keyValue} /><Button type="submit" variant={destructive ? "destructive" : "outline"} className="w-full" disabled={pending}>{pending ? "Wird ausgeführt …" : label}</Button></form>;
}

function CommandFields({ job, idempotencyKey }: Readonly<{ job: EmployerJobFullDetail; idempotencyKey: string }>) {
  return <><input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="expectedJobVersion" value={job.version} /><input type="hidden" name="expectedRevisionVersion" value={job.revision?.version ?? 0} /><input type="hidden" name="idempotencyKey" value={idempotencyKey} /></>;
}

function WizardCard({ title, description, children }: Readonly<{ title: string; description: string; children: React.ReactNode }>) { return <Card><CardHeader><CardTitle as="h2">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>; }
function Field({ label, htmlFor, children }: Readonly<{ label: string; htmlFor: string; children: React.ReactNode }>) { return <div className="grid gap-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
function SubmitButton({ pending, label }: Readonly<{ pending: boolean; label: string }>) { return <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Wird gespeichert …" : label}</Button></div>; }
function ActionFeedback({ state }: Readonly<{ state: EmployerJobFormState }>) {
  if (state.status === "idle") return null;
  return <>
    {state.message === undefined ? null : <p role={state.status === "error" || state.status === "conflict" ? "alert" : "status"} className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{state.message}</p>}
    {state.upgradePrompt === undefined ? null : <UpgradeDialog key={state.nextIdempotencyKey ?? state.upgradePrompt.reason} prompt={state.upgradePrompt} defaultOpen />}
  </>;
}
function Metric({ value, label }: Readonly<{ value: number; label: string }>) { return <div className="rounded-lg bg-muted/50 p-2"><p className="font-semibold">{value}</p><p className="text-[0.65rem] text-muted-foreground">{label}</p></div>; }
function toDateInput(value: Date | null | undefined) { return value === null || value === undefined ? "" : value.toISOString().slice(0, 10); }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(value); }
const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
