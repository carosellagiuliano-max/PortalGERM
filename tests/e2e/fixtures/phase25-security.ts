import { createHash, createHmac, randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import type { DatabaseClient } from "@/lib/db/factory";
import { expect } from "@/tests/e2e/fixtures/phase17-test";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export async function enrollTotp(
  page: Page,
  securityPath: string,
  label = `Phase 25 ${randomUUID().slice(0, 8)}`,
) {
  await page.goto(securityPath);
  await expect(
    page.getByRole("heading", {
      name: /Sicherheitsfaktoren verwalten|Passkeys, TOTP und Recovery/u,
    }),
  ).toBeVisible();
  await page.getByLabel("Gerätename").fill(label);
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "TOTP registrieren" }),
  });
  await section.getByRole("button", { name: "TOTP einrichten" }).click();
  const secretElement = section.locator("code").first();
  await expect(secretElement).toBeVisible();
  const secret = (await secretElement.innerText()).trim();
  const code = currentTotp(secret);
  await section.getByLabel("Erster 6-stelliger Code").fill(code);
  await section.getByRole("button", { name: "TOTP aktivieren" }).click();
  const recovery = page.locator(
    'section[aria-labelledby="recovery-codes-heading"]',
  );
  await expect(
    recovery.getByRole("heading", {
      name: "Wiederherstellungscodes speichern",
    }),
  ).toBeVisible();
  const recoveryCodes = await recovery.locator("li").allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);
  return Object.freeze({
    code,
    label,
    recoveryCodes: Object.freeze(recoveryCodes.map((value) => value.trim())),
    secret,
  });
}

