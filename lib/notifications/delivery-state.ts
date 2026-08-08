import type { ServerEnvironment } from "@/lib/config/env-schema";

type DeliveryEnvironment = Pick<
  ServerEnvironment,
  | "EMAIL_PROVIDER_MODE"
  | "ENABLE_LOCAL_MOCK_MAILBOX"
  | "NOTIFICATION_DISPATCH"
  | "NOTIFICATION_OUTBOX_PRODUCERS"
>;

export type TransactionalEmailDeliveryState =
  | "external_dispatch"
  | "local_mailbox"
  | "local_mailbox_queued"
  | "queued_paused"
  | "record_only";

export function getTransactionalEmailDeliveryState(
  environment: DeliveryEnvironment,
): TransactionalEmailDeliveryState {
  if (environment.NOTIFICATION_OUTBOX_PRODUCERS) {
    if (environment.NOTIFICATION_DISPATCH !== "command") {
      return "queued_paused";
    }
    if (
      environment.EMAIL_PROVIDER_MODE === "resend_sandbox" ||
      environment.EMAIL_PROVIDER_MODE === "resend_live"
    ) {
      return "external_dispatch";
    }
    if (
      environment.EMAIL_PROVIDER_MODE === "local_mock" &&
      environment.ENABLE_LOCAL_MOCK_MAILBOX
    ) {
      return "local_mailbox_queued";
    }
    return "record_only";
  }
  return environment.EMAIL_PROVIDER_MODE === "local_mock" &&
    environment.ENABLE_LOCAL_MOCK_MAILBOX
    ? "local_mailbox"
    : "record_only";
}

export function getInvitationDeliveryFeedback(input: Readonly<{
  deliveryState: TransactionalEmailDeliveryState;
  emailRecorded: boolean;
  operation: "created" | "resent";
}>) {
  const prefix = input.operation === "created"
    ? "Einladung gespeichert."
    : "Ein neuer Link wurde gespeichert; der alte Link ist ungültig.";
  if (!input.emailRecorded) {
    return `${prefix} Die E-Mail konnte nicht für den Versand erfasst werden. Nutze „Neu senden“, sobald der Versand verfügbar ist.`;
  }
  const suffix: Readonly<Record<TransactionalEmailDeliveryState, string>> = {
    external_dispatch:
      "Die E-Mail wurde in die aktive Warteschlange für den konfigurierten Versanddienst aufgenommen. Übergabe und endgültige Zustellung sind damit noch nicht bestätigt.",
    local_mailbox:
      "Der Link wurde für die geschützte lokale Test-Mailbox erfasst; es wird keine echte E-Mail versendet.",
    local_mailbox_queued:
      "Der Link wurde für die geschützte lokale Test-Mailbox vorgemerkt; erst eine erfolgreiche Worker-Verarbeitung bestätigt die Erfassung. Es wird keine echte E-Mail versendet.",
    queued_paused:
      "Die E-Mail liegt in der Versandwarteschlange, der Versand ist in dieser Umgebung aber derzeit pausiert.",
    record_only:
      "In dieser Umgebung ist kein erreichbarer E-Mail-Versand aktiv. Nutze „Neu senden“, sobald der Versand eingerichtet ist.",
  };
  return `${prefix} ${suffix[input.deliveryState]}`;
}

export function getPasswordResetDeliveryFeedback(
  deliveryState: TransactionalEmailDeliveryState,
): Readonly<{ status: "success" | "unavailable"; message: string }> {
  if (deliveryState === "external_dispatch") {
    return Object.freeze({
      status: "success",
      message:
        "Falls ein passendes Konto existiert, wurde ein Zurücksetzlink in die aktive Warteschlange für den konfigurierten Versanddienst aufgenommen. Übergabe und Zustellung sind damit noch nicht bestätigt.",
    });
  }
  if (
    deliveryState === "local_mailbox" ||
    deliveryState === "local_mailbox_queued"
  ) {
    return Object.freeze({
      status: "success",
      message:
        deliveryState === "local_mailbox"
          ? "Falls ein passendes Konto existiert, wurde der Zurücksetzlink in der geschützten lokalen Test-Mailbox erfasst. Es wurde keine echte E-Mail versendet."
          : "Falls ein passendes Konto existiert, wurde der Zurücksetzlink für die geschützte lokale Test-Mailbox vorgemerkt. Erst eine erfolgreiche Worker-Verarbeitung bestätigt die Erfassung; es wird keine echte E-Mail versendet.",
    });
  }
  return Object.freeze({
    status: "unavailable",
    message:
      deliveryState === "queued_paused"
        ? "Die Anfrage wurde sicher verarbeitet. Der E-Mail-Versand ist in dieser Umgebung derzeit pausiert; ein Zurücksetzlink kann deshalb noch nicht zugestellt werden."
        : "Die Anfrage wurde sicher verarbeitet. In dieser Umgebung ist kein erreichbarer E-Mail-Versand aktiv; ein Zurücksetzlink kann deshalb nicht zugestellt werden.",
  });
}
