"use server";

import { redirect } from "next/navigation";

import { getEmployerBillingActionDependencies } from "@/lib/billing/employer-action-dependencies";
import {
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";
import { createCheckoutOrder } from "@/lib/billing/orders";

const CHECKOUT_FIELDS = new Set([
  "kind",
  "slug",
  "quantity",
  "idempotencyKey",
  "retentionRequired",
  "retainedMembershipIds",
  "targetJobId",
  "importSetupApprovalId",
]);

export async function startBillingCheckoutAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, CHECKOUT_FIELDS)) return invalidState();
  const kind = readSingleFormString(formData, "kind");
  const slug = readSingleFormString(formData, "slug");
  const quantityText = readSingleFormString(formData, "quantity");
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  if (kind === null || slug === null || quantityText === null || idempotencyKey === null) {
    return invalidState();
  }
  const retentionMarker = formData.has("retentionRequired")
    ? readSingleFormString(formData, "retentionRequired")
    : null;
  const retentionRequired = retentionMarker === "yes";
  const retainedMembershipIds = formData
    .getAll("retainedMembershipIds")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  if (
    retainedMembershipIds.length !== formData.getAll("retainedMembershipIds").length ||
    new Set(retainedMembershipIds).size !== retainedMembershipIds.length ||
    (formData.has("retentionRequired") && retentionMarker !== "yes") ||
    (retentionRequired && retainedMembershipIds.length === 0) ||
    (!retentionRequired && retainedMembershipIds.length > 0) ||
    (kind !== "PLAN" && retentionRequired)
  ) {
    return invalidState();
  }

  const dependencies = await getEmployerBillingActionDependencies(kind === "PLAN");
  if (dependencies === null) {
    return Object.freeze({
      status: "error",
      message:
        kind === "PLAN"
          ? "Nur ein aktiver Firmeninhaber darf den Plan ändern."
          : "Dieser Kauf ist für deine aktuelle Rolle nicht verfügbar.",
    });
  }
  const input = kind === "PLAN"
    ? {
        kind: "PLAN",
        planSlug: slug,
        ...(retentionRequired ? { retainedMembershipIds } : {}),
        idempotencyKey,
      }
    : {
        kind: "PRODUCT",
        productSlug: slug,
        quantity: Number(quantityText),
        ...(formData.has("targetJobId")
          ? { targetJobId: readSingleFormString(formData, "targetJobId") }
          : {}),
        ...(formData.has("importSetupApprovalId")
          ? {
              importSetupApprovalId: readSingleFormString(
                formData,
                "importSetupApprovalId",
              ),
            }
          : {}),
        idempotencyKey,
      };
  const result = await createCheckoutOrder(input, dependencies);
  if (!result.ok) return checkoutError(result.code);
  redirect(result.value.checkoutUrl);
}

function invalidState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Die Auswahl konnte nicht eindeutig gelesen werden.",
  });
}

function checkoutError(code: string): BillingActionState {
  const messages: Record<string, string> = {
    INVALID_INPUT: "Bitte prüfe die gewählte Checkout-Option.",
    FORBIDDEN: "Dieser Checkout ist für deine aktuelle Rolle nicht verfügbar.",
    NOT_FOUND: "Der aktuelle Firmenkontext ist nicht mehr verfügbar.",
    PROFILE_REQUIRED: "Vervollständige zuerst das Rechnungsprofil.",
    CATALOG_UNAVAILABLE: "Diese Option ist aktuell nicht verfügbar.",
    TAX_UNAVAILABLE: "Die freigegebene Schweizer MWST-Rate ist aktuell nicht eindeutig verfügbar.",
    SAME_PLAN: "Dieser Plan ist bereits aktiv.",
    PLAN_NOT_SELF_SERVICE: "Dieser Planwechsel benötigt eine Beratung.",
    PRODUCT_NOT_AVAILABLE: "Dieses Produkt ist aktuell nicht kaufbar.",
    PRODUCT_RELEASE_REQUIRED: "Für dieses P1-Produkt fehlt ein gültiger aufgezeichneter Release-Entscheid.",
    PRODUCT_CONTEXT_INVALID: "Der serverseitig geprüfte Zielkontext ist nicht mehr gültig.",
    ADDITIONAL_JOB_NOT_ELIGIBLE: "Diese Stelle erfüllt die Voraussetzungen für eine Zusatzstelle nicht mehr.",
    JOB_BOOST_NOT_ELIGIBLE: "Diese Stelle erfüllt die Voraussetzungen für den gewählten Boost nicht mehr.",
    IMPORT_SETUP_NOT_ELIGIBLE: "Die Import-Freigabe oder der zugehörige Vertrag ist nicht mehr gültig.",
    TALENT_RADAR_REQUIRED: "Contact Packs benötigen einen aktiven Talent-Radar-Zugang.",
    FULFILLMENT_HANDLER_MISSING: "Für dieses Produkt ist noch keine sichere Auslieferung registriert.",
    IDEMPOTENCY_MISMATCH: "Diese Checkout-Anfrage passt nicht zum vorhandenen Vorgang. Lade die Seite neu.",
    PAYMENT_PROVIDER_FAILED: "Der lokale Mock-Checkout konnte nicht gestartet werden.",
  };
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: messages[code] ?? "Der Checkout konnte nicht sicher gestartet werden.",
  });
}
