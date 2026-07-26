import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminDependencies } from "@/lib/admin/common";
import {
  createLegalDraft,
  getCurrentLegalPublication,
  publishLegalRevision,
  reviewLegalRevision,
  revokeLegalPublication,
} from "@/lib/legal/publication-service";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  createPhase22Harness,
  PHASE22_NOW,
  seedPhase22Actors,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_legal_publication");
  actors = await seedPhase22Actors(harness.client, "legal");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 legal publication workflow", () => {
  it("enforces author, reviewer and publisher separation and exposes only the exact current revision", async () => {
    const { client, users } = requireFixture();
    const draft = await createLegalDraft(
      {
        type: "PRIVACY",
        locale: "de-CH",
        title: "Datenschutz Phase 22",
        slug: "privacy",
        versionLabel: "2026.07-v1",
        contentMarkdown:
          "# Datenschutz\n\nDiese geprüfte Testfassung beschreibt Zweck, Rechte, Aufbewahrung und Kontakt für den technischen Vertrag der isolierten Phase-22-Prüfung.",
        changeSummary: "Phase-22-Testfassung",
        requiresReconsent: true,
      },
      dependencies(client, users.legalAuthor),
    );
    expect(draft).toMatchObject({ ok: true });
    if (!draft.ok) throw new Error("Legal draft was not created.");

    await expect(
      reviewLegalRevision(
        {
          revisionId: draft.value.revisionId,
          approve: true,
          reasonCode: "AUTHOR_SELF_REVIEW",
        },
        dependencies(client, users.legalAuthor),
      ),
    ).resolves.toEqual({ ok: false, code: "RESTRICTED" });

    await expect(
      reviewLegalRevision(
        {
          revisionId: draft.value.revisionId,
          approve: true,
          reasonCode: "INDEPENDENT_LEGAL_REVIEW",
        },
        dependencies(client, users.legalReviewer),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { revisionId: draft.value.revisionId, status: "APPROVED" },
    });

    await expect(
      publishLegalRevision(
        {
          revisionId: draft.value.revisionId,
          effectiveAt: new Date(PHASE22_NOW.getTime() - 1),
          expiresAt: null,
          reasonCode: "REVIEWER_SELF_PUBLISH",
        },
        dependencies(client, users.legalReviewer),
      ),
    ).resolves.toEqual({ ok: false, code: "RESTRICTED" });

    const published = await publishLegalRevision(
      {
        revisionId: draft.value.revisionId,
        effectiveAt: new Date(PHASE22_NOW.getTime() - 1),
        expiresAt: null,
        reasonCode: "THIRD_ACTOR_PUBLICATION",
      },
      dependencies(client, users.legalPublisher),
    );
    expect(published).toMatchObject({ ok: true });
    if (!published.ok) throw new Error("Legal revision was not published.");

    const current = await getCurrentLegalPublication(
      "privacy",
      client,
      PHASE22_NOW,
    );
    expect(current).toMatchObject({
      publicationId: published.value.publicationId,
      documentType: "PRIVACY",
      slug: "privacy",
      versionLabel: "2026.07-v1",
      requiresReconsent: true,
    });
    expect(current?.publicationHash).toBe(current?.contentHash);

    const auditActions = await client.auditLog.findMany({
      where: {
        action: {
          in: ["LEGAL_REVISION_REVIEWED", "LEGAL_PUBLICATION_PUBLISHED"],
        },
      },
      select: { action: true, actorUserId: true },
      orderBy: { createdAt: "asc" },
    });
    expect(auditActions).toEqual([
      {
        action: "LEGAL_REVISION_REVIEWED",
        actorUserId: users.legalReviewer.id,
      },
      {
        action: "LEGAL_PUBLICATION_PUBLISHED",
        actorUserId: users.legalPublisher.id,
      },
    ]);

    await expect(
      revokeLegalPublication(
        {
          publicationId: published.value.publicationId,
          reasonCode: "TEST_WITHDRAWAL",
        },
        dependencies(client, users.legalPublisher),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      getCurrentLegalPublication("privacy", client, PHASE22_NOW),
    ).resolves.toBeNull();
  });
});

function dependencies(
  database: DatabaseClient,
  actor: Phase22Actors[keyof Phase22Actors],
): AdminDependencies {
  return {
    database,
    actor: {
      userId: actor.id,
      email: actor.email,
      role: actor.role,
      status: actor.status,
    },
    correlationId: randomUUID(),
    now: PHASE22_NOW,
  };
}

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 legal fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
