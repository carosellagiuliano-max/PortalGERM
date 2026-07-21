"use client";

import { useActionState, useRef, useState } from "react";
import { Building2Icon, MapPinPlusIcon, SaveIcon, Trash2Icon } from "lucide-react";

import {
  completeEmployerCompanyOnboardingAction,
  saveEmployerCompanyProfileAction,
} from "@/app/employer/company/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PlanGate } from "@/components/employer/plan-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type CompanyOnboardingRequirement,
  type EmployerCompanyActionState,
} from "@/lib/employer/company";
import { cn } from "@/lib/utils";

const INITIAL_ACTION_STATE: EmployerCompanyActionState = Object.freeze({
  status: "idle",
  message: "",
});

export type CompanyFormInitialValues = Readonly<{
  expectedUpdatedAt: string;
  name: string;
  uid: string;
  industry: string;
  size: string;
  website: string;
  logoStorageKey: string;
  coverStorageKey: string;
  linkedinUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  about: string;
  values: string;
  benefits: string;
  locations: readonly Readonly<{
    id: string;
    cantonId: string;
    cityId: string;
    address: string;
    postalCode: string;
    isPrimary: boolean;
  }>[];
}>;

type LocationDraft = {
  key: string;
  id: string;
  cantonId: string;
  cityId: string;
  address: string;
  postalCode: string;
  isPrimary: boolean;
};

