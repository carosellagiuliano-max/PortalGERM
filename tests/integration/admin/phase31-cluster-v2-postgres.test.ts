import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  createPhase31Fixture,
  PHASE31_ADMIN_OPS,
  PHASE31_ADMIN_PRODUCT,
  PHASE31_NOW,
  phase31Digest,
  seedActivatedClusterAssessment,
  type Phase31Fixture,
} from "@/tests/fixtures/phase31-commercial";

describe.sequential("Phase 31 first-cluster PostgreSQL boundary", () => {
  let fixture: Phase31Fixture | undefined;
  let database: DatabaseClient;
  let selectedDecisionId = "";

  beforeAll(async () => {
    fixture = await createPhase31Fixture("phase31_cluster_v2");
    database = fixture.database;
  }, 600_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("rejects a selected corpus digest that is not bound to Phase 30 evidence", async () => {
    const cluster = await seedActivatedClusterAssessment(database, "mismatch");
    await expect(
      database.commercialClusterDecision.create({
        data: {
          id: randomUUID(),
          assessmentId: cluster.assessmentId,
          clusterCode: "ZG_PFLEGE",
          status: "SELECTED",
          policyVersion: "phase31-v1",
          selectedCorpusDigest: phase31Digest("another-corpus"),
          evidenceDigest: phase31Digest("mismatched-decision"),
          productApprovedByUserId: PHASE31_ADMIN_PRODUCT,
          opsApprovedByUserId: PHASE31_ADMIN_OPS,
          decidedAt: PHASE31_NOW,
        },
      }),
    ).rejects.toThrow("Phase 31 first-cluster evidence is incomplete");
  });

  it("accepts one current, expert-reviewed V2 assessment", async () => {
    const cluster = await seedActivatedClusterAssessment(database, "selected");
    const decision = await database.commercialClusterDecision.create({
      data: {
        id: randomUUID(),
        assessmentId: cluster.assessmentId,
        clusterCode: "ZG_PFLEGE",
        status: "SELECTED",
        policyVersion: "phase31-v1",
        selectedCorpusDigest: cluster.corpusDigest,
        evidenceDigest: phase31Digest("selected-decision"),
        productApprovedByUserId: PHASE31_ADMIN_PRODUCT,
        opsApprovedByUserId: PHASE31_ADMIN_OPS,
        decidedAt: PHASE31_NOW,
      },
    });
    selectedDecisionId = decision.id;
    await expect(
      database.commercialClusterDecision.count({
        where: { status: { in: ["SELECTED", "PUBLIC_ACTIVE"] } },
      }),
    ).resolves.toBe(1);
  });

  it("blocks a parallel second selection at the database race boundary", async () => {
    const cluster = await seedActivatedClusterAssessment(database, "parallel");
    const attempt = () =>
      database.commercialClusterDecision.create({
        data: {
          id: randomUUID(),
          assessmentId: cluster.assessmentId,
          clusterCode: "ZH_ENGINEERING",
          status: "SELECTED",
          policyVersion: "phase31-v1",
          selectedCorpusDigest: cluster.corpusDigest,
          evidenceDigest: phase31Digest(`parallel:${randomUUID()}`),
          productApprovedByUserId: PHASE31_ADMIN_PRODUCT,
          opsApprovedByUserId: PHASE31_ADMIN_OPS,
          decidedAt: PHASE31_NOW,
        },
      });
    const [left, right] = await Promise.allSettled([attempt(), attempt()]);
    expect([left, right].filter((result) => result.status === "rejected")).toHaveLength(2);
    await expect(
      database.commercialClusterDecision.count({
        where: { status: { in: ["SELECTED", "PUBLIC_ACTIVE"] } },
      }),
    ).resolves.toBe(1);
  });

  it("keeps the decision evidence append-only", async () => {
    await expect(
      database.commercialClusterDecision.update({
        where: { id: selectedDecisionId },
        data: { clusterCode: "MUTATED" },
      }),
    ).rejects.toThrow("append-only");
  });
});
