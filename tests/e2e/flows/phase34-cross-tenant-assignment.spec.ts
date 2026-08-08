import { createHash, randomUUID } from "node:crypto";

import type { Page, Request as PlaywrightRequest } from "@playwright/test";

import {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
} from "@/lib/applications/integrity";
import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { phase34LocalSourceIp } from "@/tests/e2e/fixtures/phase34-network";

const DAY_MILLISECONDS = 86_400_000;

type Database = ReturnType<typeof phase17Database>;

type ScopedApplication = Readonly<{
  applicationId: string;
  candidateEmail: string;
  candidateFirstName: string;
  candidateLastName: string;
  companyName: string;
  coverLetter: string;
  jobId: string;
  jobTitle: string;
}>;

type AssignmentFixture = Readonly<{
  companyId: string;
  control: ScopedApplication;
  controlAssignmentId: string;
  foreignCompanyId: string;
  foreignOwnerUserId: string;
  foreignRecruiterEmail: string;
  foreignRecruiterUserId: string;
  ownerEmail: string;
  ownerUserId: string;
  recruiterEmail: string;
  recruiterMembershipId: string;
  recruiterUserId: string;
  target: ScopedApplication;
  targetAssignmentId: string;
}>;

type CapturedServerAction = Readonly<{
  body: Buffer;
  headers: Readonly<Record<string, string>>;
  path: string;
}>;

test.describe.configure({ mode: "serial" });

