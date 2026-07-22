"use server";

import { revalidatePath } from "next/cache";

import {
  getEmployerBillingActionDependencies,
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";
import { scheduleSubscriptionCancellation } from "@/lib/billing/subscriptions";
import { formatDate } from "@/lib/utils/format";

const CANCELLATION_FIELDS = new Set([
  "confirm",
  "idempotencyKey",
  "retainedMembershipIds",
]);

export async function cancelSubscriptionAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, CANCELLATION_FIELDS)) return invalidState();
  const confirmed = readSingleFormString(formData, "confirm");
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  const retainedValues = formData.getAll("retainedMembershipIds");
  const retainedMembershipIds = retainedValues.filter(
    (value): value is string => typeof value === "string",
  );
  if (
    confirmed !== "yes" ||
    idempotencyKey === null ||
    retainedMembershipIds.length === 0 ||
    retainedMembershipIds.length !== retainedValues.length ||
    new Set(retainedMembershipIds).size !== retainedMembershipIds.length
  ) {
    return invalidState();
  }
  const dependencies = await getEmployerBillingActionDependencies(true);
  if (dependencies === null) {
    return Object.freeze({
      status: "error",
      message: "Nur ein aktiver Firmeninhaber darf das Abonnement kündigen.",
    });
  }
  const result = await scheduleSubscriptionCancellation(
    { idempotencyKey, retainedMembershipIds },
    dependencies,
  );
  if (!result.ok) return cancellationError(result.code);
  revalidatePath("/employer/billing");
  revalidatePath("/employer/billing/usage");
  return Object.freeze({
    status: "success",
    message: `Kündigung per ${formatDate(result.value.effectiveAt)} vorgemerkt.`,
  });
}

function invalidState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Bestätige die Auswirkungen der Kündigung.",
  });
}

function cancellationError(code: string): BillingActionState {
  const messages: Record<string, string> = {
    NOT_FOUND: "Es besteht kein kündbares, aktuell wirksames Abonnement.",
    FORBIDDEN: "Nur ein aktiver Firmeninhaber darf das Abonnement kündigen.",
    CHANGE_ALREADY_SCHEDULED: "Für dieses Abonnement ist bereits eine Änderung vorgemerkt.",
    CATALOG_UNAVAILABLE: "Die Free-Basic-Limiten konnten nicht eindeutig bestimmt werden.",
    IDEMPOTENCY_MISMATCH: "Diese Bestätigung passt nicht zum vorhandenen Vorgang.",
    INVALID_INPUT: "Die Kündigung konnte nicht eindeutig bestätigt werden.",
  };
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: messages[code] ?? "Die Kündigung konnte nicht sicher vorgemerkt werden.",
  });
}