export function currentTotp(secretBase32: string, now = new Date()) {
  const secret = decodeBase32(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor(now.getTime() / 1_000 / 30)),
  );
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function createCompanyTrustCase(
  database: DatabaseClient,
  input: Readonly<{
    status: "OPEN" | "HELD";
    effectScope: readonly string[];
    assigneeUserId?: string | null;
    safeReasonCode?: string;
  }>,
) {
  const now = new Date();
  const entitySuffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const credentialTemplate = await database.user.findUniqueOrThrow({
    where: { emailNormalized: "employer@demo.ch" },
    select: {
      credential: {
        select: {
          passwordHash: true,
          algorithm: true,
          algorithmVersion: true,
          passwordChangedAt: true,
        },
      },
    },
  });
  if (credentialTemplate.credential === null) {
    throw new Error("The Phase 25 browser credential template is missing.");
  }
  const employerEmail = `phase25-trust-${entitySuffix}@example.test`;
  const employer = await database.user.create({
    data: {
      email: employerEmail,
      emailNormalized: employerEmail,
      role: "EMPLOYER",
      name: `Phase 25 Trust Owner ${entitySuffix}`,
      status: "ACTIVE",
      emailVerifiedAt: now,
      identityAssurance: "VERIFIED_EMAIL",
      credential: {
        create: {
          ...credentialTemplate.credential,
        },
      },
    },
    select: { id: true },
  });
  const [city, category] = await Promise.all([
    database.city.findFirstOrThrow({
      where: { isActive: true, canton: { isActive: true } },
      orderBy: [{ cantonId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, cantonId: true, name: true },
    }),
    database.category.findFirstOrThrow({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);
  const company = await database.company.create({
    data: {
      name: `Phase 25 Browser Trust ${entitySuffix} AG`,
      slug: `phase25-browser-trust-${entitySuffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      website: `https://phase25-${entitySuffix}.example.test`,
      about: "Isolierte Browser-Fixture für Trust-&-Safety-Verträge.",
      locations: {
        create: {
          cantonId: city.cantonId,
          cityId: city.id,
          address: "Truststrasse 25",
          postalCode: "8000",
          isPrimary: true,
        },
      },
    },
    select: { id: true, slug: true },
  });
  await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: employer.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: now,
    },
  });
  await database.companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: employer.id,
      status: "VERIFIED",
      evidenceMetadata: { fixture: "phase25-browser" },
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  const draftJob = await database.job.create({
    data: {
      companyId: company.id,
      slug: `phase25-browser-trust-job-${entitySuffix}`,
      status: "DRAFT",
      origin: "MANUAL",
      sourceReference: "phase25-browser-test",
      createdByUserId: employer.id,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true, slug: true },
  });
  const validThrough = new Date(now.getTime() + 30 * 86_400_000);
  const revision = await database.jobRevision.create({
    data: {
      jobId: draftJob.id,
      revisionNumber: 1,
      title: "Phase 25 Browser Trust Teststelle",
      description:
        "Isolierte Teststelle für reproduzierbare Trust-&-Safety-Browserverträge.",
      tasks: ["Sicherheitsverträge nachvollziehbar testen."],
      requirements: ["Erfahrung mit reproduzierbaren Systemtests."],
      applicationProcessSteps: ["Bewerbung strukturiert einreichen."],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: category.id,
      cantonId: city.cantonId,
      cityId: city.id,
      locationLabel: city.name,
      workloadMin: 80,
      workloadMax: 100,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@phase25.example.test",
      authoredByUserId: employer.id,
      contentChecksum: digest(`phase25-browser-job:${entitySuffix}`),
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  const submittedAt = new Date(now.getTime() - 2_000);
  const approvedAt = new Date(now.getTime() - 1_000);
  await database.jobRevision.update({
    where: { id: revision.id },
    data: { submittedAt },
  });
  await database.jobRevision.update({
    where: { id: revision.id },
    data: { approvedAt },
  });
  const job = await database.job.update({
    where: { id: draftJob.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revision.id,
      publishedRevisionId: revision.id,
      publishedAt: approvedAt,
      expiresAt: validThrough,
      publishedCategoryId: category.id,
      publishedCantonId: city.cantonId,
      publishedCityId: city.id,
    },
    select: { id: true, slug: true },
  });
  const signalId = randomUUID();
  const decisionId = randomUUID();
  const caseId = randomUUID();
  const suffix = randomUUID();
  const evidenceDigest = digest(`phase25-browser:${suffix}`);
  const safeReasonCode =
    input.safeReasonCode ?? "COMPANY_COMPROMISE_CONFIRMED";
  await database.riskSignal.create({
    data: {
      id: signalId,
      kind: "COMPROMISED_COMPANY",
      subjectType: "COMPANY",
      subjectId: company.id,
      companyId: company.id,
      source: "INCIDENT_CONFIRMED",
      purpose: "ACCOUNT_AND_PLATFORM_INTEGRITY",
      policyVersion: "TRUST_RISK_POLICY_V1",
      observedCount: 1,
      evidenceDigest,
      dedupeKey: `risk:phase25-browser:${suffix}`,
      occurredAt: now,
      retainUntil: new Date(now.getTime() + 180 * 86_400_000),
      createdAt: now,
    },
  });
  await database.trustRiskDecision.create({
    data: {
      id: decisionId,
      riskSignalId: signalId,
      kind: input.status === "HELD" ? "HOLD" : "REVOKE",
      reasonCode: safeReasonCode,
      policyVersion: "TRUST_RISK_POLICY_V1",
      effectScope: [...input.effectScope],
      evidenceDigest,
      decidedAt: now,
      expiresAt:
        input.status === "HELD"
          ? new Date(now.getTime() + 24 * 60 * 60_000)
          : null,
      idempotencyKey: `decision:phase25-browser:${suffix}`,
      createdAt: now,
    },
  });
  const trustCase = await database.trustSafetyCase.create({
    data: {
      id: caseId,
      riskDecisionId: decisionId,
      subjectType: "COMPANY",
      subjectId: company.id,
      companyId: company.id,
      category: "COMPROMISED_COMPANY",
      severity: "CRITICAL",
      status: input.status,
      policyVersion: "TRUST_RISK_POLICY_V1",
      safeReasonCode,
      evidenceDigest,
      dedupeKey: `case:phase25-browser:${suffix}`,
      assigneeUserId: input.assigneeUserId ?? null,
      reviewDueAt: new Date(now.getTime() + 60 * 60_000),
      holdExpiresAt:
        input.status === "HELD"
          ? new Date(now.getTime() + 24 * 60 * 60_000)
          : null,
      version: input.status === "HELD" ? 3 : 1,
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.trustSafetyCaseEvent.create({
    data: {
      trustSafetyCaseId: trustCase.id,
      kind: input.status === "HELD" ? "HELD" : "OPENED",
      actorUserId: input.assigneeUserId ?? null,
      reasonCode: safeReasonCode,
      safeNote:
        input.status === "HELD"
          ? "Die Sichtbarkeit ist während der Sicherheitsprüfung pausiert."
          : null,
      evidenceDigest,
      idempotencyKey: `event:phase25-browser:${suffix}`,
      createdAt: now,
    },
  });
  return Object.freeze({
    caseId: trustCase.id,
    companyId: company.id,
    companySlug: company.slug,
    employerEmail,
    employerUserId: employer.id,
    jobId: job.id,
    jobSlug: job.slug,
    now,
  });
}

export async function applyReversibleBrowserContainment(
  database: DatabaseClient,
  trustCase: Readonly<{
    caseId: string;
    companyId: string;
    jobId: string;
    now: Date;
  }>,
) {
  await database.company.update({
    where: { id: trustCase.companyId },
    data: { status: "SUSPENDED", updatedAt: trustCase.now },
  });
  await database.job.update({
    where: { id: trustCase.jobId },
    data: { status: "PAUSED", updatedAt: trustCase.now },
  });
  await database.trustSafetyContainmentEffect.createMany({
    data: [
      {
        id: randomUUID(),
        trustSafetyCaseId: trustCase.caseId,
        effectScope: "COMPANY_STATUS",
        targetType: "COMPANY",
        targetId: trustCase.companyId,
        previousState: "ACTIVE",
        appliedState: "SUSPENDED",
        reversible: true,
        reasonCode: "MANUAL_REVIEW_HOLD",
        idempotencyKey: `trust:${trustCase.caseId}:COMPANY_STATUS:${trustCase.companyId}`,
        appliedAt: trustCase.now,
      },
      {
        id: randomUUID(),
        trustSafetyCaseId: trustCase.caseId,
        effectScope: "PUBLIC_JOB",
        targetType: "JOB",
        targetId: trustCase.jobId,
        previousState: "PUBLISHED",
        appliedState: "PAUSED",
        reversible: true,
        reasonCode: "MANUAL_REVIEW_HOLD",
        idempotencyKey: `trust:${trustCase.caseId}:PUBLIC_JOB:${trustCase.jobId}`,
        appliedAt: trustCase.now,
      },
    ],
  });
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value.trim().replaceAll("=", "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new TypeError("Invalid Base32 TOTP secret.");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
