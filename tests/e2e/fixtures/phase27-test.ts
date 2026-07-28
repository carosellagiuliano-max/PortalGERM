import { randomUUID } from "node:crypto";

import {
  hashPassword,
  PASSWORD_HASH_POLICY_V1,
} from "@/lib/auth/password";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  phase17Database,
} from "@/tests/e2e/fixtures/phase17-test";

export const PHASE27_DUAL_ACCOUNT =
  "phase27-dual-persona@example.test" as const;

export async function ensurePhase27DualPersonaBrowserFixture() {
  const database = phase17Database();
  try {
    // The full Golden suite intentionally shares one loopback IP and reaches
    // the production LOGIN IP budget before this late-added journey. Rate
    // limiting has its own owning tests; clear only LOGIN buckets so this
    // persona contract is deterministic and cannot mask authorization errors.
    await database.rateLimitBucket.deleteMany({
      where: { namespace: { startsWith: "v1:LOGIN:" } },
    });
    const seededEmployer = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.employer },
      select: {
        companyMemberships: {
          where: {
            status: "ACTIVE",
            company: { status: { in: ["DRAFT", "ACTIVE"] } },
          },
          orderBy: { joinedAt: "asc" },
          take: 1,
          select: { companyId: true },
        },
      },
    });
    const companyId = seededEmployer.companyMemberships[0]?.companyId;
    if (companyId === undefined) {
      throw new Error("Phase 27 browser fixture requires a seeded company.");
    }
    const now = new Date();
    const existingIdentity = await database.user.findUnique({
      where: { emailNormalized: PHASE27_DUAL_ACCOUNT },
      select: { id: true, role: true, credential: { select: { id: true } } },
    });
    const dualIdentity =
      existingIdentity ??
      (await database.user.create({
        data: {
          email: PHASE27_DUAL_ACCOUNT,
          emailNormalized: PHASE27_DUAL_ACCOUNT,
          name: "Phase 27 Dual Persona",
          role: "EMPLOYER",
          status: "ACTIVE",
          dataProvenance: "TEST",
          identityAssurance: "VERIFIED_EMAIL",
          emailVerifiedAt: now,
          credential: {
            create: {
              passwordHash: await hashPassword(DEMO_PASSWORD),
              algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
              algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
              passwordChangedAt: now,
            },
          },
        },
        select: { id: true, role: true, credential: { select: { id: true } } },
      }));
    if (dualIdentity.role !== "EMPLOYER" || dualIdentity.credential === null) {
      throw new Error("Phase 27 dual-persona identity is inconsistent.");
    }
    const identity = dualIdentity;
    await database.$transaction(async (transaction) => {
      const profile = await transaction.candidateProfile.findUnique({
        where: { userId: identity.id },
        select: { id: true },
      });
      if (profile === null) {
        await transaction.candidateProfile.create({
          data: {
            userId: identity.id,
            onboardingStatus: "DRAFT",
            createdAt: now,
            updatedAt: now,
            onboardingEvents: {
              create: {
                kind: "DRAFT_CREATED",
                actorUserId: identity.id,
                reasonCode: "PHASE27_BROWSER_FIXTURE",
                correlationId: randomUUID(),
                createdAt: now,
              },
            },
          },
          select: { id: true },
        });
      }
      for (const kind of ["CANDIDATE", "EMPLOYER"] as const) {
        const assignment = await transaction.personaAssignment.findUnique({
          where: { userId_kind: { userId: identity.id, kind } },
          select: { status: true },
        });
        if (assignment !== null && assignment.status !== "ACTIVE") {
          throw new Error(`Phase 27 ${kind} persona is not active.`);
        }
        if (assignment === null) {
          await transaction.personaAssignment.create({
            data: {
              userId: identity.id,
              kind,
              status: "ACTIVE",
              source: "SUPPORT_LINK",
              version: 1,
              activatedAt: now,
              createdAt: now,
              updatedAt: now,
              events: {
                create: {
                  kind: "CREATED",
                  toStatus: "ACTIVE",
                  source: "SUPPORT_LINK",
                  actorUserId: identity.id,
                  reasonCode: "PHASE27_BROWSER_FIXTURE",
                  correlationId: randomUUID(),
                  createdAt: now,
                },
              },
            },
          });
        }
      }
      const membership = await transaction.companyMembership.findUnique({
        where: {
          companyId_userId: {
            companyId,
            userId: identity.id,
          },
        },
        select: { status: true },
      });
      if (membership !== null && membership.status !== "ACTIVE") {
        throw new Error("Phase 27 fixture membership is not active.");
      }
      if (membership === null) {
        await transaction.companyMembership.create({
          data: {
            companyId,
            userId: identity.id,
            role: "VIEWER",
            status: "ACTIVE",
            joinedAt: now,
            createdAt: now,
            updatedAt: now,
            events: {
              create: {
                kind: "CREATED",
                toRole: "VIEWER",
                actorUserId: identity.id,
                reasonCode: "PHASE27_BROWSER_FIXTURE",
                correlationId: randomUUID(),
                createdAt: now,
              },
            },
          },
        });
      }
    });
    const membershipCount = await database.companyMembership.count({
      where: {
        userId: identity.id,
        status: "ACTIVE",
        company: { status: { in: ["DRAFT", "ACTIVE"] } },
      },
    });
    if (membershipCount < 1) {
      throw new Error("Phase 27 demo employer has no active company context.");
    }
    return Object.freeze({
      employerUserId: identity.id,
      membershipCount,
    });
  } finally {
    await database.$disconnect();
  }
}
