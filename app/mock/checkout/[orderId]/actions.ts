"use server";

import { redirect } from "next/navigation";

import {
  getEmployerBillingActionDependencies,
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";
import { confirmMockPayment } from "@/lib/billing/orders";

const PAYMENT_FIELDS = new Set(["orderId", "idempotencyKey"]);

export async function confirmMockPaymentAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, PAYMENT_FIELDS)) return invalidState();
  const orderId = readSingleFormString(formData, "orderId");
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  if (orderId === null || idempotencyKey === null) return invalidState();
  const dependencies = await getEmployerBillingActionDependencies();
  if (dependencies === null) return deniedState();

  const result = await confirmMockPayment({ orderId, idempotencyKey }, dependencies);
  if (!result.ok) return paymentError(result.code);
  redirect(`/employer/billing/success?order=${encodeURIComponent(result.value.orderId)}`);
}

function invalidState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Der lokale Zahlungsvorgang konnte nicht eindeutig gelesen werden.",
  });
}

function deniedState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Dieser Zahlungsvorgang ist nicht verfügbar.",
  });
}

function paymentError(code: string): BillingActionState {
  const messages: Record<string, string> = {
    NOT_FOUND: "Dieser Zahlungsvorgang ist nicht verfügbar.",
    FORBIDDEN: "Dieser Zahlungsvorgang ist nicht verfügbar.",
    ORDER_EXPIRED: "Der Checkout ist abgelaufen. Starte ihn in der Billing-Übersicht neu.",
    ORDER_NOT_PENDING: "Diese Bestellung kann nicht mehr bezahlt werden.",
    IDEMPOTENCY_MISMATCH: "Die Zahlungsbestätigung passt nicht zum vorhandenen Vorgang.",
    PAYMENT_PROVIDER_FAILED: "Die lokale Mock-Zahlung konnte nicht bestätigt werden.",
  };
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: messages[code] ?? "Die Mock-Zahlung konnte nicht sicher abgeschlossen werden.",
  });
}
