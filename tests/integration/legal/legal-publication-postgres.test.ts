import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminDependencies } from "@/lib/admin/common";
import { resolveRegistrationLegalGate } from "@/lib/auth/registration-legal-gate";
import {
  createLegalDraft,
  getCurrentLegalPublication,
  publishLegalRevision,
  reviewLegalRevision,
  revokeLegalPublication,
} from "@/lib/legal/publication-service";
import type { DatabaseClient } from "@/lib/db/factory";
import { getAdminLegalControlPlane } from "@/lib/legal/admin-read";
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
  it("denies Legal control-plane reads without ADMIN_LEGAL_READ", async () => {
    const { client, users } = requireFixture();
    const base = dependencies(client, users.legalAuthor);
    await expect(
      getAdminLegalControlPlane({
        ...base,
        actor: { ...base.actor, capabilities: [] },
      }),
    ).resolves.toBeNull();
    await expect(
      getAdminLegalControlPlane({
        ...base,
        actor: { ...base.actor, capabilities: ["ADMIN_LEGAL_READ"] },
      }),
    ).resolves.toMatchObject({
      documents: expect.any(Array),
      approvals: expect.any(Array),
      inventory: expect.any(Array),
    });
  });

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

  it("keeps public registration closed until both exact legal publications are current", async () => {
    const { client, users } = requireFixture();
    const environment = {
      APP_ENV: "preview",
      LEGAL_PUBLICATION_TERMS: true,
      LEGAL_PUBLICATION_PRIVACY: true,
    } as never;

    await expect(
      resolveRegistrationLegalGate(environment, client, PHASE22_NOW),
    ).resolves.toMatchObject({
      allowed: false,
      code: "PUBLICATION_UNAVAILABLE",
    });

    const termsId = await publishDocument(client, users, {
      type: "TERMS",
      slug: "terms",
      title: "Nutzungsbedingungen Phase 22",
      versionLabel: "2026.08-terms",
    });
    const privacyId = await publishDocument(client, users, {
      type: "PRIVACY",
      slug: "privacy",
      title: "Datenschutz Phase 22",
      versionLabel: "2026.08-privacy",
    });

    const decision = await resolveRegistrationLegalGate(
      environment,
      client,
      PHASE22_NOW,
    );
    expect(decision).toMatchObject({
      allowed: true,
      mode: "PUBLISHED_LEGAL",
      binding: {
        policyVersion: "registration-publication-v1",
        terms: {
          publicationId: termsId,
          versionLabel: "2026.08-terms",
        },
        privacy: {
          publicationId: privacyId,
          versionLabel: "2026.08-privacy",
        },
      },
    });

    await expect(
      revokeLegalPublication(
        {
          publicationId: termsId,
          reasonCode: "REGISTRATION_GATE_TEST",
        },
        dependencies(client, users.legalPublisher),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      resolveRegistrationLegalGate(environment, client, PHASE22_NOW),
    ).resolves.toMatchObject({
      allowed: false,
      code: "PUBLICATION_UNAVAILABLE",
    });
  });
});

async function publishDocument(
  client: DatabaseClient,
  users: Phase22Actors,
  input: Readonly<{
    type: "TERMS" | "PRIVACY";
    slug: "terms" | "privacy";
    title: string;
    versionLabel: string;
  }>,
) {
  const draft = await createLegalDraft(
    {
      ...input,
      locale: "de-CH",
      contentMarkdown:
        "# " +
        input.title +
        "\n\nDiese fachlich getrennt geprüfte Testfassung bindet die öffentliche Registrierung an eine konkrete Version und ihren unveränderbaren Inhaltshash.",
      changeSummary: "Registration publication gate integration test",
      requiresReconsent: true,
    },
    dependencies(client, users.legalAuthor),
  );
  if (!draft.ok) throw new Error("Could not create " + input.type + " draft.");
  const reviewed = await reviewLegalRevision(
    {
      revisionId: draft.value.revisionId,
      approve: true,
      reasonCode: "INDEPENDENT_REGISTRATION_REVIEW",
    },
    dependencies(client, users.legalReviewer),
  );
  if (!reviewed.ok) throw new Error("Could not review " + input.type + " draft.");
  const published = await publishLegalRevision(
    {
      revisionId: draft.value.revisionId,
      effectiveAt: new Date(PHASE22_NOW.getTime() - 1),
      expiresAt: null,
      reasonCode: "REGISTRATION_GATE_PUBLICATION",
    },
    dependencies(client, users.legalPublisher),
  );
  if (!published.ok) {
    throw new Error("Could not publish " + input.type + " draft.");
  }
  return published.value.publicationId;
}

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
      capabilities: [
        "ADMIN_LEGAL_DRAFT",
        "ADMIN_LEGAL_REVIEW",
        "ADMIN_LEGAL_PUBLISH",
      ] as const,
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
