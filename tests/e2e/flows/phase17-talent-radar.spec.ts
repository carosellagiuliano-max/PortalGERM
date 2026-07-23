import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import {
  advanceServerClock,
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  resetServerClock,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const TARGET_CANDIDATE_EMAIL =
  "candidate-02@demo.swisstalenthub.invalid";
const COMPANY_SLUG = "novarigi-digital";
const COMPANY_NAME = "NovaRigi Digital AG";
const FIRST_SUBJECT = "Phase 17 Radar: erster vertraulicher Austausch";
const FIRST_MESSAGE =
  "Wir möchten eine passende Gesundheitsrolle in einem anonymen Erstgespräch vorstellen.";
const COOLDOWN_SUBJECT =
  "Phase 17 Radar: unzulässiger sofortiger Zweitkontakt";
const COOLDOWN_MESSAGE =
  "Dieser Kontaktversuch muss innerhalb der Schutzfrist ohne Credit-Verbrauch abgewiesen werden.";
const SECOND_SUBJECT =
  "Phase 17 Radar: Austausch nach abgelaufener Schutzfrist";
const SECOND_MESSAGE =
  "Die Schutzfrist ist abgelaufen; wir möchten erneut ein anonymes Gespräch anbieten.";
const CONTACT_SUCCESS =
  "Kontaktanfrage gesendet. Die Identität bleibt bis zu einer separaten Freigabe anonym.";
const COOLDOWN_ERROR =
  "Eine erneute Kontaktanfrage ist innerhalb der Schutzfrist noch nicht möglich.";
const ANONYMOUS_IDENTITY_NOTICE =
  "Identität bleibt anonym bis zur Freigabe. Annahme allein reicht dafür nicht aus.";

type Database = ReturnType<typeof phase17Database>;
type Actor = Awaited<ReturnType<typeof openActor>>;

test("[E2E-04] @journey anonymous Radar decline, cooldown, accept and typed reveal", async ({
  browser,
}) => {
  const database = phase17Database();
  let firstEmployer: Actor | undefined;
  let decliningCandidate: Actor | undefined;
  let secondEmployer: Actor | undefined;
  let acceptingCandidate: Actor | undefined;
  let revealedEmployer: Actor | undefined;

  try {
    resetServerClock();
    const scenario = await prepareScenario(database);
    const consumeBaseline = await companyContactConsumeCount(
      database,
      scenario.companyId,
    );

    firstEmployer = await openActor(browser, DEMO_ACCOUNTS.employer);
    const firstCard = await openTargetCandidateCard(firstEmployer.page);
    await assertCandidateCardIsAnonymous(firstCard, scenario);
    const firstDialog = await submitContactRequest(firstCard, {
      subject: FIRST_SUBJECT,
      message: FIRST_MESSAGE,
    });
    await expect(
      firstDialog.getByText(CONTACT_SUCCESS, { exact: true }),
    ).toBeVisible();
    await firstDialog
      .getByRole("link", { name: "Anfrage ansehen" })
      .click();

    const firstRequest = await database.employerContactRequest.findFirstOrThrow({
      where: {
        companyId: scenario.companyId,
        candidateProfileId: scenario.candidateProfileId,
        subject: FIRST_SUBJECT,
      },
      select: {
        id: true,
        status: true,
        terminalAt: true,
        createdAt: true,
        expiresAt: true,
        fundingSource: true,
        creditLedgerEntry: {
          select: {
            id: true,
            kind: true,
            amount: true,
            fundingSource: true,
            reasonCode: true,
          },
        },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { kind: true },
        },
        conversation: { select: { id: true } },
        revealGrant: { select: { id: true } },
      },
    });
    expect(firstRequest.status).toBe("PENDING");
    expect(firstRequest.terminalAt).toBeNull();
    expect(
      firstRequest.expiresAt.getTime() - firstRequest.createdAt.getTime(),
    ).toBe(14 * 24 * 60 * 60 * 1_000);
    expect(firstRequest.fundingSource).toBe("PLAN_ALLOWANCE");
    expect(firstRequest.creditLedgerEntry).toEqual(
      expect.objectContaining({
        kind: "CONSUME",
        amount: -1,
        fundingSource: "PLAN_ALLOWANCE",
        reasonCode: "CONTACT_REQUEST",
      }),
    );
    expect(firstRequest.events).toEqual([{ kind: "CREATED" }]);
    expect(firstRequest.conversation).toBeNull();
    expect(firstRequest.revealGrant).toBeNull();
    expect(
      await companyContactConsumeCount(database, scenario.companyId),
    ).toBe(consumeBaseline + 1);

    await expect(firstEmployer.page).toHaveURL(
      `/employer/talent-radar/requests/${firstRequest.id}`,
    );
    await assertEmployerRequestIsAnonymous(firstEmployer.page, scenario);

    decliningCandidate = await openActor(
      browser,
      TARGET_CANDIDATE_EMAIL,
    );
    await decliningCandidate.page.goto(
      `/candidate/talent-radar/requests/${firstRequest.id}`,
    );
    await expect(
      decliningCandidate.page.getByRole("heading", {
        level: 1,
        name: COMPANY_NAME,
      }),
    ).toBeVisible();
    await decliningCandidate.page
      .getByRole("button", { name: "Ablehnen", exact: true })
      .click();
    const declineDialog = decliningCandidate.page.getByRole("dialog", {
      name: "Kontaktanfrage ablehnen?",
    });
    await declineDialog
      .getByLabel("Ich möchte diese Kontaktanfrage ablehnen.")
      .check();
    await declineDialog
      .getByRole("button", { name: "Verbindlich ablehnen" })
      .click();
    await expect(decliningCandidate.page).toHaveURL(
      new RegExp(
        `/candidate/talent-radar/requests/${firstRequest.id}\\?updated=declined$`,
        "u",
      ),
    );
    await expect(
      decliningCandidate.page.getByText(
        "Kontaktanfrage abgelehnt. Es wurde kein Gespräch erstellt.",
        { exact: true },
      ),
    ).toBeVisible();

    const declinedEvidence =
      await database.employerContactRequest.findUniqueOrThrow({
        where: { id: firstRequest.id },
        select: {
          status: true,
          terminalAt: true,
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true },
          },
          conversation: { select: { id: true } },
          revealGrant: { select: { id: true } },
        },
      });
    expect(declinedEvidence.status).toBe("DECLINED");
    expect(declinedEvidence.terminalAt).not.toBeNull();
    expect(declinedEvidence.events).toEqual([
      { kind: "CREATED" },
      { kind: "DECLINED" },
    ]);
    expect(declinedEvidence.conversation).toBeNull();
    expect(declinedEvidence.revealGrant).toBeNull();

    const requestsBeforeCooldownAttempt =
      await companyCandidateRequestIds(database, scenario);
    const consumesBeforeCooldownAttempt = await companyContactConsumeCount(
      database,
      scenario.companyId,
    );
    const cooldownCard = await openTargetCandidateCard(firstEmployer.page);
    const cooldownDialog = await submitContactRequest(cooldownCard, {
      subject: COOLDOWN_SUBJECT,
      message: COOLDOWN_MESSAGE,
    });
    await expect(
      cooldownDialog.getByRole("alert"),
    ).toHaveText(COOLDOWN_ERROR);
    expect(await companyCandidateRequestIds(database, scenario)).toEqual(
      requestsBeforeCooldownAttempt,
    );
    expect(
      await database.employerContactRequest.count({
        where: {
          companyId: scenario.companyId,
          candidateProfileId: scenario.candidateProfileId,
          subject: COOLDOWN_SUBJECT,
        },
      }),
    ).toBe(0);
    expect(
      await companyContactConsumeCount(database, scenario.companyId),
    ).toBe(consumesBeforeCooldownAttempt);

    await closeActor(firstEmployer);
    firstEmployer = undefined;
    await closeActor(decliningCandidate);
    decliningCandidate = undefined;

    await advanceServerClock(31);

    secondEmployer = await openActor(browser, DEMO_ACCOUNTS.employer);
    const secondCard = await openTargetCandidateCard(secondEmployer.page);
    await assertCandidateCardIsAnonymous(secondCard, scenario);
    const secondDialog = await submitContactRequest(secondCard, {
      subject: SECOND_SUBJECT,
      message: SECOND_MESSAGE,
    });
    await expect(
      secondDialog.getByText(CONTACT_SUCCESS, { exact: true }),
    ).toBeVisible();
    await secondDialog
      .getByRole("link", { name: "Anfrage ansehen" })
      .click();

    const secondRequest =
      await database.employerContactRequest.findFirstOrThrow({
        where: {
          companyId: scenario.companyId,
          candidateProfileId: scenario.candidateProfileId,
          subject: SECOND_SUBJECT,
        },
        select: {
          id: true,
          status: true,
          terminalAt: true,
          fundingSource: true,
          creditLedgerEntry: {
            select: {
              id: true,
              kind: true,
              amount: true,
              fundingSource: true,
              reasonCode: true,
            },
          },
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true },
          },
          conversation: { select: { id: true } },
          revealGrant: { select: { id: true } },
        },
      });
    expect(secondRequest.id).not.toBe(firstRequest.id);
    expect(secondRequest.status).toBe("PENDING");
    expect(secondRequest.terminalAt).toBeNull();
    expect(secondRequest.fundingSource).toBe("ADMIN_GRANT");
    expect(secondRequest.creditLedgerEntry).toEqual(
      expect.objectContaining({
        kind: "CONSUME",
        amount: -1,
        fundingSource: "ADMIN_GRANT",
        reasonCode: "CONTACT_REQUEST",
      }),
    );
    expect(secondRequest.events).toEqual([{ kind: "CREATED" }]);
    expect(secondRequest.conversation).toBeNull();
    expect(secondRequest.revealGrant).toBeNull();
    expect(
      await companyContactConsumeCount(database, scenario.companyId),
    ).toBe(consumeBaseline + 2);
    expect(
      new Set([
        firstRequest.creditLedgerEntry.id,
        secondRequest.creditLedgerEntry.id,
      ]).size,
    ).toBe(2);

    acceptingCandidate = await openActor(
      browser,
      TARGET_CANDIDATE_EMAIL,
    );
    await acceptingCandidate.page.goto(
      `/candidate/talent-radar/requests/${secondRequest.id}`,
    );
    await acceptingCandidate.page
      .getByRole("button", { name: "Kontaktanfrage annehmen" })
      .click();
    const acceptDialog = acceptingCandidate.page.getByRole("dialog", {
      name: "Kontaktanfrage annehmen?",
    });
    await acceptDialog
      .getByLabel(
        "Ich möchte die Kontaktanfrage annehmen und anonym schreiben.",
      )
      .check();
    await acceptDialog
      .getByRole("button", { name: "Verbindlich annehmen" })
      .click();
    await expect(acceptingCandidate.page).toHaveURL(
      new RegExp(
        `/candidate/talent-radar/requests/${secondRequest.id}\\?updated=accepted$`,
        "u",
      ),
    );
    await expect(
      acceptingCandidate.page.getByText(
        "Kontaktanfrage angenommen. Das Gespräch ist anonym; es wurden keine Identitätsdaten freigegeben.",
        { exact: true },
      ),
    ).toBeVisible();

    const acceptedEvidence =
      await database.employerContactRequest.findUniqueOrThrow({
        where: { id: secondRequest.id },
        select: {
          status: true,
          terminalAt: true,
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true },
          },
          conversation: {
            select: {
              id: true,
              kind: true,
              contactRequestId: true,
              participants: {
                orderBy: [{ kind: "asc" }, { id: "asc" }],
                select: {
                  kind: true,
                  userId: true,
                  companyId: true,
                },
              },
            },
          },
          revealGrant: { select: { id: true } },
        },
      });
    expect(acceptedEvidence.status).toBe("ACCEPTED");
    expect(acceptedEvidence.terminalAt).not.toBeNull();
    expect(acceptedEvidence.events).toEqual([
      { kind: "CREATED" },
      { kind: "ACCEPTED" },
    ]);
    expect(acceptedEvidence.conversation).toEqual(
      expect.objectContaining({
        kind: "TALENT_RADAR",
        contactRequestId: secondRequest.id,
      }),
    );
    expect(acceptedEvidence.conversation?.participants).toHaveLength(2);
    expect(acceptedEvidence.conversation?.participants).toEqual(
      expect.arrayContaining([
        {
          kind: "USER",
          userId: scenario.candidateUserId,
          companyId: null,
        },
        {
          kind: "COMPANY_PRINCIPAL",
          userId: null,
          companyId: scenario.companyId,
        },
      ]),
    );
    expect(acceptedEvidence.revealGrant).toBeNull();
    expect(
      await database.conversation.count({
        where: {
          contactRequestId: { in: [firstRequest.id, secondRequest.id] },
        },
      }),
    ).toBe(1);

    await secondEmployer.page.goto(
      `/employer/talent-radar/requests/${secondRequest.id}`,
    );
    await expect(
      secondEmployer.page.getByText("Anonymes Gespräch erstellt", {
        exact: true,
      }),
    ).toBeVisible();
    await assertEmployerRequestIsAnonymous(secondEmployer.page, scenario);

    await acceptingCandidate.page
      .getByRole("button", {
        name: `Identität für ${COMPANY_NAME} freigeben`,
      })
      .click();
    const revealDialog = acceptingCandidate.page.getByRole("dialog", {
      name: "Identitätsfelder bewusst freigeben",
    });
    await revealDialog.getByLabel("Anzeigename", { exact: true }).check();
    await revealDialog.getByLabel("E-Mail-Adresse", { exact: true }).check();
    await expect(
      revealDialog.getByLabel("Telefonnummer", { exact: true }),
    ).not.toBeChecked();
    await expect(
      revealDialog.getByLabel("Lebenslauf-Metadaten", { exact: true }),
    ).not.toBeChecked();
    await revealDialog
      .getByRole("button", { name: "Exakte Vorschau erstellen" })
      .click();
    await expect(
      revealDialog.getByText("Diese Werte werden freigegeben", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      revealDialog.getByText(scenario.publicDisplayName, { exact: true }),
    ).toBeVisible();
    await expect(
      revealDialog.getByText(TARGET_CANDIDATE_EMAIL, { exact: true }),
    ).toBeVisible();
    await expect(
      revealDialog.getByText(`Empfängerin: ${COMPANY_NAME}`, {
        exact: true,
      }),
    ).toBeVisible();
    await revealDialog
      .getByLabel(
        `Ich bestätige genau diese Felder und Werte für ${COMPANY_NAME}.`,
      )
      .check();
    await revealDialog
      .getByRole("button", { name: "Auswahl verbindlich freigeben" })
      .click();
    await expect(acceptingCandidate.page).toHaveURL(
      new RegExp(
        `/candidate/talent-radar/requests/${secondRequest.id}\\?updated=revealed$`,
        "u",
      ),
    );
    await expect(
      acceptingCandidate.page.getByText(
        "Die bestätigten Identitätsfelder wurden für diese Anfrage freigegeben.",
        { exact: true },
      ),
    ).toBeVisible();
    const revealedFieldList = acceptingCandidate.page.getByRole("list", {
      name: "Freigegebene Identitätsfelder",
    });
    await expect(
      revealedFieldList.getByText("Anzeigename", { exact: true }),
    ).toBeVisible();
    await expect(
      revealedFieldList.getByText("E-Mail-Adresse", { exact: true }),
    ).toBeVisible();

    const revealEvidence =
      await database.employerContactRequest.findUniqueOrThrow({
        where: { id: secondRequest.id },
        select: {
          status: true,
          conversation: { select: { id: true } },
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true },
          },
          revealGrant: {
            select: {
              id: true,
              candidateProfileId: true,
              companyId: true,
              contactRequestId: true,
              conversationId: true,
              noticeVersion: true,
              confirmationSnapshotHash: true,
              revealedAt: true,
              revokedAt: true,
              fields: {
                orderBy: [{ field: "asc" }, { id: "asc" }],
                select: {
                  field: true,
                  ciphertext: true,
                  nonce: true,
                  authTag: true,
                  encryptionKeyVersion: true,
                  schemaVersion: true,
                  integrityHmac: true,
                },
              },
              confirmations: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: {
                  actorUserId: true,
                  contactRequestId: true,
                  conversationId: true,
                  completeFieldSet: true,
                  newlyAddedFields: true,
                  noticeVersion: true,
                  previewHmac: true,
                  confirmationKeyVersion: true,
                  confirmationTokenDigest: true,
                },
              },
            },
          },
        },
      });
    expect(revealEvidence.status).toBe("ACCEPTED");
    expect(revealEvidence.events).toEqual([
      { kind: "CREATED" },
      { kind: "ACCEPTED" },
      { kind: "REVEAL_GRANTED" },
    ]);
    expect(revealEvidence.revealGrant).not.toBeNull();
    const revealGrant = revealEvidence.revealGrant!;
    expect(revealGrant).toEqual(
      expect.objectContaining({
        candidateProfileId: scenario.candidateProfileId,
        companyId: scenario.companyId,
        contactRequestId: secondRequest.id,
        conversationId: revealEvidence.conversation?.id,
        noticeVersion: "identity-reveal-v1",
        revokedAt: null,
      }),
    );
    expect(revealGrant.revealedAt).toBeInstanceOf(Date);
    expect(revealGrant.confirmationSnapshotHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(revealGrant.fields.map(({ field }) => field)).toEqual([
      "DISPLAY_NAME",
      "EMAIL",
    ]);
    for (const field of revealGrant.fields) {
      const ciphertext = Buffer.from(field.ciphertext);
      expect(ciphertext.toString("utf8")).not.toContain(
        scenario.publicDisplayName,
      );
      expect(ciphertext.toString("utf8")).not.toContain(
        TARGET_CANDIDATE_EMAIL,
      );
      expect(Buffer.from(field.nonce)).toHaveLength(12);
      expect(Buffer.from(field.authTag)).toHaveLength(16);
      expect(field.encryptionKeyVersion).not.toHaveLength(0);
      expect(field.schemaVersion).toBe("v1");
      expect(field.integrityHmac).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(revealGrant.confirmations).toHaveLength(1);
    expect(revealGrant.confirmations[0]).toEqual(
      expect.objectContaining({
        actorUserId: scenario.candidateUserId,
        contactRequestId: secondRequest.id,
        conversationId: revealEvidence.conversation?.id,
        completeFieldSet: ["DISPLAY_NAME", "EMAIL"],
        newlyAddedFields: ["DISPLAY_NAME", "EMAIL"],
        noticeVersion: "identity-reveal-v1",
      }),
    );
    expect(revealGrant.confirmations[0]?.previewHmac).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(revealGrant.confirmations[0]?.confirmationKeyVersion).not
      .toHaveLength(0);
    expect(revealGrant.confirmations[0]?.confirmationTokenDigest).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(
      await database.notification.count({
        where: {
          recipientUserId: scenario.employerUserId,
          kind: "IDENTITY_REVEAL_GRANTED",
          payload: {
            path: ["contactRequestId"],
            equals: secondRequest.id,
          },
        },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: {
          action: "IDENTITY_REVEALED",
          result: "SUCCEEDED",
          targetType: "IDENTITY_REVEAL_GRANT",
          targetId: revealGrant.id,
        },
      }),
    ).toBe(1);

    revealedEmployer = await openActor(browser, DEMO_ACCOUNTS.employer);
    await revealedEmployer.page.goto(
      `/employer/talent-radar/requests/${secondRequest.id}`,
    );
    const identityCard = revealedEmployer.page
      .locator('[data-slot="card"]')
      .filter({
        has: revealedEmployer.page.getByRole("heading", {
          name: "Identitätsfreigabe",
        }),
      });
    await expect(identityCard).toHaveCount(1);
    await expect(
      identityCard.getByText("Anzeigename", { exact: true }),
    ).toBeVisible();
    await expect(
      identityCard.getByText(scenario.publicDisplayName, { exact: true }),
    ).toBeVisible();
    await expect(
      identityCard.getByText("E-Mail", { exact: true }),
    ).toBeVisible();
    await expect(
      identityCard.getByText(TARGET_CANDIDATE_EMAIL, { exact: true }),
    ).toBeVisible();
    expect(
      await companyContactConsumeCount(database, scenario.companyId),
    ).toBe(consumeBaseline + 2);
  } finally {
    let cleanupError: unknown;
    for (const actor of [
      revealedEmployer,
      acceptingCandidate,
      secondEmployer,
      decliningCandidate,
      firstEmployer,
    ]) {
      if (actor === undefined) continue;
      try {
        await actor.close();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      resetServerClock();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await database.$disconnect();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError !== undefined) throw cleanupError;
  }
});

