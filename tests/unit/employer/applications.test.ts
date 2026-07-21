import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getEmployerApplicationDetail,
  isMatchingEmployerNoteReplay,
  isMatchingEmployerStatusReplay,
  isQualifyingEmployerResponseStatus,
  listEmployerApplications,
  normalizeEmployerApplicationFilter,
  transitionEmployerApplication,
} from "@/lib/employer/applications";
import type { DatabaseClient } from "@/lib/db/factory";

describe("Phase 10 employer application filters", () => {
  it("keeps only closed statuses, UUID job scope and bounded search text", () => {
    expect(normalizeEmployerApplicationFilter({
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      status: "INTERVIEW",
      query: "  Ada Lovelace  ",
    })).toEqual({
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      status: "INTERVIEW",
      query: "Ada Lovelace",
    });
    expect(normalizeEmployerApplicationFilter({
      jobId: "other-company-job",
      status: "AUTO_REJECTED",
      query: " ",
    })).toEqual({ jobId: undefined, status: undefined, query: undefined });
  });

  it("recognizes only candidate-visible human status responses", () => {
    expect(isQualifyingEmployerResponseStatus("IN_REVIEW")).toBe(false);
    expect(([
      "SHORTLISTED",
      "INTERVIEW",
      "OFFER",
      "HIRED",
      "REJECTED",
    ] as const).every(isQualifyingEmployerResponseStatus)).toBe(true);
  });

  it("binds a status idempotency replay to application, target and reason", () => {
    const replay = {
      applicationId: "550e8400-e29b-41d4-a716-446655440000",
      toStatus: "REJECTED" as const,
      metadata: { reasonCode: "NOT_A_MATCH" },
    };
    const input = {
      applicationId: replay.applicationId,
      nextStatus: "REJECTED" as const,
      rejectionReason: "NOT_A_MATCH",
    };

    expect(isMatchingEmployerStatusReplay(replay, input)).toBe(true);
    expect(isMatchingEmployerStatusReplay(replay, {
      ...input,
      nextStatus: "SHORTLISTED",
    })).toBe(false);
    expect(isMatchingEmployerStatusReplay(replay, {
      ...input,
      rejectionReason: "POSITION_FILLED",
    })).toBe(false);
    expect(isMatchingEmployerStatusReplay(replay, {
      ...input,
      applicationId: "650e8400-e29b-41d4-a716-446655440000",
    })).toBe(false);
  });

  it("requires rejection reasons exactly for rejected target statuses", async () => {
    const transaction = vi.fn();
    const dependencies = {
      database: { $transaction: transaction },
    } as unknown as Parameters<typeof transitionEmployerApplication>[2];
    const access = {
      companyId: "550e8400-e29b-41d4-a716-446655440000",
      membershipId: "650e8400-e29b-41d4-a716-446655440000",
      userId: "750e8400-e29b-41d4-a716-446655440000",
      membershipRole: "OWNER" as const,
    };
    const base = {
      applicationId: "850e8400-e29b-41d4-a716-446655440000",
      idempotencyKey: "phase10-status-reason-shape",
    };

    await expect(transitionEmployerApplication(access, {
      ...base,
      nextStatus: "REJECTED",
    }, dependencies)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(transitionEmployerApplication(access, {
      ...base,
      nextStatus: "IN_REVIEW",
      rejectionReason: "NOT_A_MATCH",
    }, dependencies)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("binds a private-note replay to the referenced persisted note body", () => {
    const applicationId = "550e8400-e29b-41d4-a716-446655440000";
    const companyId = "650e8400-e29b-41d4-a716-446655440000";
    const note = {
      id: "750e8400-e29b-41d4-a716-446655440000",
      applicationId,
      companyId,
      body: "Nur intern sichtbar.",
    };
    const replay = {
      applicationId,
      metadata: {
        employerNoteId: note.id,
        payloadBindingVersion: "employer-note-v1",
      },
    };
    const input = { applicationId, companyId, body: note.body };

    expect(isMatchingEmployerNoteReplay(replay, note, input)).toBe(true);
    expect(isMatchingEmployerNoteReplay(replay, note, {
      ...input,
      body: "Veränderter Inhalt.",
    })).toBe(false);
    expect(isMatchingEmployerNoteReplay({
      ...replay,
      metadata: { employerNoteId: "850e8400-e29b-41d4-a716-446655440000" },
    }, note, input)).toBe(false);
  });

  it("bounds pipeline and detail relations with deterministic ordering", async () => {
    const applicationFindMany = vi.fn(async (_query: unknown) => []);
    const jobFindMany = vi.fn(async (_query: unknown) => []);
    const applicationFindFirst = vi.fn(async (_query: unknown) => null);
    const database = {
      application: {
        findMany: applicationFindMany,
        findFirst: applicationFindFirst,
      },
      job: { findMany: jobFindMany },
    } as unknown as DatabaseClient;
    const access = {
      companyId: "550e8400-e29b-41d4-a716-446655440000",
      membershipId: "650e8400-e29b-41d4-a716-446655440000",
      userId: "750e8400-e29b-41d4-a716-446655440000",
      membershipRole: "OWNER" as const,
    };

    await listEmployerApplications(
      access,
      database,
      normalizeEmployerApplicationFilter({}),
      new Date("2026-07-21T14:00:00.000Z"),
    );
    await getEmployerApplicationDetail(
      "850e8400-e29b-41d4-a716-446655440000",
      access,
      database,
      new Date("2026-07-21T14:00:00.000Z"),
    );

    expect(applicationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
    }));
    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
    }));
    const detailQuery = applicationFindFirst.mock.calls[0]?.[0] as {
      select?: unknown;
    } | undefined;
    expect(detailQuery?.select).toMatchObject({
      submissionDocuments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 50,
      },
      employerNotes: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      },
      conversation: {
        select: {
          messages: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 200,
          },
        },
      },
    });
  });
});
