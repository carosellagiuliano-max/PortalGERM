"use client";

import { useActionState } from "react";

import {
  INITIAL_JOB_ALERT_ACTION_STATE,
  createJobAlertAction,
  updateJobAlertAction,
} from "@/app/candidate/alerts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CandidateJobAlertListItem } from "@/lib/candidate/job-alerts";

type References = Readonly<{
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  categories: readonly Readonly<{ id: string; name: string }>[];
  cities: readonly Readonly<{
    id: string;
    cantonId: string;
    cantonCode: string;
    name: string;
  }>[];
}>;

export function AlertForm({
  alert,
  deliveryConsentGranted,
  references,
}: Readonly<{
  alert?: CandidateJobAlertListItem;
  deliveryConsentGranted: boolean;
  references: References;
}>) {
  const serverAction = alert === undefined
    ? createJobAlertAction
    : updateJobAlertAction.bind(null, alert.id);
  const [state, action, pending] = useActionState(
    serverAction,
    INITIAL_JOB_ALERT_ACTION_STATE,
  );
  const query = alert?.query;
  const formPrefix = alert?.id ?? "new";
  const active = alert?.status === "ACTIVE";

  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              : "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950"
          }
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${formPrefix}-keyword`} label="Suchbegriff">
          <Input
            id={`${formPrefix}-keyword`}
            name="keyword"
            maxLength={80}
            defaultValue={query?.keyword ?? ""}
            placeholder="z. B. Pflegefachperson"
          />
        </Field>
        <Field id={`${formPrefix}-category`} label="Kategorie">
          <select
            id={`${formPrefix}-category`}
            name="categoryId"
            defaultValue={query?.categoryId ?? ""}
            className={selectClassName}
          >
            <option value="">Alle Kategorien</option>
            {references.categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </Field>
        <Field id={`${formPrefix}-canton`} label="Kanton">
          <select
            id={`${formPrefix}-canton`}
            name="cantonId"
            defaultValue={query?.cantonId ?? ""}
            className={selectClassName}
          >
            <option value="">Alle Kantone</option>
            {references.cantons.map((canton) => (
              <option key={canton.id} value={canton.id}>
                {canton.code} · {canton.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${formPrefix}-city`} label="Stadt">
          <select
            id={`${formPrefix}-city`}
            name="cityId"
            defaultValue={query?.cityId ?? ""}
            className={selectClassName}
          >
            <option value="">Keine bestimmte Stadt</option>
            {references.cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name} ({city.cantonCode})
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-muted-foreground">
            Eine Stadt muss zum gewählten Kanton gehören.
          </p>
        </Field>
        <Field id={`${formPrefix}-radius`} label="Radius in km">
          <Input
            id={`${formPrefix}-radius`}
            name="radiusKm"
            type="number"
            min={0}
            max={200}
            step={5}
            required
            defaultValue={query?.radiusKm ?? 0}
          />
        </Field>
        <Field id={`${formPrefix}-remote`} label="Remote-Präferenz">
          <select
            id={`${formPrefix}-remote`}
            name="remotePreference"
            required
            defaultValue={query?.remotePreference ?? "ANY"}
            className={selectClassName}
          >
            <option value="ANY">Alle Arbeitsmodelle</option>
            <option value="ONSITE">Vor Ort</option>
            <option value="HYBRID">Hybrid</option>
            <option value="REMOTE">Remote</option>
          </select>
        </Field>
        <Field id={`${formPrefix}-workload-min`} label="Pensum mindestens %">
          <Input
            id={`${formPrefix}-workload-min`}
            name="workloadMin"
            type="number"
            min={10}
            max={100}
            step={10}
            required
            defaultValue={query?.workloadMin ?? 40}
          />
        </Field>
        <Field id={`${formPrefix}-workload-max`} label="Pensum höchstens %">
          <Input
            id={`${formPrefix}-workload-max`}
            name="workloadMax"
            type="number"
            min={10}
            max={100}
            step={10}
            required
            defaultValue={query?.workloadMax ?? 100}
          />
        </Field>
        <Field id={`${formPrefix}-frequency`} label="Rhythmus">
          <select
            id={`${formPrefix}-frequency`}
            name="frequency"
            required
            defaultValue={alert?.frequency ?? "DAILY"}
            className={selectClassName}
          >
            <option value="DAILY">Täglich um 08:00</option>
            <option value="WEEKLY">Montags um 08:00</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
        <CheckboxField
          name="salaryTransparentOnly"
          defaultChecked={query?.salaryTransparentOnly ?? false}
        >
          Nur Stellen mit transparenter Lohnspanne
        </CheckboxField>
        <CheckboxField name="active" defaultChecked={active}>
          Dieses Jobabo ausdrücklich aktivieren
        </CheckboxField>
        {alert === undefined ? (
          <CheckboxField name="deliveryConsentAccepted" defaultChecked={false}>
            Ich willige separat in die Service-Zustellung dieses Jobabos ein.
            Dies aktiviert keine Marketing-Nachrichten.
          </CheckboxField>
        ) : null}
        {!deliveryConsentGranted ? (
          <p className="text-xs leading-5 text-amber-800">
            Die globale Service-Zustellung ist derzeit nicht freigegeben. Ein
            bestehendes Jobabo kann erst nach separater Freigabe wieder aktiviert werden.
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="w-full sm:w-fit">
        {pending
          ? "Wird gespeichert …"
          : alert === undefined
            ? "Jobabo erstellen"
            : "Filter speichern"}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function CheckboxField({
  name,
  defaultChecked,
  children,
}: Readonly<{
  name: "salaryTransparentOnly" | "active" | "deliveryConsentAccepted";
  defaultChecked: boolean;
  children: React.ReactNode;
}>) {
  return (
    <label className="flex items-start gap-3 text-sm leading-6">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span>{children}</span>
    </label>
  );
}

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
