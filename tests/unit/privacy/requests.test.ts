// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  addZurichCalendarDays,
  createPrivacyRequest,
  decidePrivacyCaseTransitionV1,
  getOwnedPrivacyRequestStatus,
  privacyCaseCommandSchema,
  privacyRequestInputSchema,
  PRIVACY_REQUEST_POLICY_V1,
  type PrivacyCaseActor,
  type PrivacyCaseState,
  type PrivacyRequestRepository,
  type PrivacyRequestSummary,
} from "@/lib/privacy/requests";

const requestId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const adminId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-19T10:00:00.000Z");

const exportInput = {
  type: "EXPORT",
  noticeVersion: "privacy-request-v1",
  idempotencyKey: "privacy-export-001",
} as const;
const deleteInput = {
  type: "DELETE",
  noticeVersion: "privacy-request-v1",
  idempotencyKey: "privacy-delete-001",
  deleteConfirmation: "KONTO-LÖSCHUNG BEANTRAGEN",
} as const;
const correctInput = {
  type: "CORRECT",
  noticeVersion: "privacy-request-v1",
  idempotencyKey: "privacy-correct-001",
  correctionFieldCodes: ["EMAIL", "PHONE"],
  correctionText: "Bitte korrigieren Sie diese Daten vollständig.",
} as const;

function summary(overrides: Partial<PrivacyRequestSummary> = {}): PrivacyRequestSummary {
  return {
    id: requestId,
    type: "EXPORT",
    status: "PENDING",
    dueAt: new Date("2026-08-18T10:00:00.000Z"),
    createdAt: now,
    ...overrides,
  };
}

function repository(overrides: Partial<PrivacyRequestRepository> = {}) {
  return {
    intakeAtomically: vi.fn(async ({ request, dueAt, createdAt }) => ({
      outcome: "CREATED" as const,
      request: summary({ type: request.type, dueAt, createdAt }),
    })),
    findOwned: vi.fn(async () => null),
    ...overrides,
  } satisfies PrivacyRequestRepository;
}

const owner: PrivacyCaseActor = {
  userId,
  emailVerified: true,
  capabilities: [],
};
const verifier: PrivacyCaseActor = {
  userId: adminId,
  emailVerified: true,
  capabilities: ["PRIVACY_CASE_VERIFY"],
};
const processor: PrivacyCaseActor = {
  userId: adminId,
  emailVerified: true,
  capabilities: ["PRIVACY_CASE_PROCESS"],
};

function state(overrides: Partial<PrivacyCaseState> = {}): PrivacyCaseState {
  return {
    requestId,
    requesterUserId: userId,
    requesterUserStatus: "ACTIVE",
    type: "EXPORT",
    status: "PENDING",
    version: 3,
    correctionFieldCodes: [],
    challenge: null,
    ...overrides,
  };
}

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    requesterUserId: userId,
    expiresAt: new Date(now.getTime() + 60_000),
    attempts: 1,
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function command(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    requestId,
    version: 3,
    idempotencyKey: `privacy-${action.toLowerCase()}-001`,
    ...overrides,
  };
}

