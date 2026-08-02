"use server";

import { redirect } from "next/navigation";

import {
  getEmployerBillingActionDependencies,
  hasOnlyFormFields,
  readSingleFormString,
} from "@/lib/billing/employer-action-dependencies";
import type { BillingActionState } from "@/lib/billing/employer-action-state";
import { createCheckoutOrder } from "@/lib/billing/orders";
import { getServerEnvironment } from "@/lib/config/env";
import {
  createHostedPaymentProvider,
  getHostedPaymentRuntime,
  getStripeContractEndpoint,
} from "@/lib/providers/payments/payment-composition";
import { stripePaymentConfigurationDigest } from "@/lib/providers/payments";

const REAL_CHECKOUT_FIELDS = new Set([
  "idempotencyKey",
  "orderId",
  "planSlug",
  "stepUpEvidenceId",
  "stepUpGrantToken",
]);

export async function startRealSubscriptionCheckoutAction(
  _state: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  if (!hasOnlyFormFields(formData, REAL_CHECKOUT_FIELDS)) {
    return invalidState();
  }
  const idempotencyKey = readSingleFormString(formData, "idempotencyKey");
  const orderId = readSingleFormString(formData, "orderId");
  const planSlug = readSingleFormString(formData, "planSlug");
  const stepUpEvidenceId = readSingleFormString(formData, "stepUpEvidenceId");
  const stepUpGrantToken = readSingleFormString(
    formData,
    "stepUpGrantToken",
  );
  if (
    idempotencyKey === null ||
    orderId === null ||
    stepUpEvidenceId === null ||
    (planSlug !== "starter" && planSlug !== "pro")
  ) {
    return invalidState();
  }
  const [base, environment] = await Promise.all([
    getEmployerBillingActionDependencies(true),
    Promise.resolve(getServerEnvironment()),
  ]);
  const paymentRuntime = getHostedPaymentRuntime(environment);
  const contractEndpoint = getStripeContractEndpoint(environment);
  if (
    base === null ||
    paymentRuntime === null ||
    environment.STRIPE_ACCOUNT_ID === undefined ||
    environment.STRIPE_SECRET_VERSION === undefined ||
    (paymentRuntime.adapterKey === "stripe_contract" &&
      contractEndpoint === undefined) ||
    !environment.PAID_SELF_SERVICE
  ) {
    return Object.freeze({
      status: "error",
      message:
        "Der reale Checkout ist bis zu den dokumentierten Freigaben serverseitig gesperrt.",
    });
  }
  let provider;
  try {
    provider = createHostedPaymentProvider(environment);
  } catch {
    return Object.freeze({
      status: "error",
      message: "Der freigegebene Zahlungsanbieter ist nicht verfügbar.",
    });
  }
  const result = await createCheckoutOrder(
    {
      kind: "PLAN",
      planSlug,
      paymentOrderId: orderId,
      stepUpEvidenceId,
      ...(stepUpGrantToken === null ? {} : { stepUpGrantToken }),
      idempotencyKey,
    },
    {
      ...base,
      paymentProvider: provider,
      realPayment: {
        activationMode: paymentRuntime.activationMode,
        adapterKey: paymentRuntime.adapterKey,
        adapterVersion: paymentRuntime.adapterVersion,
        appUrl: environment.APP_URL,
        configurationDigest: stripePaymentConfigurationDigest({
          ...(paymentRuntime.adapterKey === "stripe_contract"
            ? { contractEndpoint }
            : {}),
          providerAccountReference: environment.STRIPE_ACCOUNT_ID,
          runtime: paymentRuntime,
        }),
        environment: environment.APP_ENV,
        expectedLiveMode: paymentRuntime.expectedLiveMode,
        paidSelfServiceEnabled: environment.PAID_SELF_SERVICE,
        providerAccountReference: environment.STRIPE_ACCOUNT_ID,
        providerMode: paymentRuntime.providerMode,
        sandboxCohort: environment.PAYMENT_SANDBOX_COHORT,
        secretVersionRef: environment.STRIPE_SECRET_VERSION,
      },
    },
  );
  if (!result.ok) {
    return Object.freeze({
      status: result.code === "CONFLICT" ? "conflict" : "error",
      message: realCheckoutError(result.code),
    });
  }
  redirect(result.value.checkoutUrl);
}

function invalidState(): BillingActionState {
  return Object.freeze({
    status: "error",
    message: "Die zahlungsgebundene Aktion ist unvollständig.",
  });
}

function realCheckoutError(code: string) {
  const copy: Record<string, string> = {
    PAID_ACTIVATION_REQUIRED: "WTP-, Provider- oder Sandbox-Freigabe fehlt.",
    STEP_UP_REQUIRED:
      "Die frische, exakt an diesen Betrag gebundene Bestätigung fehlt oder wurde bereits benutzt.",
    PAYMENT_HELD:
      "Der Versuch wurde zur Sicherheitsprüfung angehalten. Es wurde kein neuer Checkout gestartet.",
    PAYMENT_PROVIDER_FAILED:
      "Der Anbieterstatus ist unklar. Der Vorgang bleibt zur Abstimmung gesperrt.",
    IDEMPOTENCY_MISMATCH:
      "Der Wiederholungsversuch stimmt nicht mit der ursprünglichen Bestellung überein.",
  };
  return (
    copy[code] ?? "Der reale Checkout wurde vorsichtshalber nicht gestartet."
  );
}