test("[E2E-34-14] @phase34 a recruiter assignment is tenant-bound and its real UI revoke stops the next read and write", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  const suffix = `${testInfo.project.name}-${randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)}`.toLowerCase();
  let fixture: AssignmentFixture | undefined;
  let recruiter: Awaited<ReturnType<typeof openActor>> | undefined;
  let foreignRecruiter: Awaited<ReturnType<typeof openActor>> | undefined;
  let owner: Awaited<ReturnType<typeof openActor>> | undefined;

  try {
    const sourceIp = phase34LocalSourceIp(testInfo.project.name);
    fixture = await createAssignmentFixture(database, suffix);

    recruiter = await openActor(
      browser,
      fixture.recruiterEmail,
      undefined,
      sourceIp,
    );
    const targetPath = `/employer/applicants/${fixture.target.applicationId}`;
    const allowedRead = await recruiter.page.goto(targetPath);
    expect(allowedRead?.status()).toBe(200);
    await assertApplicationIdentityVisible(recruiter.page, fixture.target);

    const allowedNoteBody = `Phase 34 erlaubte Recruiter-Notiz ${suffix}`;
    await recruiter.page
      .getByPlaceholder("Nur für berechtigte Arbeitgeber sichtbar")
      .fill(allowedNoteBody);
    const [allowedActionRequest] = await Promise.all([
      recruiter.page.waitForRequest((request) =>
        isApplicantServerAction(request, fixture!.target.applicationId),
      ),
      recruiter.page.getByRole("button", { name: "Notiz speichern" }).click(),
    ]);
    const capturedNoteAction = await captureServerAction(allowedActionRequest);
    await expect(
      recruiter.page.getByText(
        "Private Arbeitgebernotiz gespeichert. Sie wird Kandidat:innen nie angezeigt.",
        { exact: true },
      ),
    ).toBeVisible();
    await assertExactlyOneAllowedNote(database, {
      applicationId: fixture.target.applicationId,
      authorUserId: fixture.recruiterUserId,
      body: allowedNoteBody,
    });

    foreignRecruiter = await openActor(
      browser,
      fixture.foreignRecruiterEmail,
      undefined,
      sourceIp,
    );
    const beforeForeignDenial = await applicationEffectFingerprint(
      database,
      fixture.target.applicationId,
    );
    const foreignRead = await foreignRecruiter.page.goto(targetPath);
    expect(foreignRead?.status()).toBe(404);
    await assertOpaqueNotFound(foreignRecruiter.page, fixture.target);
    await expect(
      applicationEffectFingerprint(database, fixture.target.applicationId),
    ).resolves.toEqual(beforeForeignDenial);

    const foreignWrite = await replayServerAction(
      foreignRecruiter,
      capturedNoteAction,
      targetPath,
    );
    expect(foreignWrite.status()).toBe(200);
    const foreignWriteBody = await foreignWrite.text();
    expect(foreignWriteBody).toContain(
      "Bewerbungsaktion konnte nicht sicher ausgeführt werden",
    );
    assertProtectedValuesAbsent(foreignWriteBody, fixture.target);
    await expect(
      applicationEffectFingerprint(database, fixture.target.applicationId),
    ).resolves.toEqual(beforeForeignDenial);

    owner = await openActor(browser, fixture.ownerEmail, undefined, sourceIp);
    const teamPage = await owner.page.goto("/employer/team");
    expect(teamPage?.status()).toBe(200);
    await expect(
      owner.page.getByRole("heading", {
        level: 1,
        name: "Team und Job-Zuweisungen",
      }),
    ).toBeVisible();
    const revokeForm = owner.page.locator("form").filter({
      has: owner.page.locator(
        `input[name="assignmentId"][value="${fixture.targetAssignmentId}"]`,
      ),
    });
    await expect(revokeForm).toHaveCount(1);
    await revokeForm.getByRole("button", { name: "Entziehen" }).click();
    // The successful server action revalidates the list and removes this row,
    // so its row-local feedback component unmounts with it. The disappearing
    // form is the durable visible state; the DB/event assertions below prove
    // that this is a revoke rather than a rendering race.
    await expect(revokeForm).toHaveCount(0);
    await expect
      .poll(
        async () =>
          database.jobAssignment.findUnique({
            where: { id: fixture!.targetAssignmentId },
            select: { revokedAt: true, status: true },
          }),
        { timeout: 30_000 },
      )
      .toMatchObject({ revokedAt: expect.any(Date), status: "REVOKED" });
    await assertAssignmentRevocationEffects(database, fixture);

    const afterRevokeBaseline = await applicationEffectFingerprint(
      database,
      fixture.target.applicationId,
    );
    const revokedRead = await recruiter.page.goto(targetPath);
    expect(revokedRead?.status()).toBe(404);
    await assertOpaqueNotFound(recruiter.page, fixture.target);
    await expect(
      applicationEffectFingerprint(database, fixture.target.applicationId),
    ).resolves.toEqual(afterRevokeBaseline);

    const revokedWrite = await replayServerAction(
      recruiter,
      capturedNoteAction,
      targetPath,
    );
    expect(revokedWrite.status()).toBe(200);
    const revokedWriteBody = await revokedWrite.text();
    expect(revokedWriteBody).toContain(
      "Bewerbungsaktion konnte nicht sicher ausgeführt werden",
    );
    assertProtectedValuesAbsent(revokedWriteBody, fixture.target);
    await expect(
      applicationEffectFingerprint(database, fixture.target.applicationId),
    ).resolves.toEqual(afterRevokeBaseline);

    const controlPath = `/employer/applicants/${fixture.control.applicationId}`;
    const controlRead = await recruiter.page.goto(controlPath);
    expect(controlRead?.status()).toBe(200);
    await assertApplicationIdentityVisible(recruiter.page, fixture.control);
    const controlNote = `Phase 34 unabhängige Scope-Kontrolle ${suffix}`;
    await recruiter.page
      .getByPlaceholder("Nur für berechtigte Arbeitgeber sichtbar")
      .fill(controlNote);
    await recruiter.page
      .getByRole("button", { name: "Notiz speichern" })
      .click();
    await expect(
      recruiter.page.getByText(
        "Private Arbeitgebernotiz gespeichert. Sie wird Kandidat:innen nie angezeigt.",
        { exact: true },
      ),
    ).toBeVisible();
    await assertExactlyOneAllowedNote(database, {
      applicationId: fixture.control.applicationId,
      authorUserId: fixture.recruiterUserId,
      body: controlNote,
    });
    await expect(
      applicationEffectFingerprint(database, fixture.target.applicationId),
    ).resolves.toEqual(afterRevokeBaseline);
  } finally {
    try {
      await containFixture(database, suffix, fixture);
    } finally {
      const closeResults = await Promise.allSettled([
        foreignRecruiter?.close(),
        owner?.close(),
        recruiter?.close(),
      ]);
      await database.$disconnect();
      const closeFailure = closeResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (closeFailure !== undefined) throw closeFailure.reason;
    }
  }
});

