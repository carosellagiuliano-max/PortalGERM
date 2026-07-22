"use server";

import { revalidatePath } from "next/cache";

import { saveCompanyBillingProfile } from "@/lib/billing/billing-profile";
import {
  getEmployerBillingActionDependencies,
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";

const PROFILE_FIELDS = new Set([
  "legalName",
  "billingContactEmail",
  "street",
  "postalCode",
  "city",
  "countryCode",
  "uid",
  "vatNumber",
  "expectedVersion",
]);

export async function saveBillingProfileAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const dependencies = await getEmployerBillingActionDependencies();
  if (dependencies === null) return deniedState();
  if (!hasOnlyFormFields(formData, PROFILE_FIELDS)) return invalidState();

  const values = Object.fromEntries(
    [...PROFILE_FIELDS].map((field) => [field, readSingleFormString(formData, field)]),
  ) as Record<string, string | null>;
  if (Object.values(values).some((value) => value === null)) return invalidState();
  if (values.countryCode !== "CH") return invalidState();

  const expectedVersion = values.expectedVersion === ""
    ? null
    : Number(values.expectedVersion);
  const result = await saveCompanyBillingProfile(
    {
      legalName: values.legalName,
      billingContactEmail: values.billingContactEmail,
      street: values.street,
      postalCode: values.postalCode,
      city: values.city,
      countryCode: "CH",
      uid: emptyToUndefined(values.uid ?? null),
      vatNumber: emptyToUndefined(values.vatNumber ?? null),
      expectedVersion,
    },
    dependencies,
  );
  if (!result.ok) return profileError(result.code);

  revalidatePath("/employer/billing");
  revalidatePath("/employer/billing/profile");
  revalidatePath("/employer/billing/checkout");
  return Object.freeze({
    status: "success",
    message: "Rechnungsprofil sicher gespeichert.",
  });
}

function emptyToUndefined(value: string | null) {
  return value === null || value.length === 0 ? undefined : value;
}

function invalidState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Bitte prüfe die Rechnungsangaben und lade das Formular bei Bedarf neu.",
  });
}

function deniedState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Das Rechnungsprofil ist für deine aktuelle Rolle nicht verfügbar.",
  });
}

function profileError(code: string): BillingActionState {
  if (code === "CONFLICT") {
    return Object.freeze({
      status: "conflict",
      message:
        "Das Rechnungsprofil wurde inzwischen geändert. Lade den aktuellen Stand neu.",
    });
  }
  if (code === "INVALID_INPUT") return invalidState();
  if (code === "FORBIDDEN" || code === "NOT_FOUND") return deniedState();
  return Object.freeze({
    status: "error",
    message: "Das Rechnungsprofil konnte nicht gespeichert werden.",
  });
}
