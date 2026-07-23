"use client";

import { useActionState } from "react";
import { BellOffIcon, MailCheckIcon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";

import {
  INITIAL_JOB_ALERT_ACTION_STATE,
  type JobAlertActionState,
} from "@/app/candidate/alerts/action-state";
import {
  deleteJobAlertAction,
  grantJobAlertDeliveryAction,
  pauseJobAlertAction,
  resumeJobAlertAction,
  revokeJobAlertDeliveryAction,
  runJobAlertDigestMockAction,
} from "@/app/candidate/alerts/actions";
import { AlertForm } from "@/components/candidate/alert-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CandidateJobAlertPageData } from "@/lib/candidate/job-alerts";

type Action = (
  previous: JobAlertActionState,
  formData: FormData,
) => Promise<JobAlertActionState>;

export function AlertDeliveryConsentCard({
  granted,
}: Readonly<{ granted: boolean }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Service-Zustellung</CardTitle>
        <CardDescription>
          Eigenständige Einwilligung nur für Jobabos; unabhängig von Marketing.
        </CardDescription>
        <CardAction>
          <Badge variant={granted ? "default" : "secondary"}>
            {granted ? "Freigegeben" : "Nicht freigegeben"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Ein globaler Widerruf pausiert alle aktiven Jobabos. Eine spätere
          Freigabe aktiviert keines davon automatisch.
        </p>
        <InlineAction
          action={granted ? revokeJobAlertDeliveryAction : grantJobAlertDeliveryAction}
          label={granted ? "Zustellung global widerrufen" : "Zustellung freigeben"}
          variant={granted ? "outline" : "default"}
          icon={granted ? <BellOffIcon aria-hidden="true" /> : <MailCheckIcon aria-hidden="true" />}
        />
      </CardContent>
    </Card>
  );
}

export function AlertList({
  data,
}: Readonly<{ data: CandidateJobAlertPageData }>) {
  if (data.alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-7 text-center">
        <h2 className="font-semibold">Noch keine Jobabos</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Erstelle oben deinen ersten Filter. Ohne ausdrückliche Aktivierung
          bleibt er pausiert.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {data.alerts.map((alert) => {
        const title = alert.query.keyword || alert.legacyLabel || "Alle passenden Stellen";
        const canResume =
          data.deliveryConsentGranted &&
          alert.status !== "DELETED" &&
          !alert.filterRequiresRepair;
        return (
          <Card key={alert.id}>
            <CardHeader>
              <CardTitle as="h2">{title}</CardTitle>
              <CardDescription>
                {frequencyLabel(alert.frequency)} · erstellt {formatDate(alert.createdAt)}
              </CardDescription>
              <CardAction>
                <Badge variant={alert.status === "ACTIVE" ? "default" : "secondary"}>
                  {statusLabel(alert.status)}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-5">
              {alert.filterRequiresRepair ? (
                <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  Dieser historische Filter konnte nicht sicher aufgelöst werden.
                  Prüfe und speichere die Auswahl neu, bevor du das Jobabo aktivierst.
                </p>
              ) : null}
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Stat label="Nächster Termin" value={formatDateTime(alert.nextDueAt)} />
                <Stat
                  label="Letzter Digest"
                  value={alert.lastDigestAt === null ? "Noch keiner" : formatDateTime(alert.lastDigestAt)}
                />
                <Stat
                  label="Letzte Treffer"
                  value={alert.lastDigestCount === null ? "–" : String(alert.lastDigestCount)}
                />
              </dl>

              <div className="flex flex-wrap gap-2">
                {alert.status === "ACTIVE" ? (
                  <InlineAction
                    action={pauseJobAlertAction.bind(null, alert.id)}
                    label="Pausieren"
                    variant="outline"
                    icon={<PauseIcon aria-hidden="true" />}
                  />
                ) : (
                  <InlineAction
                    action={resumeJobAlertAction.bind(null, alert.id)}
                    label="Ausdrücklich aktivieren"
                    disabled={!canResume}
                    icon={<PlayIcon aria-hidden="true" />}
                  />
                )}
                <InlineAction
                  action={runJobAlertDigestMockAction.bind(null, alert.id)}
                  label="Fälligen Mock-Digest ausführen"
                  variant="secondary"
                  icon={<MailCheckIcon aria-hidden="true" />}
                />
                <InlineAction
                  action={deleteJobAlertAction.bind(null, alert.id)}
                  label="Löschen"
                  variant="destructive"
                  icon={<Trash2Icon aria-hidden="true" />}
                />
              </div>

              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  Beispiel-E-Mail anzeigen
                </summary>
                <div className="mt-4 rounded-lg bg-muted/40 p-4 text-sm leading-6">
                  <p className="font-medium">Neue Stellen aus deinem Jobabo</p>
                  <p className="mt-2">
                    Für «{title}» wurden {alert.lastDigestCount ?? 0} neue Stellen
                    vorgemerkt. Dies ist nur eine schreibgeschützte Vorschau und
                    löst keinen Versand aus.
                  </p>
                </div>
              </details>

              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">Filter bearbeiten</summary>
                <div className="mt-5">
                  <AlertForm
                    alert={alert}
                    deliveryConsentGranted={data.deliveryConsentGranted}
                    references={data.references}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function InlineAction({
  action,
  label,
  icon,
  disabled = false,
  variant = "default",
}: Readonly<{
  action: Action;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "destructive";
}>) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_JOB_ALERT_ACTION_STATE,
  );
  return (
    <div className="grid gap-1">
      <form action={formAction}>
        <Button type="submit" variant={variant} disabled={disabled || pending}>
          {icon}
          {pending ? "Bitte warten …" : label}
        </Button>
      </form>
      {state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? "max-w-xs text-xs text-destructive" : "max-w-xs text-xs text-emerald-700"}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function frequencyLabel(value: "DAILY" | "WEEKLY") {
  return value === "DAILY" ? "Täglich um 08:00" : "Montags um 08:00";
}

function statusLabel(value: "ACTIVE" | "PAUSED" | "UNSUBSCRIBED" | "DELETED") {
  switch (value) {
    case "ACTIVE":
      return "Aktiv";
    case "PAUSED":
      return "Pausiert";
    case "UNSUBSCRIBED":
      return "Per Link pausiert";
    case "DELETED":
      return "Gelöscht";
  }
}

const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeZone: "Europe/Zurich",
});
const dateTimeFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function formatDate(value: Date) {
  return dateFormatter.format(value);
}

function formatDateTime(value: Date) {
  return dateTimeFormatter.format(value);
}
