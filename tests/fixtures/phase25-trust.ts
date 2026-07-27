import { randomUUID } from "node:crypto";

import type { TrustSafetyAdminDependencies } from "@/lib/trust-safety/case-service";
import type {
  Phase25Actor,
  Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

export async function createPhase25TrustCompany(
  fixture: Phase25SecurityFixture,
) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const canton =
    (await fixture.database.canton.findFirst({
      where: { slug: { startsWith: "phase25-trust-canton-" } },
    })) ??
    (await fixture.database.canton.create({
      data: {
        code: `T${suffix.slice(0, 1).toUpperCase()}`,
        name: `Phase 25 Trust Kanton ${suffix}`,
        slug: `phase25-trust-canton-${suffix}`,
        language: "DE",
        sortOrder: 95,
      },
    }));
  const city = await fixture.database.city.create({
    data: {
      cantonId: canton.id,
      name: `Phase 25 Trust Stadt ${suffix}`,
      slug: `phase25-trust-city-${suffix}`,
      sortOrder: 95,
    },
  });
  const company = await fixture.database.company.create({
    data: {
      name: `Phase 25 Trust ${suffix} AG`,
      slug: `phase25-trust-${suffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Isolierte Phase-25-Trust-Fixture.",
      website: "https://phase25.example",
      locations: {
        create: {
          cantonId: canton.id,
          cityId: city.id,
          isPrimary: true,
          address: "Truststrasse 25",
          postalCode: "8000",
        },
      },
    },
  });
  const membership = await fixture.database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: fixture.employer.userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: fixture.now,
    },
  });
  const verification = await fixture.database.companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: fixture.employer.userId,
      status: "VERIFIED",
      evidenceMetadata: { fixture: "phase25" },
      createdAt: fixture.now,
      updatedAt: fixture.now,
    },
  });
  await fixture.database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  const category = await fixture.database.category.create({
    data: {
      name: `Phase 25 Trust Kategorie ${suffix}`,
      slug: `phase25-trust-category-${suffix}`,
      sortOrder: 95,
    },
  });
  const job = await fixture.database.job.create({
    data: {
      companyId: company.id,
      slug: `phase25-trust-job-${suffix}`,
      status: "DRAFT",
      origin: "MANUAL",
      sourceReference: "phase25-test",
      createdByUserId: fixture.employer.userId,
      createdAt: fixture.now,
      updatedAt: fixture.now,
    },
  });
  const validThrough = new Date(fixture.now.getTime() + 30 * 86_400_000);
  const revision = await fixture.database.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: "Phase 25 Trust Teststelle",
      description:
        "Isolierte Teststelle für reproduzierbare Trust-&-Safety-Verträge.",
      tasks: ["Sicherheitsverträge nachvollziehbar testen."],
      requirements: ["Erfahrung mit reproduzierbaren Systemtests."],
      applicationProcessSteps: ["Bewerbung strukturiert einreichen."],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: category.id,
      cantonId: canton.id,
      cityId: city.id,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@phase25.example",
      authoredByUserId: fixture.employer.userId,
      contentChecksum: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      createdAt: fixture.now,
      updatedAt: fixture.now,
    },
  });
  const submittedAt = new Date(fixture.now.getTime() - 2_000);
  const approvedAt = new Date(fixture.now.getTime() - 1_000);
  await fixture.database.jobRevision.update({
    where: { id: revision.id },
    data: { submittedAt },
  });
  await fixture.database.jobRevision.update({
    where: { id: revision.id },
    data: { approvedAt },
  });
  const publishedJob = await fixture.database.job.update({
    where: { id: job.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revision.id,
      publishedRevisionId: revision.id,
      publishedAt: approvedAt,
      expiresAt: validThrough,
      publishedCategoryId: category.id,
      publishedCantonId: canton.id,
      publishedCityId: city.id,
    },
  });
  return Object.freeze({
    company: { ...company, status: "ACTIVE" as const },
    membership,
    verification,
    job: publishedJob,
  });
}

export function trustAdminDependencies(
  fixture: Phase25SecurityFixture,
  actor: Phase25Actor,
  now = fixture.now,
): TrustSafetyAdminDependencies {
  return Object.freeze({
    actor: {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      status: "ACTIVE",
      sessionId: actor.sessionId,
    },
    correlationId: randomUUID(),
    database: fixture.database,
    now,
  });
}