describe("privacy request intake", () => {
  it("accepts only the exact three versioned request shapes", () => {
    expect(privacyRequestInputSchema.parse(exportInput)).toEqual(exportInput);
    expect(privacyRequestInputSchema.parse(deleteInput)).toEqual(deleteInput);
    expect(privacyRequestInputSchema.parse(correctInput)).toEqual(correctInput);
    expect(PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase).toBe("KONTO-LÖSCHUNG BEANTRAGEN");
  });

  it.each([
    { ...exportInput, deleteConfirmation: "KONTO-LÖSCHUNG BEANTRAGEN" },
    { ...exportInput, correctionText: "x".repeat(20) },
    { ...exportInput, userId },
    { ...exportInput, targetId: otherId },
    { ...exportInput, callbackUrl: "https://attacker.invalid" },
    { ...exportInput, attachment: "raw-data" },
    { ...exportInput, modelPath: "User.passwordHash" },
  ])("rejects extra Export authority or payload", (input) => {
    expect(() => privacyRequestInputSchema.parse(input)).toThrow();
  });

  it("requires the exact deletion phrase and no correction fields", () => {
    expect(() => privacyRequestInputSchema.parse({
      ...deleteInput,
      deleteConfirmation: "MEINE DATEN LÖSCHEN",
    })).toThrow();
    expect(() => privacyRequestInputSchema.parse({
      ...deleteInput,
      correctionFieldCodes: ["EMAIL"],
    })).toThrow();
  });

  it("enforces one to five distinct closed correction fields", () => {
    expect(() => privacyRequestInputSchema.parse({ ...correctInput, correctionFieldCodes: [] })).toThrow();
    expect(() => privacyRequestInputSchema.parse({
      ...correctInput,
      correctionFieldCodes: ["EMAIL", "PHONE", "LOCATION", "DISPLAY_NAME", "LEGAL_NAME", "CONSENT_HISTORY"],
    })).toThrow();
    expect(() => privacyRequestInputSchema.parse({ ...correctInput, correctionFieldCodes: ["EMAIL", "EMAIL"] })).toThrow();
    expect(() => privacyRequestInputSchema.parse({ ...correctInput, correctionFieldCodes: ["User.email"] })).toThrow();
  });

  it("counts Unicode code points and accepts exactly 20 through 1000 plain-text characters", () => {
    expect(privacyRequestInputSchema.parse({ ...correctInput, correctionText: "🙂".repeat(20) })).toBeTruthy();
    expect(privacyRequestInputSchema.parse({ ...correctInput, correctionText: "ä".repeat(1_000) })).toBeTruthy();
    expect(() => privacyRequestInputSchema.parse({ ...correctInput, correctionText: "🙂".repeat(19) })).toThrow();
    expect(() => privacyRequestInputSchema.parse({ ...correctInput, correctionText: "ä".repeat(1_001) })).toThrow();
    expect(() => privacyRequestInputSchema.parse({
      ...correctInput,
      correctionText: "Bitte <script>alert(1)</script> korrigieren.",
    })).toThrow();
  });

  it("requires a current notice and a bounded idempotency key", () => {
    expect(() => privacyRequestInputSchema.parse({ ...exportInput, noticeVersion: "privacy-request-v0" })).toThrow();
    expect(() => privacyRequestInputSchema.parse({ ...exportInput, idempotencyKey: "short" })).toThrow();
    expect(() => privacyRequestInputSchema.parse({ ...exportInput, unknown: true })).toThrow();
  });

  it("derives the user from an ACTIVE server actor and creates evidence atomically", async () => {
    const repo = repository();
    const result = await createPrivacyRequest(
      { userId, userStatus: "ACTIVE" },
      exportInput,
      now,
      repo,
    );
    expect(result).toMatchObject({ ok: true, created: true, requestId, type: "EXPORT", status: "PENDING" });
    expect(repo.intakeAtomically).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      request: exportInput,
      createdAt: now,
      rollingWindowStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000),
      rollingThirtyDayLimit: 5,
      maximumOpenPerType: 1,
      eventKind: "CREATED",
      auditAction: "PRIVACY_REQUEST_CREATED",
    }));
  });

  it("denies inactive actors without touching repository state", async () => {
    const repo = repository();
    expect(await createPrivacyRequest(
      { userId, userStatus: "SUSPENDED" }, exportInput, now, repo,
    )).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(repo.intakeAtomically).not.toHaveBeenCalled();
  });

  it("returns the stored case for idempotent retry before other limits", async () => {
    const existing = summary({ status: "COMPLETED" });
    const repo = repository({
      intakeAtomically: vi.fn(async () => ({
        outcome: "IDEMPOTENT_RETRY" as const,
        request: existing,
      })),
    });
    expect(await createPrivacyRequest(
      { userId, userStatus: "ACTIVE" }, exportInput, now, repo,
    )).toMatchObject({ ok: true, created: false, requestId, status: "COMPLETED" });
    expect(repo.intakeAtomically).toHaveBeenCalledOnce();
  });

  it("links semantic duplicates to the one open request", async () => {
    const existing = summary({ status: "IDENTITY_CHECK" });
    const repo = repository({
      intakeAtomically: vi.fn(async () => ({
        outcome: "OPEN_TYPE_LINKED" as const,
        request: existing,
      })),
    });
    expect(await createPrivacyRequest(
      { userId, userStatus: "ACTIVE" }, exportInput, now, repo,
    )).toMatchObject({ ok: true, created: false, requestId, status: "IDENTITY_CHECK" });
    expect(repo.intakeAtomically).toHaveBeenCalledOnce();
  });

  it("returns a typed Support path at the rolling five-case threshold", async () => {
    const repo = repository({
      intakeAtomically: vi.fn(async () => ({ outcome: "RATE_LIMITED" as const })),
    });
    expect(await createPrivacyRequest(
      { userId, userStatus: "ACTIVE" }, exportInput, now, repo,
    )).toEqual({ ok: false, code: "RATE_LIMITED", supportPath: "/candidate/support" });
    expect(repo.intakeAtomically).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      rollingWindowStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000),
      rollingThirtyDayLimit: 5,
    }));
  });

  it("funnels concurrent duplicates through the single atomic intake boundary", async () => {
    let stored: PrivacyRequestSummary | null = null;
    const repo = repository({
      intakeAtomically: vi.fn(async ({ request, dueAt, createdAt }) => {
        if (stored !== null) return { outcome: "OPEN_TYPE_LINKED" as const, request: stored };
        stored = summary({ type: request.type, dueAt, createdAt });
        return { outcome: "CREATED" as const, request: stored };
      }),
    });
    const [first, second] = await Promise.all([
      createPrivacyRequest({ userId, userStatus: "ACTIVE" }, exportInput, now, repo),
      createPrivacyRequest(
        { userId, userStatus: "ACTIVE" },
        { ...exportInput, idempotencyKey: "privacy-export-002" },
        now,
        repo,
      ),
    ]);
    expect([first, second].filter((result) => result.ok && result.created)).toHaveLength(1);
    expect([first, second].filter((result) => result.ok && !result.created)).toHaveLength(1);
    expect(repo.intakeAtomically).toHaveBeenCalledTimes(2);
  });

  it("adds 30 Zurich calendar days while preserving local time across DST", () => {
    expect(addZurichCalendarDays(
      new Date("2026-03-15T12:00:00.000Z"),
      30,
    ).toISOString()).toBe("2026-04-14T11:00:00.000Z");
    expect(addZurichCalendarDays(
      new Date("2026-10-15T11:00:00.000Z"),
      30,
    ).toISOString()).toBe("2026-11-14T12:00:00.000Z");
  });

  it("returns status only through the owner-scoped repository lookup", async () => {
    const own = summary();
    const repo = repository({ findOwned: vi.fn(async () => own) });
    expect(await getOwnedPrivacyRequestStatus(requestId, { userId }, repo)).toBe(own);
    expect(repo.findOwned).toHaveBeenCalledWith(requestId, userId);
    expect(await getOwnedPrivacyRequestStatus("foreign", { userId }, repo)).toBeNull();
  });
});

