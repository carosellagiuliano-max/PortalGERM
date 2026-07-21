import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  redirect: vi.fn(),
  requireEmployerPage: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireEmployerPage: mocks.requireEmployerPage,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));

import {
  addClaimEvidenceAction,
  cancelClaimAction,
} from "@/app/employer/company/claim-pending/actions";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T14:00:00.000Z");
const IDLE = Object.freeze({ status: "idle" as const, message: "" });
const IDS = Object.freeze({
  correlation: "7a100000-0000-4000-8000-000000000005",
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The claim-pending integration database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase_10_claim_pending_actions");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthRequestContext.mockResolvedValue({
    correlationId: IDS.correlation,
    expectedOrigin: "http://claim-actions.test",
    origin: "http://claim-actions.test",
    production: false,
    sourceIp: "192.0.2.80",
    userAgent: "Phase-10 claim action integration test",
  });
  mocks.isValidAuthMutationOrigin.mockReturnValue(true);
  mocks.getDatabase.mockImplementation(() => client());
  mocks.redirect.mockImplementation((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-10 claim-pending server-action PostgreSQL contracts", () => {
  it("adds bounded evidence only to the authenticated user's open claim", async () => {
    const actor = await createEmployerActor("evidence-own");
    const otherActor = await createEmployerActor("evidence-foreign");
    useActor(actor);
    const companyId = await createCandidateCompany("evidence-own");
    const otherCompanyId = await createCandidateCompany("evidence-foreign");
    const claim = await createClaim(actor.id, companyId, "NEEDS_EVIDENCE");
    const foreignClaim = await createClaim(
      otherActor.id,
      otherCompanyId,
      "PENDING",
    );
    const evidence =
      "Handelsregisterauszug und Nachweis meiner Vertretungsberechtigung liegen vor.";
    const formData = new FormData();
    formData.set("evidence", evidence);

    await expect(addClaimEvidenceAction(IDLE, formData)).resolves.toEqual({
      status: "success",
      message: "Nachweis sicher ergänzt.",
    });

    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/employer/company/claim-pending",
    );
    expect(
      await client().companyClaimRequest.findUniqueOrThrow({
        where: { id: claim.id },
        select: { evidenceSummary: true, status: true },
      }),
    ).toEqual({ evidenceSummary: evidence, status: "NEEDS_EVIDENCE" });
    expect(
      await client().companyClaimRequest.findUniqueOrThrow({
        where: { id: foreignClaim.id },
        select: { evidenceSummary: true, status: true },
      }),
    ).toEqual({ evidenceSummary: null, status: "PENDING" });
    expect(
      await client().companyClaimEvent.findMany({
        where: { claimRequestId: claim.id },
        select: {
          actorUserId: true,
          correlationId: true,
          evidenceRef: true,
          kind: true,
        },
      }),
    ).toEqual([
      {
        actorUserId: actor.id,
        correlationId: IDS.correlation,
        evidenceRef: "claim-evidence-summary-v1",
        kind: "EVIDENCE_ADDED",
      },
    ]);
    expect(
      await client().auditLog.findMany({
        where: { targetId: claim.id },
        select: {
          action: true,
          actorUserId: true,
          capability: true,
          companyId: true,
          correlationId: true,
          result: true,
        },
      }),
    ).toEqual([
      {
        action: "COMPANY_CLAIM_EVIDENCE_ADDED",
        actorUserId: actor.id,
        capability: "COMPANY_CLAIM_EVIDENCE",
        companyId,
        correlationId: IDS.correlation,
        result: "SUCCEEDED",
      },
    ]);
  });

  it("rejects unsafe, invalid and terminal evidence writes without side effects", async () => {
    const actor = await createEmployerActor("terminal-evidence");
    useActor(actor);
    const companyId = await createCandidateCompany("terminal-evidence");
    const openClaim = await createClaim(actor.id, companyId, "PENDING");
    const tooShort = new FormData();
    tooShort.set("evidence", "zu kurz");

    expect(await addClaimEvidenceAction(IDLE, tooShort)).toMatchObject({
      status: "error",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);
    const validEvidence = new FormData();
    validEvidence.set(
      "evidence",
      "Dieser formal ausreichende Nachweis darf bei fremder Origin nicht gespeichert werden.",
    );
    expect(await addClaimEvidenceAction(IDLE, validEvidence)).toMatchObject({
      status: "error",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    await client().companyClaimRequest.update({
      where: { id: openClaim.id },
      data: { status: "REJECTED" },
    });
    expect(await addClaimEvidenceAction(IDLE, validEvidence)).toEqual({
      status: "error",
      message: "Der Anspruch ist nicht mehr offen.",
    });

    expect(
      await client().companyClaimRequest.findUniqueOrThrow({
        where: { id: openClaim.id },
        select: { evidenceSummary: true, status: true },
      }),
    ).toEqual({ evidenceSummary: null, status: "REJECTED" });
    expect(
      await client().companyClaimEvent.count({
        where: { claimRequestId: openClaim.id },
      }),
    ).toBe(0);
    expect(
      await client().auditLog.count({ where: { targetId: openClaim.id } }),
    ).toBe(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("cancels exactly one open claim atomically and makes replay terminal", async () => {
    const actor = await createEmployerActor("cancel-own");
    const otherActor = await createEmployerActor("cancel-foreign");
    useActor(actor);
    const companyId = await createCandidateCompany("cancel-own");
    const otherCompanyId = await createCandidateCompany("cancel-foreign");
    const claim = await createClaim(actor.id, companyId, "PENDING");
    const foreignClaim = await createClaim(
      otherActor.id,
      otherCompanyId,
      "NEEDS_EVIDENCE",
    );

    await expect(cancelClaimAction(IDLE, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/employer/dashboard?claim=cancelled",
    );
    expect(
      await client().companyClaimRequest.findUniqueOrThrow({
        where: { id: claim.id },
        select: { status: true },
      }),
    ).toEqual({ status: "CANCELLED" });
    expect(
      await client().companyClaimRequest.findUniqueOrThrow({
        where: { id: foreignClaim.id },
        select: { status: true },
      }),
    ).toEqual({ status: "NEEDS_EVIDENCE" });
    expect(
      await client().companyClaimEvent.findMany({
        where: { claimRequestId: claim.id },
        select: {
          actorUserId: true,
          correlationId: true,
          kind: true,
          reasonCode: true,
        },
      }),
    ).toEqual([
      {
        actorUserId: actor.id,
        correlationId: IDS.correlation,
        kind: "CANCELLED",
        reasonCode: "REQUESTER_CANCELLED",
      },
    ]);
    expect(
      await client().auditLog.findMany({
        where: { targetId: claim.id },
        select: {
          action: true,
          capability: true,
          companyId: true,
          reasonCode: true,
          result: true,
        },
      }),
    ).toEqual([
      {
        action: "COMPANY_CLAIM_CANCELLED",
        capability: "COMPANY_CLAIM_CANCEL",
        companyId,
        reasonCode: "REQUESTER_CANCELLED",
        result: "SUCCEEDED",
      },
    ]);

    await expect(cancelClaimAction(IDLE, new FormData())).resolves.toEqual({
      status: "error",
      message: "Der Anspruch ist nicht mehr offen.",
    });
    expect(
      await client().companyClaimEvent.count({
        where: { claimRequestId: claim.id, kind: "CANCELLED" },
      }),
    ).toBe(1);
    expect(
      await client().auditLog.count({
        where: { targetId: claim.id, action: "COMPANY_CLAIM_CANCELLED" },
      }),
    ).toBe(1);
  });
});

async function createEmployerActor(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  return client().user.create({
    data: {
      email,
      emailNormalized: email,
      name: `Claim Actor ${label}`,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      createdAt: NOW,
    },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
}

function useActor(actor: Awaited<ReturnType<typeof createEmployerActor>>) {
  mocks.requireEmployerPage.mockResolvedValue(actor);
}

async function createCandidateCompany(label: string): Promise<string> {
  const company = await client().company.create({
    data: {
      name: `Claim Candidate ${label}`,
      slug: `claim-candidate-${label}-${randomUUID()}`,
      values: [],
      benefits: [],
      status: "DRAFT",
      dataProvenance: "TEST",
      createdAt: NOW,
    },
    select: { id: true },
  });
  return company.id;
}

async function createClaim(
  requesterEmployerUserId: string,
  candidateCompanyId: string,
  status: "NEEDS_EVIDENCE" | "PENDING",
) {
  return client().companyClaimRequest.create({
    data: {
      requesterEmployerUserId,
      candidateCompanyId,
      requestedRole: "OWNER",
      matchSignals: { source: "PHASE_10_ACTION_INTEGRATION" },
      status,
      idempotencyKey: `claim-action:${randomUUID()}`,
      createdAt: NOW,
    },
    select: { id: true },
  });
}