export function CompanyForm({
  initial,
  canManage,
  enhancedProfileAllowed,
  cantons,
  cities,
}: Readonly<{
  initial: CompanyFormInitialValues;
  canManage: boolean;
  enhancedProfileAllowed: boolean;
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  cities: readonly Readonly<{ id: string; cantonId: string; name: string }>[];
}>) {
  const [state, action, pending] = useActionState(
    saveEmployerCompanyProfileAction,
    INITIAL_ACTION_STATE,
  );
  const nextLocationKey = useRef(initial.locations.length + 1);
  const [locations, setLocations] = useState<LocationDraft[]>(() =>
    initial.locations.length > 0
      ? initial.locations.map((location) => ({
          ...location,
          key: location.id,
        }))
      : [blankLocation("new-location-0", true)],
  );

  return (
    <form action={action} className="grid gap-7" noValidate>
      <input
        type="hidden"
        name="expectedUpdatedAt"
        value={initial.expectedUpdatedAt}
      />
      <CompanyActionFeedback state={state} />
      {!canManage ? (
        <Alert>
          <Building2Icon aria-hidden="true" />
          <AlertTitle>Schreibgeschützte Firmenansicht</AlertTitle>
          <AlertDescription>
            Recruiter und Viewer sehen den aktuellen Stand, können Firmenprofil,
            Standorte und Verifizierung aber nicht verändern.
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={!canManage || pending} className="grid gap-7">
        <FieldGroup
          title="Grundangaben"
          description="Diese Angaben bilden nach dem separaten Onboarding-Abschluss das öffentliche Firmenprofil."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              name="name"
              label="Firmenname"
              defaultValue={initial.name}
              state={state}
              minLength={2}
              maxLength={200}
              required
              autoComplete="organization"
            />
            <TextField
              name="uid"
              label="UID (optional)"
              defaultValue={initial.uid}
              state={state}
              maxLength={32}
              placeholder="CHE-123.456.789"
              description="Website oder UID ist für den Onboarding-Abschluss erforderlich."
            />
            <TextField
              name="industry"
              label="Branche"
              defaultValue={initial.industry}
              state={state}
              maxLength={160}
            />
            <TextField
              name="size"
              label="Unternehmensgrösse"
              defaultValue={initial.size}
              state={state}
              maxLength={64}
              placeholder="z. B. 11–50"
            />
            <TextField
              name="website"
              label="Website"
              defaultValue={initial.website}
              state={state}
              type="url"
              maxLength={512}
              placeholder="https://example.ch"
              autoComplete="url"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="about">Öffentliche Beschreibung</Label>
            <Textarea
              id="about"
              name="about"
              defaultValue={initial.about}
              rows={7}
              minLength={20}
              maxLength={5_000}
              aria-invalid={hasError(state, "about") || undefined}
              aria-describedby="about-help"
            />
            <p id="about-help" className="text-xs leading-5 text-muted-foreground">
              20 bis 5’000 Zeichen. HTML wird serverseitig in sicheren Klartext umgewandelt.
            </p>
            <FieldError state={state} field="about" />
          </div>
        </FieldGroup>

        <FieldGroup
          title="Medien-Metadaten"
          description="Im Mock wird für das Logo nur ein sicherer Storage-Key gespeichert, keine hochgeladenen Dateibytes und keine externe Bild-URL."
        >
          <div className="grid gap-5">
            <TextField
              name="logoStorageKey"
              label="Logo Storage-Key (optional)"
              defaultValue={initial.logoStorageKey}
              state={state}
              maxLength={512}
              placeholder="mock-storage/company/logo.svg"
            />
          </div>
        </FieldGroup>

        <PlanGate
          allowed={enhancedProfileAllowed}
          title="Erweitertes Firmenprofil"
          explanation="Cover, Unternehmenswerte und Firmen-Benefits sind im aktuellen Plan schreibgeschützt. Bestehende Inhalte bleiben unverändert gespeichert; ein passender Plan schaltet ihre Bearbeitung serverseitig frei."
        >
          <FieldGroup
            title="Erweitertes Firmenprofil"
            description="Ein Eintrag pro Zeile. Es werden ausschliesslich gespeicherte Angaben dargestellt; Antwortversprechen entstehen daraus nicht."
          >
            <TextField
              name="coverStorageKey"
              label="Cover Storage-Key (optional)"
              defaultValue={initial.coverStorageKey}
              state={state}
              maxLength={512}
              placeholder="mock-storage/company/cover.webp"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextAreaField
                name="values"
                label="Unternehmenswerte"
                defaultValue={initial.values}
                state={state}
                rows={6}
                maxLength={2_000}
                description="Maximal 12 eindeutige Werte."
              />
              <TextAreaField
                name="benefits"
                label="Firmen-Benefits"
                defaultValue={initial.benefits}
                state={state}
                rows={6}
                maxLength={4_000}
                description="Maximal 20 konkrete Einträge. Job-Score-Benefits bleiben separat versioniert."
              />
            </div>
          </FieldGroup>
        </PlanGate>
        {!enhancedProfileAllowed ? (
          <div hidden>
            <input name="coverStorageKey" value={initial.coverStorageKey} readOnly />
            <textarea name="values" value={initial.values} readOnly />
            <textarea name="benefits" value={initial.benefits} readOnly />
          </div>
        ) : null}

        <FieldGroup
          title="Social Links"
          description="Nur vollständige HTTPS-Adressen werden akzeptiert. Leere Felder erzeugen keine öffentlichen Links."
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField name="linkedinUrl" label="LinkedIn" defaultValue={initial.linkedinUrl} state={state} type="url" maxLength={512} placeholder="https://www.linkedin.com/company/…" />
            <TextField name="facebookUrl" label="Facebook" defaultValue={initial.facebookUrl} state={state} type="url" maxLength={512} placeholder="https://www.facebook.com/…" />
            <TextField name="instagramUrl" label="Instagram" defaultValue={initial.instagramUrl} state={state} type="url" maxLength={512} placeholder="https://www.instagram.com/…" />
          </div>
        </FieldGroup>

        <FieldGroup
          title="Standorte"
          description="Für den Onboarding-Abschluss ist genau ein Schweizer Hauptstandort mit passendem Kanton und Ort erforderlich."
        >
          <input type="hidden" name="locationCount" value={locations.length} />
          <div className="grid gap-4">
            {locations.map((location, index) => {
              const availableCities = cities.filter(
                ({ cantonId }) => cantonId === location.cantonId,
              );
              return (
                <div key={location.key} className="grid gap-4 rounded-xl border p-4">
                  <input type="hidden" name={`location_${index}_id`} value={location.id} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <input
                        type="radio"
                        name="primaryLocationIndex"
                        value={index}
                        checked={location.isPrimary}
                        onChange={() =>
                          setLocations((current) =>
                            current.map((entry, entryIndex) => ({
                              ...entry,
                              isPrimary: entryIndex === index,
                            })),
                          )
                        }
                        className="size-4 accent-primary"
                      />
                      Hauptstandort
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLocations((current) => removeLocation(current, index))
                      }
                    >
                      <Trash2Icon aria-hidden="true" />
                      Standort entfernen
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`location-${index}-canton`}>Kanton</Label>
                      <select
                        id={`location-${index}-canton`}
                        name={`location_${index}_cantonId`}
                        value={location.cantonId}
                        onChange={(event) => {
                          const cantonId = event.currentTarget.value;
                          setLocations((current) =>
                            updateLocation(current, index, {
                              cantonId,
                              cityId: cities.some(
                                (city) => city.id === location.cityId && city.cantonId === cantonId,
                              )
                                ? location.cityId
                                : "",
                            }),
                          );
                        }}
                        className={nativeControlClassName(hasError(state, "locations"))}
                      >
                        <option value="">Bitte wählen</option>
                        {cantons.map((canton) => (
                          <option key={canton.id} value={canton.id}>
                            {canton.name} ({canton.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`location-${index}-city`}>Ort</Label>
                      <select
                        id={`location-${index}-city`}
                        name={`location_${index}_cityId`}
                        value={location.cityId}
                        onChange={(event) =>
                          setLocations((current) =>
                            updateLocation(current, index, {
                              cityId: event.currentTarget.value,
                            }),
                          )
                        }
                        className={nativeControlClassName(hasError(state, "locations"))}
                      >
                        <option value="">Bitte wählen</option>
                        {availableCities.map((city) => (
                          <option key={city.id} value={city.id}>{city.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`location-${index}-address`}>Adresse (optional)</Label>
                      <Input
                        id={`location-${index}-address`}
                        name={`location_${index}_address`}
                        value={location.address}
                        onChange={(event) =>
                          setLocations((current) =>
                            updateLocation(current, index, {
                              address: event.currentTarget.value,
                            }),
                          )
                        }
                        maxLength={255}
                        autoComplete="street-address"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`location-${index}-postal`}>Postleitzahl (optional)</Label>
                      <Input
                        id={`location-${index}-postal`}
                        name={`location_${index}_postalCode`}
                        value={location.postalCode}
                        onChange={(event) =>
                          setLocations((current) =>
                            updateLocation(current, index, {
                              postalCode: event.currentTarget.value,
                            }),
                          )
                        }
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        autoComplete="postal-code"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <FieldError state={state} field="locations" />
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={locations.length >= 10}
            onClick={() => {
              const key = `new-location-${nextLocationKey.current}`;
              nextLocationKey.current += 1;
              setLocations((current) => [
                ...current,
                blankLocation(key, current.length === 0),
              ]);
            }}
          >
            <MapPinPlusIcon aria-hidden="true" />
            Standort hinzufügen
          </Button>
        </FieldGroup>
      </fieldset>

      {canManage ? (
        <Button type="submit" size="lg" className="h-11 w-full sm:w-fit" disabled={pending}>
          <SaveIcon aria-hidden="true" />
          {pending ? "Firmenprofil wird gespeichert …" : "Firmenprofil speichern"}
        </Button>
      ) : null}
    </form>
  );
}

export function CompanyOnboardingForm({
  expectedUpdatedAt,
  missing,
  canManage,
}: Readonly<{
  expectedUpdatedAt: string;
  missing: readonly CompanyOnboardingRequirement[];
  canManage: boolean;
}>) {
  const [state, action, pending] = useActionState(
    completeEmployerCompanyOnboardingAction,
    INITIAL_ACTION_STATE,
  );
  const shownMissing = state.missingRequirements ?? missing;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      <CompanyActionFeedback state={state} />
      {shownMissing.length > 0 ? (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-semibold">Noch erforderlich:</p>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {shownMissing.map((requirement) => (
              <li key={requirement}>• {onboardingRequirementLabel(requirement)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          Alle Pflichtangaben sind gespeichert. Der Abschluss aktiviert das Firmenprofil,
          erteilt aber noch kein Verifizierungsabzeichen.
        </p>
      )}
      {canManage ? (
        <Button
          type="submit"
          size="lg"
          className="h-11 w-full sm:w-fit"
          disabled={pending || shownMissing.length > 0}
        >
          <Building2Icon aria-hidden="true" />
          {pending ? "Abschluss wird geprüft …" : "Firmen-Onboarding abschliessen"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nur Owner oder Admin können das Onboarding abschliessen.
        </p>
      )}
    </form>
  );
}

function FieldGroup({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: React.ReactNode;
}>) {
  return (
    <fieldset className="grid min-w-0 gap-5 rounded-xl border p-4 sm:p-5">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
      <p className="-mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      {children}
    </fieldset>
  );
}

function TextField({
  name,
  label,
  state,
  description,
  ...props
}: Readonly<{
  name: string;
  label: string;
  state: EmployerCompanyActionState;
  description?: string;
}> & React.ComponentProps<"input">) {
  const invalid = hasError(state, name);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        className="h-11"
        aria-invalid={invalid || undefined}
        aria-describedby={description ? `${name}-help` : undefined}
        {...props}
      />
      {description ? (
        <p id={`${name}-help`} className="text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
      <FieldError state={state} field={name} />
    </div>
  );
}

function TextAreaField({
  name,
  label,
  state,
  description,
  ...props
}: Readonly<{
  name: string;
  label: string;
  state: EmployerCompanyActionState;
  description: string;
}> & React.ComponentProps<"textarea">) {
  const invalid = hasError(state, name);
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={`${name}-help`}
        {...props}
      />
      <p id={`${name}-help`} className="text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <FieldError state={state} field={name} />
    </div>
  );
}

function CompanyActionFeedback({ state }: Readonly<{ state: EmployerCompanyActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert
      variant={state.status === "error" ? "destructive" : "default"}
      aria-live="polite"
    >
      <AlertTitle>
        {state.status === "success"
          ? "Gespeichert"
          : state.code === "CONFLICT"
            ? "Neuerer Stand erkannt"
            : "Bitte prüfen"}
      </AlertTitle>
      <AlertDescription>
        <p>{state.message}</p>
        {state.code === "CONFLICT" ? (
          <button
            type="button"
            className="mt-2 underline underline-offset-3"
            onClick={() => window.location.reload()}
          >
            Aktuellen Firmenstand neu laden
          </button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function FieldError({
  state,
  field,
}: Readonly<{ state: EmployerCompanyActionState; field: string }>) {
  const messages = state.fieldErrors?.[field];
  return messages?.length ? (
    <div className="text-sm text-destructive" role="alert">
      {messages.map((message) => <p key={message}>{message}</p>)}
    </div>
  ) : null;
}

function hasError(state: EmployerCompanyActionState, field: string) {
  return Boolean(state.fieldErrors?.[field]?.length);
}

function nativeControlClassName(invalid: boolean) {
  return cn(
    "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm",
    invalid && "border-destructive",
  );
}

function blankLocation(key: string, isPrimary: boolean): LocationDraft {
  return {
    key,
    id: "",
    cantonId: "",
    cityId: "",
    address: "",
    postalCode: "",
    isPrimary,
  };
}

function updateLocation(
  locations: readonly LocationDraft[],
  index: number,
  patch: Partial<LocationDraft>,
) {
  return locations.map((location, currentIndex) =>
    currentIndex === index ? { ...location, ...patch } : location,
  );
}

function removeLocation(locations: readonly LocationDraft[], index: number) {
  const removed = locations[index];
  const remaining = locations.filter((_, currentIndex) => currentIndex !== index);
  if (remaining.length === 0) return [blankLocation("new-location-empty", true)];
  if (removed?.isPrimary) {
    return remaining.map((location, currentIndex) => ({
      ...location,
      isPrimary: currentIndex === 0,
    }));
  }
  return remaining;
}

function onboardingRequirementLabel(requirement: CompanyOnboardingRequirement) {
  return {
    NAME: "Firmenname",
    INDUSTRY: "Branche",
    SIZE: "Unternehmensgrösse",
    WEBSITE_OR_UID: "Website oder UID",
    PRIMARY_LOCATION: "genau ein Hauptstandort mit Kanton und Ort",
    PUBLIC_DESCRIPTION: "öffentliche Beschreibung",
  }[requirement];
}