describe("privacy case workflow", () => {
  it("allows only the closed start, challenge and verification sequence", () => {
    expect(decidePrivacyCaseTransitionV1(
      state(), verifier, command("START_IDENTITY_CHECK"), now,
    )).toMatchObject({ allowed: true, fromStatus: "PENDING", toStatus: "IDENTITY_CHECK" });

    const identity = state({ status: "IDENTITY_CHECK", challenge: challenge() });
    expect(decidePrivacyCaseTransitionV1(
      identity, owner, command("COMPLETE_CHALLENGE"), now, { credentialVerified: true },
    )).toMatchObject({ allowed: true, outcome: "NO_STATUS_CHANGE", toStatus: "IDENTITY_CHECK" });

    const verified = state({
      status: "IDENTITY_CHECK",
      challenge: challenge({ verifiedAt: new Date(now.getTime() - 1) }),
    });
    expect(decidePrivacyCaseTransitionV1(
      verified, verifier, command("VERIFY_IDENTITY"), now,
    )).toMatchObject({ allowed: true, toStatus: "IN_PROGRESS" });
  });

  it("requires owner, ACTIVE/email-verified user and current unlocked challenge", () => {
    const identity = state({ status: "IDENTITY_CHECK", challenge: challenge() });
    expect(decidePrivacyCaseTransitionV1(identity, verifier, command("COMPLETE_CHALLENGE"), now, { credentialVerified: true })).toEqual({ allowed: false, reason: "OWNER_REQUIRED" });
    expect(decidePrivacyCaseTransitionV1(identity, { ...owner, emailVerified: false }, command("COMPLETE_CHALLENGE"), now, { credentialVerified: true })).toEqual({ allowed: false, reason: "USER_INELIGIBLE" });
    expect(decidePrivacyCaseTransitionV1(identity, owner, command("COMPLETE_CHALLENGE"), now, { credentialVerified: false })).toEqual({ allowed: false, reason: "CHALLENGE_UNAVAILABLE" });
    expect(privacyCaseCommandSchema.safeParse(command("COMPLETE_CHALLENGE", { credentialVerified: true })).success).toBe(false);
    expect(decidePrivacyCaseTransitionV1(
      { ...identity, challenge: challenge({ expiresAt: now }) },
      owner,
      command("COMPLETE_CHALLENGE"),
      now,
      { credentialVerified: true },
    )).toEqual({ allowed: false, reason: "CHALLENGE_UNAVAILABLE" });
    expect(decidePrivacyCaseTransitionV1(
      { ...identity, challenge: challenge({ attempts: 5 }) },
      owner,
      command("COMPLETE_CHALLENGE"),
      now,
      { credentialVerified: true },
    )).toEqual({ allowed: false, reason: "CHALLENGE_UNAVAILABLE" });
  });

  it("requires verifier capability and verified, unexpired, unconsumed matching evidence", () => {
    const verified = state({
      status: "IDENTITY_CHECK",
      challenge: challenge({ verifiedAt: new Date(now.getTime() - 1) }),
    });
    expect(decidePrivacyCaseTransitionV1(verified, processor, command("VERIFY_IDENTITY"), now)).toEqual({ allowed: false, reason: "CAPABILITY_REQUIRED" });
    for (const badChallenge of [
      challenge(),
      challenge({ verifiedAt: new Date(now.getTime() + 1) }),
      challenge({ verifiedAt: new Date(now.getTime() - 1), expiresAt: now }),
      challenge({ verifiedAt: new Date(now.getTime() - 1), consumedAt: now }),
      challenge({ verifiedAt: new Date(now.getTime() - 1), requestId: otherId }),
    ]) {
      expect(decidePrivacyCaseTransitionV1(
        { ...verified, challenge: badChallenge }, verifier, command("VERIFY_IDENTITY"), now,
      )).toEqual({ allowed: false, reason: "CHALLENGE_UNAVAILABLE" });
    }
  });

  it.each(["PENDING", "IDENTITY_CHECK"] as const)("lets only the owner cancel %s", (status) => {
    expect(decidePrivacyCaseTransitionV1(
      state({ status }), owner, command("CANCEL"), now,
    )).toMatchObject({ allowed: true, toStatus: "CANCELLED" });
    expect(decidePrivacyCaseTransitionV1(
      state({ status }), verifier, command("CANCEL"), now,
    )).toEqual({ allowed: false, reason: "OWNER_REQUIRED" });
  });

  it("completes only matching verified case types with process capability", () => {
    expect(decidePrivacyCaseTransitionV1(
      state({ status: "IN_PROGRESS", type: "EXPORT" }), processor, command("COMPLETE_EXPORT"), now,
    )).toMatchObject({ allowed: true, toStatus: "COMPLETED" });
    expect(decidePrivacyCaseTransitionV1(
      state({ status: "IN_PROGRESS", type: "DELETE" }),
      processor,
      command("COMPLETE_DELETE", {
        dependencyCodes: ["NONE"],
        outcomeCode: "ASSESSMENT_COMPLETED_NO_ERASURE",
      }),
      now,
    )).toMatchObject({ allowed: true, toStatus: "COMPLETED" });
    expect(decidePrivacyCaseTransitionV1(
      state({ status: "IN_PROGRESS", type: "CORRECT", correctionFieldCodes: ["EMAIL", "PHONE"] }),
      processor,
      command("COMPLETE_CORRECTION", {
        reviewedFieldCodes: ["EMAIL"],
        outcomeCode: "CORRECTED_VIA_CANONICAL_COMMAND",
        domainEventRefs: [otherId],
      }),
      now,
    )).toMatchObject({ allowed: true, toStatus: "COMPLETED" });
  });

  it("rejects type mismatch, fields outside intake and unsafe outcomes", () => {
    expect(decidePrivacyCaseTransitionV1(
      state({ status: "IN_PROGRESS", type: "DELETE" }), processor, command("COMPLETE_EXPORT"), now,
    )).toEqual({ allowed: false, reason: "TYPE_MISMATCH" });
    expect(decidePrivacyCaseTransitionV1(
      state({ status: "IN_PROGRESS", type: "CORRECT", correctionFieldCodes: ["EMAIL"] }),
      processor,
      command("COMPLETE_CORRECTION", {
        reviewedFieldCodes: ["PHONE"],
        outcomeCode: "NO_CHANGE_REQUIRED",
      }),
      now,
    )).toEqual({ allowed: false, reason: "OUTCOME_MISMATCH" });
    expect(privacyCaseCommandSchema.safeParse(command("COMPLETE_DELETE", {
      dependencyCodes: ["NONE", "MESSAGES"],
      outcomeCode: "ASSESSMENT_COMPLETED_NO_ERASURE",
    })).success).toBe(false);
    expect(privacyCaseCommandSchema.safeParse(command("COMPLETE_DELETE", {
      dependencyCodes: ["NONE"],
      outcomeCode: "ERASED_EVERYTHING",
    })).success).toBe(false);
    expect(privacyCaseCommandSchema.safeParse(command("COMPLETE_CORRECTION", {
      reviewedFieldCodes: ["EMAIL"],
      outcomeCode: "NO_CHANGE_REQUIRED",
      arbitraryPatch: { "User.email": "attacker@example.invalid" },
    })).success).toBe(false);
    expect(privacyCaseCommandSchema.safeParse(command("COMPLETE_CORRECTION", {
      reviewedFieldCodes: ["EMAIL"],
      outcomeCode: "CORRECTED_VIA_CANONICAL_COMMAND",
    })).success).toBe(false);
  });

  it.each(["PENDING", "IDENTITY_CHECK", "IN_PROGRESS"] as const)("allows a typed rejection from %s", (status) => {
    expect(decidePrivacyCaseTransitionV1(
      state({ status }),
      processor,
      command("REJECT", { reasonCode: "INSUFFICIENT_INFORMATION", safeNote: "No sufficient evidence." }),
      now,
    )).toMatchObject({ allowed: true, toStatus: "REJECTED" });
  });

  it("allows bounded internal notes without changing status or returning note text", () => {
    const decision = decidePrivacyCaseTransitionV1(
      state(), processor, command("ADD_NOTE", { note: "Internal operational note" }), now,
    );
    expect(decision).toMatchObject({ allowed: true, outcome: "NO_STATUS_CHANGE", toStatus: "PENDING" });
    expect(JSON.stringify(decision)).not.toContain("Internal operational note");
    expect(privacyCaseCommandSchema.safeParse(command("ADD_NOTE", { note: "<b>unsafe</b>" })).success).toBe(false);
  });

  it("fails closed for missing capability, wrong state, request mismatch and stale version", () => {
    expect(decidePrivacyCaseTransitionV1(state(), owner, command("START_IDENTITY_CHECK"), now)).toEqual({ allowed: false, reason: "CAPABILITY_REQUIRED" });
    expect(decidePrivacyCaseTransitionV1(state(), verifier, command("COMPLETE_EXPORT"), now)).toEqual({ allowed: false, reason: "CAPABILITY_REQUIRED" });
    expect(decidePrivacyCaseTransitionV1(state(), verifier, command("START_IDENTITY_CHECK", { requestId: otherId }), now)).toEqual({ allowed: false, reason: "REQUEST_MISMATCH" });
    expect(decidePrivacyCaseTransitionV1(state(), verifier, command("START_IDENTITY_CHECK", { version: 2 }), now)).toEqual({ allowed: false, reason: "STALE_VERSION" });
    expect(decidePrivacyCaseTransitionV1(state({ status: "IDENTITY_CHECK" }), verifier, command("START_IDENTITY_CHECK"), now)).toEqual({ allowed: false, reason: "INVALID_TRANSITION" });
  });

  it.each(["COMPLETED", "REJECTED", "CANCELLED"] as const)("allows no outgoing transition from %s", (status) => {
    expect(decidePrivacyCaseTransitionV1(
      state({ status }), processor, command("REJECT", { reasonCode: "DUPLICATE" }), now,
    )).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
  });

  it("returns a stored result for same-key retry and rejects key reuse for another action", () => {
    const previous = {
      action: "START_IDENTITY_CHECK" as const,
      idempotencyKey: "privacy-retry-001",
      fromStatus: "PENDING" as const,
      toStatus: "IDENTITY_CHECK" as const,
      outcome: "TRANSITION" as const,
    };
    const current = state({ status: "IDENTITY_CHECK", version: 4, lastResult: previous });
    expect(decidePrivacyCaseTransitionV1(
      current,
      verifier,
      command("START_IDENTITY_CHECK", { version: 3, idempotencyKey: previous.idempotencyKey }),
      now,
    )).toEqual({
      allowed: true,
      idempotent: true,
      action: previous.action,
      fromStatus: previous.fromStatus,
      toStatus: previous.toStatus,
      outcome: previous.outcome,
    });
    expect(decidePrivacyCaseTransitionV1(
      current,
      owner,
      command("CANCEL", { version: 4, idempotencyKey: previous.idempotencyKey }),
      now,
    )).toEqual({ allowed: false, reason: "IDEMPOTENCY_KEY_REUSED" });
  });
});
