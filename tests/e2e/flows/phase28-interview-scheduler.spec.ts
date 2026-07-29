import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  ensurePhase28BrowserFixture,
  PHASE28_INTERVIEW_SUBJECT,
  phase28LocalSlot,
} from "@/tests/e2e/fixtures/phase28-test";

test.describe.configure({ mode: "serial" });

test("[E2E-28B] @journey proposes, accepts, reschedules and cancels one versioned interview", async ({
  browser,
}) => {
  const fixture = await ensurePhase28BrowserFixture();
  const database = phase17Database();
  const employer = await openActor(browser, DEMO_ACCOUNTS.employer);
  const candidate = await openActor(browser, DEMO_ACCOUNTS.candidate);
  try {
    const initialSlot = phase28LocalSlot(7, 10);
    await employer.page.goto(
      `/employer/applicants/${fixture.applicationId}/interviews`,
    );
    await expect(
      employer.page.getByRole("heading", { name: "Interviews planen" }),
    ).toBeVisible();
    await employer.page
      .getByLabel("Betreff")
      .fill(PHASE28_INTERVIEW_SUBJECT);
    await employer.page
      .getByLabel("Ort oder Videolink (optional)")
      .fill("https://meet.phase28.example.test/interview");
    await employer.page.locator("#slot-1-start").fill(initialSlot.startsAtLocal);
    await employer.page.locator("#slot-1-end").fill(initialSlot.endsAtLocal);
    await employer.page
      .getByRole("button", { name: "Terminvorschläge senden" })
      .click();
    await expect(
      employer.page.getByText(
        "Terminvorschläge gesendet. Noch ist kein Termin bestätigt.",
      ),
    ).toBeVisible();

    const proposed = await database.interview.findFirstOrThrow({
      where: {
        applicationId: fixture.applicationId,
        subject: PHASE28_INTERVIEW_SUBJECT,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        version: true,
        application: { select: { status: true } },
        proposals: {
          orderBy: { slotIndex: "asc" },
          select: {
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
            timeZone: true,
          },
        },
        participants: {
          orderBy: { kind: "asc" },
          select: { kind: true, status: true, userId: true },
        },
      },
    });
    expect(proposed).toMatchObject({
      status: "PROPOSED",
      version: 1,
      application: { status: expect.any(String) },
      proposals: [
        expect.objectContaining({
          status: "OPEN",
          timeZone: "Europe/Zurich",
        }),
      ],
    });
    expect(proposed.application.status).not.toBe("INTERVIEW");
    expect(proposed.participants).toEqual(
      expect.arrayContaining([
        {
          kind: "CANDIDATE",
          status: "PENDING",
          userId: fixture.candidateUserId,
        },
        {
          kind: "COMPANY_MEMBER",
          status: "ACCEPTED",
          userId: fixture.employerUserId,
        },
      ]),
    );

    await candidate.page.goto(`/candidate/interviews/${proposed.id}`);
    await expect(
      candidate.page.getByRole("heading", {
        name: PHASE28_INTERVIEW_SUBJECT,
      }),
    ).toBeVisible();
    await candidate.page
      .getByRole("button", { name: "Termin bestätigen" })
      .click();
    await expect(
      candidate.page.getByText("Bestätigt", { exact: true }),
    ).toBeVisible();
    await expect(
      candidate.page.getByRole("link", {
        name: "Kalenderdatei herunterladen",
      }),
    ).toBeVisible();

    const scheduled = await database.interview.findUniqueOrThrow({
      where: { id: proposed.id },
      select: {
        status: true,
        version: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        calendarArtifacts: {
          where: { status: "ACTIVE" },
          select: { method: true, sequence: true, payloadHash: true },
        },
        reminders: {
          select: { recipientUserId: true, status: true, dedupeKey: true },
        },
      },
    });
    expect(scheduled).toMatchObject({
      status: "SCHEDULED",
      version: 2,
      scheduledStartAt: proposed.proposals[0]!.startsAt,
      scheduledEndAt: proposed.proposals[0]!.endsAt,
      calendarArtifacts: [
        expect.objectContaining({ method: "REQUEST", sequence: 2 }),
      ],
    });
    expect(scheduled.reminders).toHaveLength(2);
    expect(new Set(scheduled.reminders.map(({ dedupeKey }) => dedupeKey)).size).toBe(
      2,
    );

    const requestCalendar = await candidate.context.request.get(
      `/api/recruiting/interviews/${proposed.id}/calendar`,
    );
    expect(requestCalendar.status()).toBe(200);
    expect(requestCalendar.headers()["content-type"]).toContain(
      "text/calendar",
    );
    const requestIcs = await requestCalendar.text();
    expect(requestIcs).toContain("BEGIN:VCALENDAR\r\n");
    expect(requestIcs).toContain("METHOD:REQUEST\r\n");
    expect(requestIcs).toContain("SEQUENCE:2\r\n");
    expect(requestIcs).not.toContain(
      "candidate@demo.ch",
    );

    const counterSlot = phase28LocalSlot(12, 14);
    await candidate.page.reload();
    await candidate.page
      .getByLabel("Beginn (Zürich)")
      .fill(counterSlot.startsAtLocal);
    await candidate.page
      .getByLabel("Ende (Zürich)")
      .fill(counterSlot.endsAtLocal);
    await candidate.page
      .getByRole("button", { name: "Neue Zeit senden" })
      .click();
    await expect(
      candidate.page.getByText("Neue Zeit vorgeschlagen", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          database.interview.findUnique({
            where: { id: proposed.id },
            select: { status: true, version: true },
          }),
        { timeout: 30_000 },
      )
      .toEqual({ status: "RESCHEDULE_PENDING", version: 3 });

    await employer.page.goto(
      `/employer/applicants/${fixture.applicationId}/interviews/${proposed.id}`,
    );
    await expect(
      employer.page.getByText("Neue Zeit vorgeschlagen", { exact: true }),
    ).toBeVisible();
    await employer.page
      .getByRole("button", { name: "Gegenvorschlag bestätigen" })
      .click();
    await expect(
      employer.page.getByText("Bestätigt", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          database.interview.findUnique({
            where: { id: proposed.id },
            select: { status: true, version: true },
          }),
        { timeout: 30_000 },
      )
      .toEqual({ status: "SCHEDULED", version: 4 });

    await employer.page.reload();
    await employer.page
      .getByRole("button", { name: "Interview verbindlich absagen" })
      .click();
    await expect(
      employer.page.getByText("Abgesagt", { exact: true }),
    ).toBeVisible();

    const cancelled = await database.interview.findUniqueOrThrow({
      where: { id: proposed.id },
      select: {
        status: true,
        version: true,
        cancelledAt: true,
        calendarArtifacts: {
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          select: { method: true, sequence: true, status: true },
        },
        reminders: { select: { status: true, cancelledAt: true } },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { kind: true, proposalVersion: true },
        },
      },
    });
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      version: 5,
      cancelledAt: expect.any(Date),
    });
    expect(cancelled.calendarArtifacts).toEqual([
      { method: "REQUEST", sequence: 2, status: "SUPERSEDED" },
      { method: "REQUEST", sequence: 4, status: "SUPERSEDED" },
      { method: "CANCEL", sequence: 5, status: "CANCELLED" },
    ]);
    expect(
      cancelled.reminders.every(
        ({ status, cancelledAt }) =>
          status === "CANCELLED" && cancelledAt !== null,
      ),
    ).toBe(true);
    expect(cancelled.events.map(({ kind }) => kind)).toEqual([
      "PROPOSED",
      "ACCEPTED",
      "RESCHEDULE_REQUESTED",
      "RESCHEDULED",
      "CANCELLED",
    ]);

    const cancelCalendar = await candidate.context.request.get(
      `/api/recruiting/interviews/${proposed.id}/calendar`,
    );
    expect(cancelCalendar.status()).toBe(200);
    const cancelIcs = await cancelCalendar.text();
    expect(cancelIcs).toContain("METHOD:CANCEL\r\n");
    expect(cancelIcs).toContain("STATUS:CANCELLED\r\n");
    expect(cancelIcs).toContain("SEQUENCE:5\r\n");

    await candidate.page.reload();
    await expect(
      candidate.page.getByText("Abgesagt", { exact: true }),
    ).toBeVisible();
  } finally {
    await candidate.close();
    await employer.close();
    await database.$disconnect();
  }
});