async function createAssignmentFixture(
  database: Database,
  suffix: string,
): Promise<AssignmentFixture> {
  const now = new Date();
  const credential = await database.credential.findFirstOrThrow({
    where: { user: { emailNormalized: DEMO_ACCOUNTS.employer } },
    select: {
      algorithm: true,
      algorithmVersion: true,
      passwordChangedAt: true,
      passwordHash: true,
    },
  });
  const candidate = await database.candidateProfile.findFirstOrThrow({
    where: { user: { emailNormalized: DEMO_ACCOUNTS.candidate } },
    select: {
      firstName: true,
      id: true,
      lastName: true,
      user: { select: { email: true } },
    },
  });
  if (candidate.firstName === null || candidate.lastName === null) {
    throw new Error("PHASE34_ASSIGNMENT_CANDIDATE_IDENTITY_INCOMPLETE");
  }
  const template = await loadJobRevisionTemplate(database);

  const [
    ownerUser,
    recruiterUser,
    foreignOwnerUser,
    foreignRecruiterUser,
  ] = await Promise.all([
    createEmployerIdentity(database, {
      credential,
      email: `phase34-scope-owner-${suffix}@example.test`,
      name: `Phase 34 Scope Owner ${suffix}`,
      role: "EMPLOYER",
      now,
    }),
    createEmployerIdentity(database, {
      credential,
      email: `phase34-scope-recruiter-${suffix}@example.test`,
      name: `Phase 34 Scope Recruiter ${suffix}`,
      role: "RECRUITER",
      now,
    }),
    createEmployerIdentity(database, {
      credential,
      email: `phase34-scope-foreign-owner-${suffix}@example.test`,
      name: `Phase 34 Foreign Owner ${suffix}`,
      role: "EMPLOYER",
      now,
    }),
    createEmployerIdentity(database, {
      credential,
      email: `phase34-scope-foreign-${suffix}@example.test`,
      name: `Phase 34 Foreign Recruiter ${suffix}`,
      role: "RECRUITER",
      now,
    }),
  ]);

  const location = await loadCompanyLocationTemplate(database);
  const [company, foreignCompany] = await Promise.all([
    database.company.create({
      data: {
        name: `Phase 34 Scope ${suffix} AG`,
        slug: `phase34-scope-${suffix}`,
        status: "DRAFT",
        dataProvenance: "TEST",
        industry: "Technology",
        size: "11-50",
        website: `https://phase34-scope-${suffix}.example.test`,
        about: "Isolierte Firmenfixture für Job-Zuweisungsgrenzen.",
        locations: {
          create: companyLocationData(location, "Scope-Strasse 34"),
        },
      },
      select: { id: true, name: true },
    }),
    database.company.create({
      data: {
        name: `Phase 34 Foreign ${suffix} AG`,
        slug: `phase34-foreign-${suffix}`,
        status: "DRAFT",
        dataProvenance: "TEST",
        industry: "Technology",
        size: "11-50",
        website: `https://phase34-foreign-${suffix}.example.test`,
        about: "Getrennter Tenant für opake Cross-Tenant-Negativtests.",
        locations: {
          create: companyLocationData(location, "Fremd-Strasse 34"),
        },
      },
      select: { id: true },
    }),
  ]);

  await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: ownerUser.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date(now.getTime() - 3 * 60_000),
    },
  });
  const recruiterMembership = await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: recruiterUser.id,
      role: "RECRUITER",
      status: "ACTIVE",
      joinedAt: new Date(now.getTime() - 2 * 60_000),
    },
    select: { id: true },
  });
  await database.companyMembership.create({
    data: {
      companyId: foreignCompany.id,
      userId: foreignOwnerUser.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date(now.getTime() - 3 * 60_000),
    },
  });
  await database.companyMembership.create({
    data: {
      companyId: foreignCompany.id,
      userId: foreignRecruiterUser.id,
      role: "RECRUITER",
      status: "ACTIVE",
      joinedAt: new Date(now.getTime() - 2 * 60_000),
    },
  });
  await database.company.updateMany({
    where: { id: { in: [company.id, foreignCompany.id] } },
    data: { status: "ACTIVE", updatedAt: now },
  });

  const [target, control] = await Promise.all([
    createScopedApplication(database, {
      candidate: {
        email: candidate.user.email,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        profileId: candidate.id,
      },
      companyId: company.id,
      companyName: company.name,
      createdByUserId: ownerUser.id,
      label: "Ziel",
      suffix,
      template,
    }),
    createScopedApplication(database, {
      candidate: {
        email: candidate.user.email,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        profileId: candidate.id,
      },
      companyId: company.id,
      companyName: company.name,
      createdByUserId: ownerUser.id,
      label: "Kontrolle",
      suffix,
      template,
    }),
  ]);

  const [targetAssignment, controlAssignment] = await Promise.all([
    createAssignment(database, {
      companyId: company.id,
      jobId: target.jobId,
      membershipId: recruiterMembership.id,
      ownerUserId: ownerUser.id,
      recruiterUserId: recruiterUser.id,
      now,
    }),
    createAssignment(database, {
      companyId: company.id,
      jobId: control.jobId,
      membershipId: recruiterMembership.id,
      ownerUserId: ownerUser.id,
      recruiterUserId: recruiterUser.id,
      now,
    }),
  ]);

  return Object.freeze({
    companyId: company.id,
    control,
    controlAssignmentId: controlAssignment.id,
    foreignCompanyId: foreignCompany.id,
    foreignOwnerUserId: foreignOwnerUser.id,
    foreignRecruiterEmail: foreignRecruiterUser.email,
    foreignRecruiterUserId: foreignRecruiterUser.id,
    ownerEmail: ownerUser.email,
    ownerUserId: ownerUser.id,
    recruiterEmail: recruiterUser.email,
    recruiterMembershipId: recruiterMembership.id,
    recruiterUserId: recruiterUser.id,
    target,
    targetAssignmentId: targetAssignment.id,
  });
}

