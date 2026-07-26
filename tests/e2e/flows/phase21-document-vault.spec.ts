import { createHash } from "node:crypto";

import type { Download, Page } from "@playwright/test";

import {
  DEMO_PASSWORD,
  expect,
  login,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[E2E-21] @journey preserves CV v1 through replacement and lets only the owning employer download it once", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    const job = await database.job.findFirstOrThrow({
      where: {
        status: "PUBLISHED",
        publishedRevision: {
          requiredDocumentKinds: { has: "CV" },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        publishedRevision: { select: { title: true } },
        company: {
          select: {
            memberships: {
              where: { status: "ACTIVE", role: "OWNER" },
              take: 1,
              select: { user: { select: { email: true } } },
            },
          },
        },
      },
    });
    const employer = job.company.memberships[0]?.user;
    if (employer === undefined) {
      throw new Error("The Phase 21 CV job has no active owner fixture.");
    }
    const candidate = await database.user.findFirstOrThrow({
      where: {
        role: "CANDIDATE",
        status: "ACTIVE",
        emailNormalized: { endsWith: "@demo.swisstalenthub.invalid" },
        candidateProfile: {
          is: {
            onboardingStatus: "COMPLETE",
            applications: { none: { jobId: job.id } },
          },
        },
      },
      orderBy: [{ emailNormalized: "asc" }],
      select: {
        id: true,
        email: true,
        candidateProfile: { select: { id: true } },
      },
    });
    const candidateProfile = candidate.candidateProfile!;
    const demoCredentials = await database.user.findMany({
      where: {
        emailNormalized: {
          in: ["candidate@demo.ch", "employer@demo.ch"],
        },
      },
      select: {
        role: true,
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
    const candidateCredential = demoCredentials.find(
      ({ role }) => role === "CANDIDATE",
    )?.credential;
    const employerCredential = demoCredentials.find(
      ({ role }) => role === "EMPLOYER",
    )?.credential;
    if (candidateCredential === null || candidateCredential === undefined) {
      throw new Error("Candidate demo credentials are unavailable.");
    }
    if (employerCredential === null || employerCredential === undefined) {
      throw new Error("Employer demo credentials are unavailable.");
    }
    await Promise.all([
      upsertCredential(database, candidate.id, candidateCredential),
      database.user
        .findUniqueOrThrow({
          where: { emailNormalized: employer.email.toLowerCase() },
          select: { id: true },
        })
        .then(({ id }) => upsertCredential(database, id, employerCredential)),
    ]);
    const v1Bytes = Buffer.from(
      "%PDF-1.4\nphase21-browser-immutable-v1\n%%EOF",
      "utf8",
    );
    const v2Bytes = Buffer.from(
      "%PDF-1.4\nphase21-browser-current-v2\n%%EOF",
      "utf8",
    );
    const v1Hash = createHash("sha256").update(v1Bytes).digest("hex");

    await login(page, candidate.email, DEMO_PASSWORD);
    await uploadCv(page, "phase21-v1.pdf", v1Bytes, "Sicher hochladen");
    const v1 = await database.documentVersion.findFirstOrThrow({
      where: {
        candidateProfileId: candidateProfile.id,
        status: "CLEAN",
      },
      orderBy: [{ sequence: "desc" }],
      select: { id: true, sha256: true },
    });
    expect(v1.sha256).toBe(v1Hash);

    await page.goto(`/jobs/${job.slug}`);
    await applyButton(page, job.slug).click();
    await expect(
      page.getByRole("heading", { name: "Bewerbung prüfen" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /phase21-v1\.pdf/u }),
    ).toBeChecked();
    await page.locator('input[name="confirmed"]').check();
    await page
      .getByRole("button", {
        name: /Schnellbewerbung senden|Bewerbung senden/u,
      })
      .click();
    await expect(page).toHaveURL(
      /\/candidate\/applications\/[0-9a-f-]+\?submitted=1/u,
    );

    const application = await database.application.findFirstOrThrow({
      where: {
        jobId: job.id,
        candidateProfileId: candidateProfile.id,
      },
      select: {
        id: true,
        submissionDocuments: {
          select: {
            documentVersionId: true,
            storageKeyHash: true,
          },
        },
      },
    });
    expect(application.submissionDocuments).toHaveLength(1);
    expect(application.submissionDocuments[0]?.documentVersionId).toBe(v1.id);
    const snapshotBefore = application.submissionDocuments[0]!;

    await uploadCv(page, "phase21-v2.pdf", v2Bytes, "CV ersetzen");
    const current = await database.document.findUniqueOrThrow({
      where: {
        candidateProfileId_purpose: {
          candidateProfileId: candidateProfile.id,
          purpose: "CV",
        },
      },
      select: {
        currentVersionId: true,
        versions: {
          orderBy: [{ sequence: "asc" }],
          select: { id: true, status: true, sha256: true },
        },
      },
    });
    expect(current.versions).toEqual([
      { id: v1.id, status: "REPLACED", sha256: v1Hash },
      {
        id: current.currentVersionId,
        status: "CLEAN",
        sha256: createHash("sha256").update(v2Bytes).digest("hex"),
      },
    ]);
    expect(
      await database.applicationSubmissionDocument.findFirstOrThrow({
        where: { applicationId: application.id },
        select: { documentVersionId: true, storageKeyHash: true },
      }),
    ).toEqual(snapshotBefore);

    const employerActor = await openActor(
      browser,
      employer.email,
      DEMO_PASSWORD,
    );
    try {
      await employerActor.page.goto(
        `/employer/applicants/${application.id}`,
      );
      await expect(
        employerActor.page.getByText("phase21-v1.pdf", { exact: false }),
      ).toBeVisible();
      await expect(
        employerActor.page.getByText("phase21-v2.pdf", { exact: false }),
      ).toHaveCount(0);
      const downloadPromise = employerActor.page.waitForEvent("download");
      await employerActor.page
        .getByRole("button", { name: "CV einmalig herunterladen" })
        .click();
      const downloaded = await downloadPromise;
      expect(await sha256Download(downloaded)).toBe(v1Hash);
      await expect(
        employerActor.page.getByText("Einmaliger Download abgeschlossen."),
      ).toBeVisible();
    } finally {
      await employerActor.close();
    }

    expect(
      await database.documentReadGrant.count({
        where: {
          applicationId: application.id,
          documentVersionId: v1.id,
          status: "CONSUMED",
        },
      }),
    ).toBe(1);
  } finally {
    await database.$disconnect();
  }
});

