import { describe, expect, it } from "vitest";

import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const completeActivation = {
  environment: "staging",
  useCase: "email.transactional",
  adapterKey: "resend_sandbox",
  adapterVersion: "v1",
  mode: "SANDBOX" as const,
  configurationDigest: "a".repeat(64),
  secretVersionRef: "kms:email:v1",
  region: "ch",
  dpaRef: "dpa:test-approved",
  contractRef: "contract:test-approved",
  approvalRef: "approval:test-approved",
  evidenceDigest: "b".repeat(64),
  owner: "Communications",
  runbookRef: "runbook:email",
  health: "HEALTHY" as const,
  healthCheckedAt: NOW,
  quotaUnits: 1_000,
  sustainableCapacity: 500,
  unitCostMicros: 2_000n,
  unitCostSource: "fixture:contract",
  killSwitchEngaged: false,
  effectiveAt: new Date(NOW.getTime() - 1_000),
  expiresAt: new Date(NOW.getTime() + 60_000),
  revokedAt: null,
};

describe("Phase-23 provider activation policy", () => {
  it("activates only the exact complete healthy sandbox use case", () => {
    expect(
      resolveProviderActivation({
        activation: completeActivation,
        adapterKey: "resend_sandbox",
        adapterVersion: "v1",
        environment: "staging",
        useCase: "email.transactional",
        now: NOW,
      }),
    ).toEqual({
      active: true,
      adapterKey: "resend_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX",
    });
  });

  it.each([
    ["secretVersionRef", null, "INCOMPLETE_EVIDENCE"],
    ["dpaRef", null, "INCOMPLETE_EVIDENCE"],
    ["region", null, "INCOMPLETE_EVIDENCE"],
    ["approvalRef", null, "INCOMPLETE_EVIDENCE"],
    ["runbookRef", "", "INCOMPLETE_EVIDENCE"],
    ["killSwitchEngaged", true, "KILL_SWITCH"],
    ["revokedAt", NOW, "REVOKED"],
    ["health", "UNHEALTHY", "UNHEALTHY"],
  ] as const)("fails closed when %s is invalid", (key, value, reason) => {
    expect(
      resolveProviderActivation({
        activation: { ...completeActivation, [key]: value },
        adapterKey: "resend_sandbox",
        adapterVersion: "v1",
        environment: "staging",
        useCase: "email.transactional",
        now: NOW,
      }),
    ).toEqual({ active: false, reason });
  });

  it("never treats another use case or a sandbox row in production as authority", () => {
    expect(
      resolveProviderActivation({
        activation: completeActivation,
        adapterKey: "resend_sandbox",
        adapterVersion: "v1",
        environment: "staging",
        useCase: "email.job-alert",
        now: NOW,
      }),
    ).toEqual({ active: false, reason: "LEDGER_SCOPE_MISMATCH" });
    expect(
      resolveProviderActivation({
        activation: { ...completeActivation, environment: "production" },
        adapterKey: "resend_sandbox",
        adapterVersion: "v1",
        environment: "production",
        useCase: "email.transactional",
        now: NOW,
      }),
    ).toEqual({
      active: false,
      reason: "ENVIRONMENT_MODE_FORBIDDEN",
    });
  });

  it.each([
    [
      { expectedMode: "LIVE" as const },
      "ACTIVATION_MODE_MISMATCH",
    ],
    [
      { expectedConfigurationDigest: "c".repeat(64) },
      "CONFIGURATION_MISMATCH",
    ],
    [
      { expectedSecretVersionRef: "kms:email:v2" },
      "SECRET_VERSION_MISMATCH",
    ],
  ])("binds runtime authority to the expected provider evidence", (expected, reason) => {
    expect(
      resolveProviderActivation({
        activation: completeActivation,
        adapterKey: "resend_sandbox",
        adapterVersion: "v1",
        environment: "staging",
        useCase: "email.transactional",
        now: NOW,
        ...expected,
      }),
    ).toEqual({ active: false, reason });
  });
});
