import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseClient } from "@/lib/db/factory";
import {
  getCandidateRadarRequest,
  listCandidateRadarRequests,
} from "@/lib/talentradar/candidate-request-view";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-22T12:00:00.000Z");

describe("candidate Talent Radar request views", () => {
  it("scopes the list in the database query and returns only minimal evidence", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: REQUEST_ID,
        subject: "Austausch zu deinem Profil",
        messagePreview: "Wir möchten dir eine passende Rolle vorstellen.",
        status: "PENDING",
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        expiresAt: new Date("2026-08-03T12:00:00.000Z"),
        company: {
          name: "Beispiel AG",
          status: "ACTIVE",
          verificationRequests: [{ id: "verified" }],
        },
      },
    ]);
    const database = {
      employerContactRequest: { findMany },
    } as unknown as DatabaseClient;

    const result = await listCandidateRadarRequests(database, USER_ID, NOW);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          candidateProfile: {
            userId: USER_ID,
            user: { role: "CANDIDATE", status: "ACTIVE" },
          },
        },
        take: 100,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: REQUEST_ID,
        trusted: true,
        status: "PENDING",
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /firstName|lastName|email|phone|candidateProfileId|requestingUserId/u,
    );
  });

  it("uses an owner-scoped detail query and projects the half-open expiry boundary", async () => {
    const expiresAt = new Date("2026-07-22T12:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({
      id: REQUEST_ID,
      subject: "Austausch",
      messagePreview: "Ein auf 500 Zeichen begrenzter Nachrichtentext.",
      status: "PENDING",
      createdAt: new Date("2026-07-08T12:00:00.000Z"),
      expiresAt,
      company: {
        name: "Beispiel AG",
        slug: "beispiel-ag",
        status: "ACTIVE",
        verificationRequests: [{ id: "verified" }],
      },
      conversation: null,
      revealGrant: null,
    });
    const database = {
      employerContactRequest: { findFirst },
    } as unknown as DatabaseClient;

    const result = await getCandidateRadarRequest(
      database,
      USER_ID,
      REQUEST_ID,
      NOW,
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: REQUEST_ID,
          candidateProfile: {
            userId: USER_ID,
            user: { role: "CANDIDATE", status: "ACTIVE" },
          },
        },
      }),
    );
    expect(result?.status).toBe("EXPIRED");
    expect(result?.conversationId).toBeNull();
    expect(result?.reveal).toBeNull();
  });

  it("fails closed before querying for malformed ownership input", async () => {
    const findFirst = vi.fn();
    const database = {
      employerContactRequest: { findFirst },
    } as unknown as DatabaseClient;

    await expect(
      getCandidateRadarRequest(database, USER_ID, "not-a-request", NOW),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
