"use server";

import { revalidatePath } from "next/cache";

import { cancelEmployerBoost, activateBoostWithCredit } from "@/lib/billing/boosts";
import {
  getEmployerBillingActionDependencies,
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";

const CREDIT_FIELDS = new Set(["jobId", "idempotencyKey"]);
const CANCEL_FIELDS = new Set(["boostId", "reason", "idempotencyKey"]);

export async function activateIncludedBoostAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, CREDIT_FIELDS)) return invalidState();
  const jobId = readSingleFormString(formData, "jobId");
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  if (jobId === null || idempotencyKey === null) return invalidState();
  const dependencies = await getEmployerBillingActionDependencies(false);
  if (dependencies === null) return forbiddenState();
  const result = await activateBoostWithCredit(
    { jobId, idempotencyKey },
    dependencies,
  );
  if (!result.ok) return errorState(result.code);
  revalidateBoostPaths(jobId);
  return Object.freeze({
    status: "success",
    message: `7-Tage-Boost aktiviert. Verwendet: ${fundingLabel(result.value.fundingSource)}, gültige Quelle bis ${formatDate(result.value.sourceValidTo)}.`,
  });
}

export async function cancelEmployerBoostAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, CANCEL_FIELDS)) return invalidState();
  const boostId = readSingleFormString(formData, "boostId");
  const reason = readSingleFormString(formData, "reason");
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  if (boostId === null || reason === null || idempotencyKey === null) {
    return invalidState();
  }
  const dependencies = await getEmployerBillingActionDependencies(false);
  if (dependencies === null) return forbiddenState();
  const result = await cancelEmployerBoost(
    { boostId, reason, idempotencyKey },
    dependencies,
  );
  if (!result.ok) return errorState(result.code);
  revalidateBoostPaths(result.value.jobId);
  return Object.freeze({
    status: "success",
    message: "Boost beendet. Wie angekündigt wurde kein Guthaben erstattet.",
  });
}

function revalidateBoostPaths(jobId: string) {
  revalidatePath(`/employer/jobs/${jobId}/boost`);
  revalidatePath(`/employer/jobs/${jobId}`);
  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  revalidatePath("/");
}

function invalidState(): BillingActionState {
  return Object.freeze({ status: "error", message: "Die Angaben konnten nicht eindeutig gelesen werden." });
}

function forbiddenState(): BillingActionState {
  return Object.freeze({ status: "error", message: "Nur aktive Firmeninhaber und Administratoren dürfen Boosts verwalten." });
}

function errorState(code: string): BillingActionState {
  const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: "Bitte prüfe die Angaben.",
    FORBIDDEN: "Du darfst diesen Boost nicht verwalten.",
    NOT_FOUND: "Die Stelle oder der Firmenzugriff ist nicht mehr verfügbar.",
    JOB_NOT_ELIGIBLE: "Die Stelle ist aktuell nicht öffentlich boost-fähig.",
    JOB_EXPIRES_TOO_SOON: "Die Stelle läuft vor dem Ende des Boosts ab.",
    OVERLAPPING_BOOST: "Für diesen Zeitraum besteht bereits ein Boost.",
    INSUFFICIENT_CREDITS: "Es ist kein verwendbares Plan- oder Admin-Boost-Credit verfügbar.",
    CONFLICT: "Der Boost wurde zwischenzeitlich geändert. Lade die Seite neu.",
    WRITE_FAILED: "Der Boost konnte nicht sicher gespeichert werden.",
  };
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: messages[code] ?? "Der Boost-Vorgang ist fehlgeschlagen.",
  });
}

function fundingLabel(source: "PLAN_ALLOWANCE" | "ADMIN_GRANT") {
  return source === "PLAN_ALLOWANCE" ? "Plan-Credit" : "Admin-Gutschrift";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}