async function loadCompanyLocationTemplate(database: Database) {
  return database.city.findFirstOrThrow({
    where: { isActive: true, canton: { isActive: true } },
    orderBy: [{ canton: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
    select: { cantonId: true, id: true },
  });
}

function companyLocationData(
  location: Readonly<{ cantonId: string; id: string }>,
  address: string,
) {
  return {
    address,
    cantonId: location.cantonId,
    cityId: location.id,
    isPrimary: true,
    postalCode: "8000",
  } as const;
}

async function loadJobRevisionTemplate(database: Database) {
  return database.jobRevision.findFirstOrThrow({
    where: {
      job: { status: "PUBLISHED" },
      approvedAt: { not: null },
      rejectedAt: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function createEmployerIdentity(
  database: Database,
  input: Readonly<{
    credential: Readonly<{
      algorithm: string;
      algorithmVersion: number;
      passwordChangedAt: Date;
      passwordHash: string;
    }>;
    email: string;
    name: string;
    now: Date;
    role: "EMPLOYER" | "RECRUITER";
  }>,
) {
  return database.user.create({
    data: {
      email: input.email,
      emailNormalized: input.email,
      role: input.role,
      name: input.name,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: input.now,
      identityAssurance: "VERIFIED_EMAIL",
      credential: { create: input.credential },
      personaAssignments: {
        create: {
          kind: "EMPLOYER",
          status: "ACTIVE",
          source: "SUPPORT_LINK",
          version: 1,
          activatedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
          events: {
            create: {
              kind: "CREATED",
              toStatus: "ACTIVE",
              source: "SUPPORT_LINK",
              reasonCode: "PHASE34_ASSIGNMENT_E2E",
              correlationId: `phase34-assignment-${randomUUID()}`,
              createdAt: input.now,
            },
          },
        },
      },
    },
    select: { email: true, id: true },
  });
}

async function createScopedApplication(
  database: Database,
  input: Readonly<{
    candidate: Readonly<{
      email: string;
      firstName: string;
      lastName: string;
      profileId: string;
    }>;
    companyId: string;
    companyName: string;
    createdByUserId: string;
    label: "Ziel" | "Kontrolle";
    suffix: string;
    template: Awaited<ReturnType<typeof loadJobRevisionTemplate>>;
  }>,
): Promise<ScopedApplication> {
  const now = new Date();
  const jobId = randomUUID();
  const revisionId = randomUUID();
  const applicationId = randomUUID();
  const slug = `phase34-scope-${input.label.toLowerCase()}-${input.suffix}`;
  const title = `Phase 34 Scope ${input.label} ${input.suffix}`;
  const candidateFirstName = input.candidate.firstName;
  const candidateLastName = input.candidate.lastName;
  const candidateEmail = input.candidate.email;
  const coverLetter = `Vertrauliche Bewerbung ${input.label} ${input.suffix}`;
  const validThrough = new Date(now.getTime() + 30 * DAY_MILLISECONDS);
  const confirmation = buildApplicationConfirmationProjection({
    candidate: {
      firstName: candidateFirstName,
      lastName: candidateLastName,
      email: candidateEmail,
    },
    recipient: {
      companyName: input.companyName,
      contactKind: "EMAIL",
      contactValue: `jobs-${input.suffix}@example.test`,
    },
    job: {
      revisionId,
      slug,
      title,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      requiredDocumentKinds: ["NONE"],
    },
  });
  const submissionPayloadHash = applicationSubmissionPayloadHash({
    confirmationSnapshotHash: confirmation.confirmationSnapshotHash,
    coverLetter,
    selectedDocumentIds: [],
  });

  await database.$transaction(async (transaction) => {
    await transaction.job.create({
      data: {
        id: jobId,
        companyId: input.companyId,
        slug,
        status: "DRAFT",
        origin: "MANUAL",
        sourceReference: `phase34-assignment-${input.label.toLowerCase()}`,
        version: 1,
        dataProvenance: "TEST",
        createdByUserId: input.createdByUserId,
        createdAt: new Date(now.getTime() - 5 * 60_000),
      },
    });
    await transaction.jobRevision.create({
      data: {
        id: revisionId,
        jobId,
        revisionNumber: 1,
        contentLanguage: input.template.contentLanguage,
        title,
        companyIntro: input.template.companyIntro,
        description: input.template.description,
        tasks: input.template.tasks,
        requirements: input.template.requirements,
        niceToHave: input.template.niceToHave,
        offer: input.template.offer,
        applicationProcessSteps: ["Bewerbung sicher übermitteln."],
        requiredDocumentKinds: ["NONE"],
        jobType: input.template.jobType,
        remoteType: input.template.remoteType,
        remoteCountryCode: input.template.remoteCountryCode,
        categoryId: input.template.categoryId,
        cantonId: input.template.cantonId,
        cityId: input.template.cityId,
        locationLabel: input.template.locationLabel,
        workloadMin: input.template.workloadMin,
        workloadMax: input.template.workloadMax,
        salaryPeriod: input.template.salaryPeriod,
        salaryMin: input.template.salaryMin,
        salaryMax: input.template.salaryMax,
        startDate: input.template.startDate,
        startByArrangement: input.template.startByArrangement,
        validThrough,
        responseTargetDays: 7,
        applicationEffort: "SIMPLE",
        inclusionStatement: input.template.inclusionStatement,
        applicationContactKind: "EMAIL",
        applicationContactValue: `jobs-${input.suffix}@example.test`,
        authoredByUserId: input.createdByUserId,
        contentChecksum: createHash("sha256")
          .update(`phase34-assignment:${revisionId}`, "utf8")
          .digest("hex"),
        version: 1,
        submittedAt: new Date(now.getTime() - 4 * 60_000),
        approvedAt: new Date(now.getTime() - 3 * 60_000),
        createdAt: new Date(now.getTime() - 5 * 60_000),
      },
    });
    await transaction.job.update({
      where: { id: jobId },
      data: {
        currentRevisionId: revisionId,
        publishedRevisionId: revisionId,
        expiresAt: validThrough,
        publishedCategoryId: input.template.categoryId,
        publishedCantonId: input.template.cantonId,
        publishedCityId: input.template.cityId,
        publishedSalaryPeriod: input.template.salaryPeriod,
        publishedSalaryMin: input.template.salaryMin,
        publishedSalaryMax: input.template.salaryMax,
      },
    });
    await transaction.job.update({
      where: { id: jobId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(now.getTime() - 2 * 60_000),
      },
    });
    await transaction.application.create({
      data: {
        id: applicationId,
        jobId,
        submittedJobRevisionId: revisionId,
        candidateProfileId: input.candidate.profileId,
        idempotencyKey: `phase34-assignment-application-${applicationId}`,
        submissionPayloadHash,
        submissionPayloadHashVersion: "application-submission-payload-v1",
        status: "SUBMITTED",
        coverLetter,
        submittedAt: now,
      },
    });
    await transaction.applicationSubmissionSnapshot.create({
      data: {
        applicationId,
        jobRevisionId: revisionId,
        candidateFirstName,
        candidateLastName,
        candidateEmail,
        coverLetterSnapshot: coverLetter,
        recipientCompanyName: input.companyName,
        applicationContactKind: "EMAIL",
        applicationContactValue: `jobs-${input.suffix}@example.test`,
        responseTargetDays: 7,
        applicationEffort: "SIMPLE",
        requiredDocumentKinds: ["NONE"],
        confirmationNoticeVersion: confirmation.confirmationVersion,
        confirmationNoticeHash: confirmation.confirmationNoticeHash,
        confirmationSnapshotHash: confirmation.confirmationSnapshotHash,
        confirmationSnapshotHashVersion: "application-confirmation-snapshot-v1",
        submittedAt: now,
      },
    });
    await transaction.applicationEvent.create({
      data: {
        applicationId,
        actorUserId: null,
        kind: "STATUS_CHANGE",
        fromStatus: null,
        toStatus: "SUBMITTED",
        idempotencyKey: `phase34-assignment-submitted-${applicationId}`,
        correlationId: `phase34-assignment-${applicationId}`,
        metadata: { source: "phase34-assignment-e2e" },
        createdAt: now,
      },
    });
  });

  return Object.freeze({
    applicationId,
    candidateEmail,
    candidateFirstName,
    candidateLastName,
    companyName: input.companyName,
    coverLetter,
    jobId,
    jobTitle: title,
  });
}

async function createAssignment(
  database: Database,
  input: Readonly<{
    companyId: string;
    jobId: string;
    membershipId: string;
    now: Date;
    ownerUserId: string;
    recruiterUserId: string;
  }>,
) {
  const assignment = await database.jobAssignment.create({
    data: {
      membershipId: input.membershipId,
      companyId: input.companyId,
      jobId: input.jobId,
      userId: input.recruiterUserId,
      role: "PIPELINE",
      status: "ACTIVE",
      assignedByUserId: input.ownerUserId,
      validFrom: new Date(input.now.getTime() - 60_000),
      expiresAt: new Date(input.now.getTime() + DAY_MILLISECONDS),
      createdAt: input.now,
      events: {
        create: {
          kind: "ASSIGNED",
          toRole: "PIPELINE",
          actorUserId: input.ownerUserId,
          reasonCode: "PHASE34_ASSIGNMENT_E2E",
          correlationId: `phase34-assignment-${randomUUID()}`,
          createdAt: input.now,
        },
      },
    },
    select: { id: true },
  });
  return assignment;
}

async function assertApplicationIdentityVisible(
  page: Page,
  application: ScopedApplication,
) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${application.candidateFirstName} ${application.candidateLastName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(application.candidateEmail, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(application.coverLetter, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(application.jobTitle, { exact: true }),
  ).toBeVisible();
}

async function assertOpaqueNotFound(
  page: Page,
  application: ScopedApplication,
) {
  await expect(
    page.getByRole("heading", { name: "Diese Seite ist nicht verfügbar." }),
  ).toBeVisible();
  const body = await page.locator("body").innerText();
  assertProtectedValuesAbsent(body, application);
}

function assertProtectedValuesAbsent(
  body: string,
  application: ScopedApplication,
) {
  for (const protectedValue of [
    application.candidateFirstName,
    application.candidateLastName,
    application.candidateEmail,
    application.companyName,
    application.coverLetter,
    application.jobTitle,
  ]) {
    expect(body).not.toContain(protectedValue);
  }
}

async function assertExactlyOneAllowedNote(
  database: Database,
  input: Readonly<{
    applicationId: string;
    authorUserId: string;
    body: string;
  }>,
) {
  const note = await database.applicationEmployerNote.findFirstOrThrow({
    where: {
      applicationId: input.applicationId,
      authorUserId: input.authorUserId,
      body: input.body,
    },
    select: { id: true },
  });
  const [eventCount, auditCount] = await Promise.all([
    database.applicationEvent.count({
      where: {
        applicationId: input.applicationId,
        actorUserId: input.authorUserId,
        kind: "EMPLOYER_NOTE_ADDED",
        metadata: { path: ["employerNoteId"], equals: note.id },
      },
    }),
    database.auditLog.count({
      where: {
        action: "APPLICATION_EMPLOYER_NOTE_ADDED",
        actorUserId: input.authorUserId,
        capability: "COMPANY_APPLICATION_NOTE",
        targetId: input.applicationId,
        result: "SUCCEEDED",
      },
    }),
  ]);
  expect({ auditCount, eventCount }).toEqual({ auditCount: 1, eventCount: 1 });
}

async function assertAssignmentRevocationEffects(
  database: Database,
  fixture: AssignmentFixture,
) {
  const [revokeEvents, revokeAudits, notifications, controlAssignment] =
    await Promise.all([
      database.jobAssignmentEvent.count({
        where: {
          jobAssignmentId: fixture.targetAssignmentId,
          kind: "REVOKED",
          actorUserId: fixture.ownerUserId,
        },
      }),
      database.auditLog.count({
        where: {
          action: "JOB_ASSIGNMENT_REVOKED",
          actorUserId: fixture.ownerUserId,
          capability: "COMPANY_JOB_ASSIGN_REVOKE",
          companyId: fixture.companyId,
          targetId: fixture.targetAssignmentId,
          result: "SUCCEEDED",
        },
      }),
      database.notification.count({
        where: {
          recipientUserId: fixture.recruiterUserId,
          kind: "TEAM_MEMBERSHIP_CHANGED",
          payload: {
            path: ["membershipId"],
            equals: fixture.recruiterMembershipId,
          },
        },
      }),
      database.jobAssignment.findUniqueOrThrow({
        where: { id: fixture.controlAssignmentId },
        select: { revokedAt: true, status: true },
      }),
    ]);
  expect({ notifications, revokeAudits, revokeEvents }).toEqual({
    notifications: 1,
    revokeAudits: 1,
    revokeEvents: 1,
  });
  expect(controlAssignment).toEqual({ revokedAt: null, status: "ACTIVE" });
}

async function applicationEffectFingerprint(
  database: Database,
  applicationId: string,
) {
  const application = await database.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: {
      coverLetter: true,
      rejectionReason: true,
      status: true,
      updatedAt: true,
    },
  });
  const [
    notes,
    events,
    conversation,
    messages,
    notifications,
    outbox,
    audits,
    readGrants,
    accessEvents,
  ] = await Promise.all([
    database.applicationEmployerNote.findMany({
      where: { applicationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { authorUserId: true, body: true, id: true },
    }),
    database.applicationEvent.findMany({
      where: { applicationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { actorUserId: true, id: true, kind: true, toStatus: true },
    }),
    database.conversation.findUnique({
      where: { applicationId },
      select: { id: true, updatedAt: true },
    }),
    database.message.findMany({
      where: { conversation: { applicationId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { body: true, id: true, senderUserId: true },
    }),
    database.notification.findMany({
      where: { payload: { path: ["applicationId"], equals: applicationId } },
      orderBy: { id: "asc" },
      select: { id: true, kind: true },
    }),
    database.notificationOutbox.findMany({
      where: { payload: { path: ["applicationId"], equals: applicationId } },
      orderBy: { id: "asc" },
      select: { id: true, status: true },
    }),
    database.auditLog.findMany({
      where: { targetId: applicationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, actorUserId: true, id: true, result: true },
    }),
    database.documentReadGrant.findMany({
      where: { applicationId },
      orderBy: { id: "asc" },
      select: { actorUserId: true, id: true, status: true },
    }),
    database.documentAccessEvent.findMany({
      where: { applicationId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { actorUserId: true, id: true, kind: true, outcomeCode: true },
    }),
  ]);
  return Object.freeze({
    accessEvents,
    application,
    audits,
    conversation,
    events,
    messages,
    notes,
    notifications,
    outbox,
    readGrants,
  });
}

function isApplicantServerAction(
  request: PlaywrightRequest,
  applicationId: string,
) {
  return (
    request.method() === "POST" &&
    request.headers()["next-action"] !== undefined &&
    new URL(request.url()).pathname === `/employer/applicants/${applicationId}`
  );
}

async function captureServerAction(
  request: PlaywrightRequest,
): Promise<CapturedServerAction> {
  const body = request.postDataBuffer();
  if (body === null || body.byteLength === 0) {
    throw new Error("The genuine application Server Action body is missing.");
  }
  const url = new URL(request.url());
  return Object.freeze({
    body,
    headers: Object.freeze(await request.allHeaders()),
    path: `${url.pathname}${url.search}`,
  });
}

async function replayServerAction(
  actor: Awaited<ReturnType<typeof openActor>>,
  captured: CapturedServerAction,
  refererPath: string,
) {
  const baseUrl = requiredEnvironment("PHASE17_BASE_URL");
  const origin = new URL(baseUrl).origin;
  const headers: Record<string, string> = {
    origin,
    referer: `${origin}${refererPath}`,
  };
  for (const name of [
    "accept",
    "content-type",
    "next-action",
    "next-router-state-tree",
    "next-url",
  ]) {
    const value = captured.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return actor.context.request.post(`${baseUrl}${captured.path}`, {
    data: captured.body,
    failOnStatusCode: false,
    headers,
    maxRedirects: 0,
  });
}

async function containFixture(
  database: Database,
  suffix: string,
  fixture: AssignmentFixture | undefined,
) {
  const now = new Date();
  const [discoveredCompanies, discoveredUsers] = await Promise.all([
    database.company.findMany({
      where: {
        dataProvenance: "TEST",
        slug: { contains: suffix },
      },
      select: { id: true },
    }),
    database.user.findMany({
      where: {
        dataProvenance: "TEST",
        emailNormalized: { contains: suffix },
      },
      select: { id: true },
    }),
  ]);
  const companyIds = [
    ...new Set([
      ...discoveredCompanies.map(({ id }) => id),
      ...(fixture === undefined
        ? []
        : [fixture.companyId, fixture.foreignCompanyId]),
    ]),
  ];
  const userIds = [
    ...new Set([
      ...discoveredUsers.map(({ id }) => id),
      ...(fixture === undefined
        ? []
        : [
            fixture.ownerUserId,
            fixture.recruiterUserId,
            fixture.foreignOwnerUserId,
            fixture.foreignRecruiterUserId,
          ]),
    ]),
  ];
  const jobs = await database.job.findMany({
    where: {
      OR: [
        { companyId: { in: companyIds } },
        { dataProvenance: "TEST", slug: { contains: suffix } },
      ],
    },
    select: { id: true },
  });
  const jobIds = jobs.map(({ id }) => id);
  await database.$transaction(async (transaction) => {
    await transaction.jobAssignment.updateMany({
      where: {
        OR: [
          { companyId: { in: companyIds } },
          { jobId: { in: jobIds } },
          { userId: { in: userIds } },
        ],
        status: "ACTIVE",
      },
      data: { revokedAt: now, status: "REVOKED", updatedAt: now },
    });
    await transaction.job.updateMany({
      where: { id: { in: jobIds } },
      data: { status: "PAUSED", updatedAt: now },
    });
    await transaction.company.updateMany({
      where: { id: { in: companyIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
    await transaction.user.updateMany({
      where: { id: { in: userIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for Phase 34 assignment E2E.`);
  }
  return value;
}
