import { describe, expect, it } from "vitest";

import {
  digestNotificationReconciliationIdentifier,
  notificationOutcomeReconciliationAuditMetadataSchema,
  notificationOutcomeReconciliationInputSchema,
  notificationOutcomeReconciliationStepUpAction,
} from "@/lib/notifications/outcome-reconciliation-policy";

const BASE = Object.freeze({
  evidenceDigest: "a".repeat(64),
  evidenceReference: "incident:INC-3301",
  idempotencyKey: "33000000-0000-4000-8000-000000000001",
  outboxId: "33000000-0000-4000-8000-000000000002",
  reasonCode: "PROVIDER_OUTCOME_REVIEWED",
  stepUpEvidenceId: "33000000-0000-4000-8000-000000000003",
  stepUpGrantToken: "grant-token-that-is-at-least-thirty-two-characters",
});

describe("notification outcome reconciliation policy", () => {
  it("requires accepted evidence to carry a provider receipt and forbids it for other resolutions", () => {
    expect(
      notificationOutcomeReconciliationInputSchema.safeParse({
        ...BASE,
        resolution: "ACCEPTED",
      }).success,
    ).toBe(false);
    expect(
      notificationOutcomeReconciliationInputSchema.safeParse({
        ...BASE,
        resolution: "ACCEPTED",
        providerReceipt: "receipt_phase33_accepted",
      }).success,
    ).toBe(true);
    expect(
      notificationOutcomeReconciliationInputSchema.safeParse({
        ...BASE,
        resolution: "DEFINITIVELY_NOT_ACCEPTED",
        providerReceipt: "receipt_not_allowed",
      }).success,
    ).toBe(false);
    expect(
      notificationOutcomeReconciliationInputSchema.safeParse({
        ...BASE,
        resolution: "UNKNOWN",
      }).success,
    ).toBe(true);
  });

  it("binds every resolution to a distinct action and rejects unsafe evidence references", () => {
    expect(notificationOutcomeReconciliationStepUpAction("ACCEPTED")).toBe(
      "NOTIFICATION_OUTCOME_RECONCILE:ACCEPTED",
    );
    expect(
      notificationOutcomeReconciliationStepUpAction(
        "DEFINITIVELY_NOT_ACCEPTED",
      ),
    ).toBe("NOTIFICATION_OUTCOME_RECONCILE:DEFINITIVELY_NOT_ACCEPTED");
    expect(notificationOutcomeReconciliationStepUpAction("UNKNOWN")).toBe(
      "NOTIFICATION_OUTCOME_RECONCILE:UNKNOWN",
    );
    expect(
      notificationOutcomeReconciliationInputSchema.safeParse({
        ...BASE,
        evidenceReference: "<script>alert(1)</script>",
        resolution: "UNKNOWN",
      }).success,
    ).toBe(false);
  });

  it("keeps audit evidence non-reversible and strict", () => {
    const effectDigest = digestNotificationReconciliationIdentifier(
      "sth-provider-effect-raw",
    );
    expect(effectDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(effectDigest).not.toContain("provider-effect-raw");
    const metadata = {
      contract: "NOTIFICATION_OUTCOME_RECONCILIATION_V1",
      evidenceDigest: "b".repeat(64),
      evidenceReference: "provider-case:CASE-3302",
      idempotencyKey: BASE.idempotencyKey,
      providerActivationId: "33000000-0000-4000-8000-000000000004",
      providerClass: "resend-live-v1",
      providerDedupeKeyDigest: effectDigest,
      providerReceiptDigest: "c".repeat(64),
      providerRequestDigest: "d".repeat(64),
      resolution: "ACCEPTED",
      stepUpEvidenceDigest: "e".repeat(64),
      stepUpGrantDigest: "f".repeat(64),
    } as const;
    expect(
      notificationOutcomeReconciliationAuditMetadataSchema.safeParse(metadata)
        .success,
    ).toBe(true);
    expect(
      notificationOutcomeReconciliationAuditMetadataSchema.safeParse({
        ...metadata,
        recipient: "pii@example.test",
      }).success,
    ).toBe(false);
  });
});
