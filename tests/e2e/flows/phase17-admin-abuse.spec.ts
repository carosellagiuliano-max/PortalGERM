import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const REPORT_JOB_SLUG = "zh-engineering-demo-049";
const REPORT_DESCRIPTION =
  "Phase-17-Prüfpfad: Dieses verdächtige Angebot verlangt Geld vor einem Bewerbungsgespräch und soll sofort geprüft werden.";
const TRIAGE_NOTE =
  "Phase-17-Prüfpfad: Scam-Hinweis geprüft und dem Admin zugewiesen.";
const HOSTILE_SOURCE_ITEM_KEY = "phase17-e2e-06-hostile-unlicensed";
const HOSTILE_APPLICATION_URL =
  "not a valid URL <script>alert(1)</script>";
const ADMIN_ACTION_SUCCEEDED = "Aktion wurde sicher verarbeitet.";

test("[E2E-06] @journey public abuse and hostile import reach controlled Admin decisions", async ({
  browser,
}) => {
  const database = phase17Database();
  let candidate: Awaited<ReturnType<typeof openActor>> | undefined;
  let admin: Awaited<ReturnType<typeof openActor>> | undefined;

  try {
    const [job, candidateUser, adminUser, importSource] = await Promise.all([
      database.job.findUniqueOrThrow({
        where: { slug: REPORT_JOB_SLUG },
        select: {
          id: true,
          slug: true,
          status: true,
          publishedRevision: { select: { title: true } },
        },
      }),
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.candidate },
        select: { id: true, name: true, email: true },
      }),
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.admin },
        select: { id: true },
      }),
      database.importSource.findFirstOrThrow({
        where: {
          sourceReference: "local-demo-feed-v1",
          format: "JSON",
          isActive: true,
        },
        select: { id: true, name: true },
      }),
    ]);
    expect(job.status).toBe("PUBLISHED");
    expect(job.publishedRevision).not.toBeNull();
    expect(
      await database.moderationRestriction.count({
        where: {
          targetType: "HIDE_JOB",
          targetId: job.id,
          status: "ACTIVE",
        },
      }),
    ).toBe(0);
    expect(
      await database.abuseReport.count({
        where: {
          targetType: "JOB",
          targetId: job.id,
          description: REPORT_DESCRIPTION,
        },
      }),
    ).toBe(0);

    candidate = await openActor(browser, DEMO_ACCOUNTS.candidate);
    await candidate.page.goto(`/jobs/${job.slug}`);
    await expect(
      candidate.page.getByRole("heading", {
        level: 1,
        name: job.publishedRevision!.title,
      }),
    ).toBeVisible();
    await candidate.page
      .getByText("Inhalt melden", { exact: true })
      .click();
    await candidate.page.getByLabel("Grund").selectOption("SCAM_OR_FRAUD");
    await candidate.page
      .getByLabel("Beschreibung")
      .fill(REPORT_DESCRIPTION);
    await candidate.page
      .getByRole("button", { name: "Meldung absenden" })
      .click();
    await expect(
      candidate.page.getByText(
        "Danke. Deine Meldung wurde sicher erfasst und wird geprüft.",
        { exact: true },
      ),
    ).toBeVisible();

    const report = await database.abuseReport.findFirstOrThrow({
      where: {
        targetType: "JOB",
        targetId: job.id,
        reporterUserId: candidateUser.id,
        description: REPORT_DESCRIPTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        severity: true,
        reasonCode: true,
        version: true,
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            kind: true,
            actorUserId: true,
            reasonCode: true,
            safeNote: true,
          },
        },
      },
    });
    expect(report).toMatchObject({
      status: "OPEN",
      severity: "HIGH",
      reasonCode: "SCAM_OR_FRAUD",
      version: 1,
    });
    expect(report.events).toEqual([
      expect.objectContaining({
        kind: "CREATED",
        actorUserId: candidateUser.id,
        reasonCode: "PUBLIC_INTAKE",
      }),
    ]);
    await expect(
      database.auditLog.count({
        where: {
          action: "ABUSE_REPORT_SUBMITTED",
          targetType: "ABUSE_REPORT",
          targetId: report.id,
          actorUserId: candidateUser.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);

    admin = await openActor(browser, DEMO_ACCOUNTS.admin);
    await admin.page.goto("/admin/reports?status=OPEN&target=JOB");
    const reportLink = admin.page.locator(
      `a[href="/admin/reports/${report.id}"]`,
    );
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await expect(admin.page).toHaveURL(`/admin/reports/${report.id}`);
    await expect(
      admin.page.getByRole("heading", { level: 1, name: "SCAM_OR_FRAUD" }),
    ).toBeVisible();
    await expect(
      admin.page.getByText(REPORT_DESCRIPTION, { exact: true }),
    ).toBeVisible();
    await expect(
      admin.page.getByText(
        `Reporter: ${candidateUser.name ?? candidateUser.email}`,
        { exact: true },
      ),
    ).toBeVisible();

    const triageForm = admin.page.locator(
      'form:has(input[name="operation"][value="report-triage"])',
    );
    await triageForm.getByLabel("Zuweisung").selectOption(adminUser.id);
    await triageForm.getByLabel("Sichere Notiz").fill(TRIAGE_NOTE);
    await triageForm
      .getByRole("button", { name: "Triage speichern" })
      .click();
    await expect(
      triageForm.getByText(ADMIN_ACTION_SUCCEEDED, { exact: true }),
    ).toBeVisible();
    await admin.page.reload();

    await expect(
      database.abuseReport.findUniqueOrThrow({
        where: { id: report.id },
        select: {
          status: true,
          severity: true,
          assigneeUserId: true,
          version: true,
        },
      }),
    ).resolves.toEqual({
      status: "IN_REVIEW",
      severity: "HIGH",
      assigneeUserId: adminUser.id,
      version: 2,
    });

    const restrictionForm = admin.page.locator(
      'form:has(input[name="operation"][value="restriction-apply"])',
    );
    await restrictionForm
      .getByLabel("Pflichtgrund")
      .fill("Bestätigter Scam-Verdacht im Phase-17-Prüfpfad.");
    await restrictionForm
      .getByRole("button", {
        name: "Restriktion mit Auswirkungen anwenden",
      })
      .click();
    await expect(
      restrictionForm.getByText(ADMIN_ACTION_SUCCEEDED, { exact: true }),
    ).toBeVisible();

    const restriction =
      await database.moderationRestriction.findFirstOrThrow({
        where: {
          abuseReportId: report.id,
          targetType: "HIDE_JOB",
          targetId: job.id,
        },
        select: {
          id: true,
          status: true,
          targetType: true,
          targetId: true,
        },
      });
    expect(restriction).toMatchObject({
      status: "ACTIVE",
      targetType: "HIDE_JOB",
      targetId: job.id,
    });
    await expect(
      database.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PUBLISHED" });

    const hiddenJobResponse = await candidate.page.goto(
      `/jobs/${job.slug}`,
    );
    expect([200, 404]).toContain(hiddenJobResponse?.status());
    await expect(
      candidate.page.getByRole("heading", {
        level: 1,
        name: "Diese Seite ist nicht verfügbar.",
      }),
    ).toBeVisible();
    await expect(
      candidate.page.getByRole("heading", {
        level: 1,
        name: job.publishedRevision!.title,
      }),
    ).toHaveCount(0);
    await expect(
      candidate.page.locator('meta[name="robots"][content*="noindex"]').first(),
    ).toHaveAttribute("content", /noindex/u);

    await admin.page.reload();
    const liftForm = admin.page.locator(
      'form:has(input[name="operation"][value="restriction-lift"])',
    );
    await liftForm
      .getByRole("button", {
        name: "Restriktion aufheben – keine Auto-Reaktivierung",
      })
      .click();
    await expect(liftForm).toHaveCount(0);
    await expect(
      admin.page.getByText("LIFTED", { exact: true }),
    ).toBeVisible();
    await expect(
      database.moderationRestriction.findUniqueOrThrow({
        where: { id: restriction.id },
        select: { status: true, liftReason: true },
      }),
    ).resolves.toEqual({
      status: "LIFTED",
      liftReason: "REVIEWED_LIFT",
    });

    const restoredJobResponse = await candidate.page.goto(
      `/jobs/${job.slug}`,
    );
    expect(restoredJobResponse?.status()).toBe(200);
    await expect(
      candidate.page.getByRole("heading", {
        level: 1,
        name: job.publishedRevision!.title,
      }),
    ).toBeVisible();

    await admin.page.reload();
    const resolveForm = admin.page.locator(
      'form:has(input[name="operation"][value="report-resolve"])',
    );
    await resolveForm
      .getByRole("button", { name: "Report lösen" })
      .click();
    await expect(
      resolveForm.getByText(ADMIN_ACTION_SUCCEEDED, { exact: true }),
    ).toBeVisible();
    await admin.page.reload();
    await expect(
      admin.page.getByText("RESOLVED", { exact: true }).first(),
    ).toBeVisible();

    const resolvedReport = await database.abuseReport.findUniqueOrThrow({
      where: { id: report.id },
      select: {
        status: true,
        resolutionCode: true,
        resolvedAt: true,
        version: true,
        events: {
          select: {
            kind: true,
            actorUserId: true,
            reasonCode: true,
            safeNote: true,
          },
        },
      },
    });
    expect(resolvedReport).toMatchObject({
      status: "RESOLVED",
      resolutionCode: "REVIEW_COMPLETED",
      version: 4,
    });
    expect(resolvedReport.resolvedAt).not.toBeNull();
    expect(resolvedReport.events).toHaveLength(6);
    expect(resolvedReport.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "TRIAGED",
          actorUserId: adminUser.id,
          reasonCode: "RISK_TRIAGED",
          safeNote: TRIAGE_NOTE,
        }),
        expect.objectContaining({
          kind: "ASSIGNED",
          actorUserId: adminUser.id,
        }),
        expect.objectContaining({
          kind: "RESTRICTION_APPLIED",
          reasonCode: "HIDE_JOB",
        }),
        expect.objectContaining({
          kind: "RESTRICTION_LIFTED",
          reasonCode: "REVIEWED_LIFT",
        }),
        expect.objectContaining({
          kind: "RESOLVED",
          reasonCode: "REVIEW_COMPLETED",
        }),
      ]),
    );
    const reportAudits = await database.auditLog.findMany({
      where: {
        targetId: report.id,
        action: {
          in: [
            "ABUSE_REPORT_SUBMITTED",
            "ABUSE_REPORT_TRIAGED",
            "ABUSE_REPORT_RESOLVED",
          ],
        },
      },
      orderBy: { action: "asc" },
      select: { action: true, actorUserId: true, result: true },
    });
    expect(reportAudits).toHaveLength(3);
    expect(reportAudits).toEqual(
      expect.arrayContaining([
        {
          action: "ABUSE_REPORT_RESOLVED",
          actorUserId: adminUser.id,
          result: "SUCCEEDED",
        },
        {
          action: "ABUSE_REPORT_SUBMITTED",
          actorUserId: candidateUser.id,
          result: "SUCCEEDED",
        },
        {
          action: "ABUSE_REPORT_TRIAGED",
          actorUserId: adminUser.id,
          result: "SUCCEEDED",
        },
      ]),
    );
    await expect(
      database.auditLog.count({
        where: {
          action: {
            in: [
              "MODERATION_RESTRICTION_APPLIED",
              "MODERATION_RESTRICTION_LIFTED",
            ],
          },
          targetId: restriction.id,
          actorUserId: adminUser.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(2);
    await expect(
      database.auditLog.count({
        where: {
          action: "JOB_FLAGGED",
          targetId: job.id,
          actorUserId: adminUser.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);

    const jobCountBeforeImport = await database.job.count();
    expect(
      await database.job.count({
        where: {
          importSourceId: importSource.id,
          sourceReference: HOSTILE_SOURCE_ITEM_KEY,
        },
      }),
    ).toBe(0);

    await admin.page.goto("/admin/imports");
    await expect(
      admin.page.getByRole("heading", { level: 1, name: "Importe" }),
    ).toBeVisible();
    await admin.page
      .getByLabel("Lizenzierte Quelle")
      .selectOption(importSource.id);
    await admin.page.getByLabel("Format").selectOption("JSON");
    await admin.page
      .getByLabel("XML oder JSON (max. 750 KB)")
      .fill(hostileImportPayload());
    await admin.page
      .getByRole("button", { name: "Sichere Vorschau erzeugen" })
      .click();
    await expect(
      admin.page.getByText(ADMIN_ACTION_SUCCEEDED, { exact: true }),
    ).toBeVisible();

    const importItem = await database.importItem.findFirstOrThrow({
      where: {
        sourceItemKey: HOSTILE_SOURCE_ITEM_KEY,
        run: { importSourceId: importSource.id },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        normalizedPreview: true,
        validationSummary: true,
        redactedErrorSummary: true,
        run: {
          select: {
            id: true,
            status: true,
            redactedErrorSummary: true,
          },
        },
      },
    });
    expect(importItem.status).toBe("ERROR");
    expect(importItem.normalizedPreview).toEqual({
      id: HOSTILE_SOURCE_ITEM_KEY,
    });
    expect(importItem.validationSummary).toEqual({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          field: "workload_max",
          code: "custom",
        }),
        expect.objectContaining({
          field: "workplace_country",
          code: "custom",
        }),
        expect.objectContaining({
          field: "application_url",
          code: "custom",
        }),
      ]),
    });
    expect(importItem.redactedErrorSummary).toBe(
      "Datensatz enthält ungültige oder fehlende Felder.",
    );
    expect(importItem.run).toMatchObject({
      status: "PREVIEW_READY",
      redactedErrorSummary:
        "1 Datensätze benötigen Korrektur oder Ablehnung.",
    });

    await admin.page.reload();
    const importRunLink = admin.page.locator(
      `a[href="/admin/imports/${importItem.run.id}"]`,
    );
    await expect(importRunLink).toBeVisible();
    await importRunLink.click();
    await expect(admin.page).toHaveURL(
      `/admin/imports/${importItem.run.id}`,
    );
    await expect(
      admin.page.getByRole("heading", {
        level: 1,
        name: importSource.name,
      }),
    ).toBeVisible();
    await expect(
      admin.page.getByRole("heading", {
        level: 2,
        name: HOSTILE_SOURCE_ITEM_KEY,
      }),
    ).toBeVisible();
    await expect(
      admin.page.getByText(
        "Datensatz enthält ungültige oder fehlende Felder.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(admin.page.locator("body")).not.toContainText(
      HOSTILE_APPLICATION_URL,
    );

    const rejectImportForm = admin.page.locator(
      'form:has(input[name="operation"][value="import-decision"])',
    );
    await rejectImportForm
      .getByRole("button", { name: "Ungültiges Item ablehnen" })
      .click();
    await expect(rejectImportForm).toHaveCount(0);
    await admin.page.reload();
    await expect(
      admin.page.getByText(/Entscheidung:\s*REJECT/u),
    ).toBeVisible();

    const commitImportForm = admin.page.locator(
      'form:has(input[name="operation"][value="import-commit"])',
    );
    await commitImportForm
      .getByRole("button", {
        name: "Freigegebene Mappings als Drafts committen",
      })
      .click();
    await expect(
      commitImportForm.getByText(
        "Die nötigen Entscheidungen oder Angaben sind noch nicht vollständig.",
        { exact: true },
      ),
    ).toBeVisible();

    const reviewedImport = await database.importRun.findUniqueOrThrow({
      where: { id: importItem.run.id },
      select: {
        status: true,
        items: {
          select: {
            status: true,
            sourceItemKey: true,
            decision: {
              select: {
                kind: true,
                selectedCompanyId: true,
                committedJobId: true,
                reasonCode: true,
              },
            },
          },
        },
      },
    });
    expect(reviewedImport).toEqual({
      status: "PREVIEW_READY",
      items: [
        {
          status: "ERROR",
          sourceItemKey: HOSTILE_SOURCE_ITEM_KEY,
          decision: {
            kind: "REJECT",
            selectedCompanyId: null,
            committedJobId: null,
            reasonCode: "VALIDATION_FAILED",
          },
        },
      ],
    });
    await expect(database.job.count()).resolves.toBe(jobCountBeforeImport);
    await expect(
      database.job.count({
        where: {
          importSourceId: importSource.id,
          sourceReference: HOSTILE_SOURCE_ITEM_KEY,
        },
      }),
    ).resolves.toBe(0);
    const importAudits = await database.auditLog.findMany({
      where: {
        targetId: importItem.run.id,
        action: {
          in: [
            "IMPORT_PARSED",
            "IMPORT_DECISION_RECORDED",
            "IMPORT_COMMITTED",
          ],
        },
      },
      orderBy: { action: "asc" },
      select: {
        action: true,
        actorUserId: true,
        reasonCode: true,
        result: true,
      },
    });
    expect(importAudits).toHaveLength(2);
    expect(importAudits).toEqual(
      expect.arrayContaining([
        {
          action: "IMPORT_DECISION_RECORDED",
          actorUserId: adminUser.id,
          reasonCode: "VALIDATION_FAILED",
          result: "SUCCEEDED",
        },
        {
          action: "IMPORT_PARSED",
          actorUserId: adminUser.id,
          reasonCode: "PREVIEW_CREATED",
          result: "SUCCEEDED",
        },
      ]),
    );
  } finally {
    await admin?.close();
    await candidate?.close();
    await database.$disconnect();
  }
});

function hostileImportPayload() {
  return JSON.stringify([
    {
      id: HOSTILE_SOURCE_ITEM_KEY,
      company: "Unautorisierte Phase 17 Attack AG",
      title: "Hostiler Import darf nie publiziert werden",
      workplace_country: "DE",
      zip: "8000",
      city: "Zürich",
      canton: "ZH",
      description:
        "Dieser absichtlich feindliche Feed-Eintrag darf weder einen Job noch eine Publikation erzeugen.",
      requirements: ["Keine"],
      offer: "Nicht autorisiertes Angebot",
      contact: "attack@example.invalid",
      application_url: HOSTILE_APPLICATION_URL,
      type: "PERMANENT",
      workload_min: 100,
      workload_max: 20,
      keywords: ["hostile", "unlicensed"],
    },
  ]);
}
