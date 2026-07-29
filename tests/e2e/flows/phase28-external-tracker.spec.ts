import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { EXTERNAL_APPLICATION_RESUME_POLICY_V1 } from "@/lib/recruiting/external-application-intent";
import {
  ensurePhase28BrowserFixture,
  PHASE28_EXTERNAL_APPLICATION_URL,
  phase28LocalSlot,
} from "@/tests/e2e/fixtures/phase28-test";

test.describe.configure({ mode: "serial" });

test("[E2E-28A] @journey keeps click, candidate confirmation and external outcome separate", async ({
  browser,
}) => {
  const fixture = await ensurePhase28BrowserFixture();
  const database = phase17Database();
  const candidate = await openActor(browser, DEMO_ACCOUNTS.candidate);
  try {
    const before = await database.externalApplicationTracker.count({
      where: {
        candidateProfileId: fixture.candidateProfileId,
        snapshot: { is: { sourceJobId: fixture.externalJobId } },
      },
    });
    const internalApplicationsBefore = await database.application.count({
      where: { candidateProfileId: fixture.candidateProfileId },
    });

    await candidate.page.route(
      PHASE28_EXTERNAL_APPLICATION_URL,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><html lang=\"de\"><title>ATS-Testziel</title><body><h1>Fiktive Arbeitgeberseite</h1></body></html>",
        });
      },
    );
    await candidate.page.goto(`/jobs/${fixture.externalJobSlug}`);
    await expect(
      candidate.page.getByRole("heading", {
        name: "Phase 28 External Software Engineer",
      }),
    ).toBeVisible();
    await candidate.page
      .locator(
        `form:has(input[name="jobSlug"][value="${fixture.externalJobSlug}"]):has(input[name="action"][value="APPLY"]) button[type="submit"]`,
      )
      .click();
    await expect(candidate.page).toHaveURL(PHASE28_EXTERNAL_APPLICATION_URL);
    await expect(
      candidate.page.getByRole("heading", {
        name: "Fiktive Arbeitgeberseite",
      }),
    ).toBeVisible();

    expect(
      await database.externalApplicationTracker.count({
        where: {
          candidateProfileId: fixture.candidateProfileId,
          snapshot: { is: { sourceJobId: fixture.externalJobId } },
        },
      }),
    ).toBe(before);
    expect(
      await database.application.count({
        where: { candidateProfileId: fixture.candidateProfileId },
      }),
    ).toBe(internalApplicationsBefore);

    await candidate.page.goto("/candidate/applications/external");
    await expect(
      candidate.page.getByRole("heading", { name: "Externe Bewerbungen" }),
    ).toBeVisible();
    await expect(
      candidate.page.getByText(
        /Ein Klick auf eine Arbeitgeberseite ist niemals eine eingereichte Bewerbung/u,
      ),
    ).toBeVisible();
    await candidate.page
      .getByRole("button", { name: "Freiwillig als begonnen übernehmen" })
      .click();
    await expect(candidate.page).toHaveURL(
      /\/candidate\/applications\/external\/[0-9a-f-]+\?created=1$/u,
    );
    await expect(
      candidate.page.getByText(
        "Als begonnen gespeichert – nicht als eingereicht",
      ),
    ).toBeVisible();
    await expect(
      candidate.page.getByText("Quelle: CANDIDATE_CONFIRMED"),
    ).toBeVisible();

    const created = await database.externalApplicationTracker.findFirstOrThrow({
      where: {
        candidateProfileId: fixture.candidateProfileId,
        snapshot: { is: { sourceJobId: fixture.externalJobId } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        version: true,
        snapshotFingerprint: true,
        snapshot: {
          select: {
            payloadHash: true,
            source: true,
            sourceJobRevisionId: true,
          },
        },
        events: { select: { kind: true, toStatus: true, source: true } },
      },
    });
    expect(created.status).toBe("BEGUN");
    expect(created.version).toBe(1);
    expect(created.snapshot).toEqual(
      expect.objectContaining({
        payloadHash: created.snapshotFingerprint,
        source: "CANDIDATE_CONFIRMED",
        sourceJobRevisionId: fixture.externalJobRevisionId,
      }),
    );
    expect(created.events).toEqual([
      {
        kind: "CREATED",
        toStatus: "BEGUN",
        source: "CANDIDATE_CONFIRMED",
      },
    ]);

    await candidate.page
      .getByLabel("Neuer, von dir bestätigter Status")
      .selectOption("SUBMITTED");
    await candidate.page
      .getByRole("button", { name: "Eigene Angabe speichern" })
      .click();
    await expect(
      candidate.page.getByText("Status als eigene Angabe gespeichert."),
    ).toBeVisible();

    const reminder = phase28LocalSlot(3, 9);
    await candidate.page
      .getByLabel("Freiwillige Erinnerung (Zürich)")
      .fill(reminder.startsAtLocal);
    await candidate.page
      .getByRole("button", { name: "Erinnerung speichern" })
      .click();
    await expect(
      candidate.page.getByText("Freiwillige Erinnerung gespeichert."),
    ).toBeVisible();

    const persisted =
      await database.externalApplicationTracker.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          status: true,
          version: true,
          reminderAt: true,
          snapshotFingerprint: true,
          snapshot: { select: { payloadHash: true } },
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              kind: true,
              fromStatus: true,
              toStatus: true,
              reasonCode: true,
              source: true,
            },
          },
        },
      });
    expect(persisted).toMatchObject({
      status: "SUBMITTED",
      version: 3,
      snapshotFingerprint: created.snapshotFingerprint,
      snapshot: { payloadHash: created.snapshotFingerprint },
    });
    expect(persisted.reminderAt).not.toBeNull();
    expect(persisted.events).toEqual([
      {
        kind: "CREATED",
        fromStatus: null,
        toStatus: "BEGUN",
        reasonCode: null,
        source: "CANDIDATE_CONFIRMED",
      },
      {
        kind: "STATUS_CHANGED",
        fromStatus: "BEGUN",
        toStatus: "SUBMITTED",
        reasonCode: null,
        source: "CANDIDATE_CONFIRMED",
      },
      {
        kind: "REMINDER_CHANGED",
        fromStatus: null,
        toStatus: null,
        reasonCode: "REMINDER_SET",
        source: "CANDIDATE_CONFIRMED",
      },
    ]);
    expect(
      (
        await candidate.context.cookies()
      ).some(
        ({ name }) =>
          name === EXTERNAL_APPLICATION_RESUME_POLICY_V1.cookieName,
      ),
    ).toBe(false);
  } finally {
    await candidate.close();
    await database.$disconnect();
  }
});