async function prepareScenario(database: Database) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000);
  const [
    company,
    targetUser,
    demoCredential,
    adminUser,
    employerUser,
  ] = await Promise.all([
    database.company.findUniqueOrThrow({
      where: { slug: COMPANY_SLUG },
      select: { id: true, name: true },
    }),
    database.user.findUniqueOrThrow({
      where: { emailNormalized: TARGET_CANDIDATE_EMAIL },
      select: {
        id: true,
        email: true,
        candidateProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            publicDisplayName: true,
          },
        },
      },
    }),
    database.credential.findFirstOrThrow({
      where: {
        user: { emailNormalized: DEMO_ACCOUNTS.candidate },
      },
      select: {
        passwordHash: true,
        algorithm: true,
        algorithmVersion: true,
        passwordChangedAt: true,
      },
    }),
    database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    }),
    database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.employer },
      select: { id: true },
    }),
  ]);
  expect(company.name).toBe(COMPANY_NAME);
  expect(targetUser.email).toBe(TARGET_CANDIDATE_EMAIL);
  if (
    targetUser.candidateProfile === null ||
    targetUser.candidateProfile.firstName === null ||
    targetUser.candidateProfile.lastName === null ||
    targetUser.candidateProfile.publicDisplayName === null
  ) {
    throw new Error("The deterministic E2E-04 Radar candidate is incomplete.");
  }

  await database.credential.upsert({
    where: { userId: targetUser.id },
    create: {
      id: randomUUID(),
      userId: targetUser.id,
      ...demoCredential,
      createdAt: now,
    },
    update: {
      passwordHash: demoCredential.passwordHash,
      algorithm: demoCredential.algorithm,
      algorithmVersion: demoCredential.algorithmVersion,
      passwordChangedAt: demoCredential.passwordChangedAt,
    },
  });

  await database.entitlementGrant.create({
    data: {
      id: randomUUID(),
      companyId: company.id,
      key: "TALENT_RADAR_ACCESS",
      valueType: "BOOLEAN",
      booleanValue: true,
      integerValue: null,
      analyticsLevelValue: null,
      integerMode: null,
      reasonCode: "PHASE17_E2E04_CLOCK_WINDOW",
      grantedByUserId: adminUser.id,
      validFrom: now,
      validTo: validUntil,
      idempotencyKey: `phase17:e2e04:radar:${randomUUID()}`,
      revokedAt: null,
      createdAt: now,
    },
  });

  const creditAccount = await database.creditAccount.create({
    data: {
      id: randomUUID(),
      companyId: company.id,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart: now,
      periodEnd: validUntil,
      createdAt: now,
    },
    select: { id: true },
  });
  await database.creditLedgerEntry.create({
    data: {
      id: randomUUID(),
      accountId: creditAccount.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 2,
      sourcePlanVersionId: null,
      sourceSubscriptionId: null,
      sourceOrderLineId: null,
      consumedGrantEntryId: null,
      reversalOfEntryId: null,
      validFrom: now,
      validTo: validUntil,
      idempotencyKey: `phase17:e2e04:credit:${randomUUID()}`,
      reasonCode: "PHASE17_E2E04_TOP_UP",
      actorUserId: adminUser.id,
      createdAt: now,
    },
  });

  return Object.freeze({
    companyId: company.id,
    candidateUserId: targetUser.id,
    candidateProfileId: targetUser.candidateProfile.id,
    firstName: targetUser.candidateProfile.firstName,
    lastName: targetUser.candidateProfile.lastName,
    publicDisplayName: targetUser.candidateProfile.publicDisplayName,
    employerUserId: employerUser.id,
  });
}