async function uploadCv(
  page: Page,
  name: string,
  buffer: Buffer,
  buttonName: string,
) {
  await page.goto("/candidate/jobpass");
  const fileInput = page.getByLabel(
    "CV hochladen oder ersetzen (PDF, PNG, JPEG, WebP)",
  );
  await fileInput.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer,
  });
  await page.getByRole("button", { name: buttonName }).click();
  await expect(page.locator('[data-vault-state="CLEAN"]')).toBeVisible();
  await expect(
    page.getByText("Geprüft und freigegeben", { exact: true }),
  ).toBeVisible();
}

function applyButton(page: Page, jobSlug: string) {
  return page.locator(
    `form:has(input[name="jobSlug"][value="${jobSlug}"]):has(input[name="action"][value="APPLY"]) button[type="submit"]`,
  );
}

async function sha256Download(download: Download) {
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("Browser download stream is unavailable.");
  const digest = createHash("sha256");
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

function upsertCredential(
  database: ReturnType<typeof phase17Database>,
  userId: string,
  credential: Readonly<{
    passwordHash: string;
    algorithm: string;
    algorithmVersion: number;
    passwordChangedAt: Date;
  }>,
) {
  const data = {
    ...credential,
    updatedAt: new Date(),
  };
  return database.credential.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}