async function openTargetCandidateCard(page: Page) {
  await page.goto("/employer/talent-radar");
  await expect(
    page.getByRole("heading", { level: 1, name: "Talent Radar" }),
  ).toBeVisible();
  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Kanton AR" })
    .filter({ hasText: "Gesundheit Pflege" });
  await expect(card).toHaveCount(1);
  await expect(
    card.getByRole("heading", {
      level: 2,
      name: "Gesundheit Pflege",
    }),
  ).toBeVisible();
  return card;
}

async function submitContactRequest(
  card: Locator,
  input: Readonly<{ subject: string; message: string }>,
) {
  await card.getByRole("button", { name: "Kontakt anfragen" }).click();
  const dialog = card.page().getByRole("dialog", {
    name: "Kontaktanfrage senden",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Betreff").fill(input.subject);
  await dialog.getByLabel("Nachricht").fill(input.message);
  await dialog
    .getByRole("button", { name: "1 Credit einsetzen" })
    .click();
  return dialog;
}

async function assertCandidateCardIsAnonymous(
  card: Locator,
  scenario: Readonly<{
    firstName: string;
    lastName: string;
    publicDisplayName: string;
  }>,
) {
  await expect(card).not.toContainText(scenario.firstName);
  await expect(card).not.toContainText(scenario.lastName);
  await expect(card).not.toContainText(scenario.publicDisplayName);
  await expect(card).not.toContainText(TARGET_CANDIDATE_EMAIL);
}

async function assertEmployerRequestIsAnonymous(
  page: Page,
  scenario: Readonly<{
    firstName: string;
    lastName: string;
    publicDisplayName: string;
  }>,
) {
  const identityCard = page
    .locator('[data-slot="card"]')
    .filter({
      has: page.getByRole("heading", { name: "Identitätsfreigabe" }),
    });
  await expect(identityCard).toHaveCount(1);
  await expect(
    identityCard.getByText(ANONYMOUS_IDENTITY_NOTICE, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(identityCard).not.toContainText(scenario.firstName);
  await expect(identityCard).not.toContainText(scenario.lastName);
  await expect(identityCard).not.toContainText(scenario.publicDisplayName);
  await expect(identityCard).not.toContainText(TARGET_CANDIDATE_EMAIL);
}

function companyContactConsumeCount(
  database: Database,
  companyId: string,
) {
  return database.creditLedgerEntry.count({
    where: {
      kind: "CONSUME",
      account: {
        companyId,
        creditType: "TALENT_CONTACT",
      },
    },
  });
}

async function companyCandidateRequestIds(
  database: Database,
  scenario: Readonly<{
    companyId: string;
    candidateProfileId: string;
  }>,
) {
  const requests = await database.employerContactRequest.findMany({
    where: {
      companyId: scenario.companyId,
      candidateProfileId: scenario.candidateProfileId,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return requests.map(({ id }) => id);
}

async function closeActor(actor: Actor) {
  await actor.close();
}
