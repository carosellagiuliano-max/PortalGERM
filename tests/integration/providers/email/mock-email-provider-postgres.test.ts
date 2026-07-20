import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabaseClient } from "@/lib/db/factory";
import {
  LocalMockMailbox,
  type LocalMockMailboxCaptureInput,
} from "@/lib/providers/email/local-mock-mailbox-core";
import {
  EmailLogIdempotencyConflictError,
  MockEmailProvider,
} from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type Database = ReturnType<typeof createDatabaseClient>;

const resetRecipient = "phase04-email-reset@example.test";
const invitationRecipient = "phase04-email-invite@example.test";
const testRecipients = [resetRecipient, invitationRecipient];

describe("PostgreSQL MockEmailProvider contract", () => {
  let migrated: MigratedDatabase;
  let database: Database;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase04_mock_email");
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
  });

  beforeEach(async () => {
    await database.emailLog.deleteMany({
      where: { recipient: { in: testRecipients } },
    });
  });

  afterAll(async () => {
    if (database !== undefined) {
      await database.emailLog.deleteMany({
        where: { recipient: { in: testRecipients } },
      });
      await database.$disconnect();
    }
    if (migrated !== undefined) {
      await migrated.dispose();
    }
  });

  it("atomically dedupes concurrent reset retries and persists no token or URL", async () => {
    const rawToken = "postgres-reset-token-canary-never-persist";
    const resetUrl =
      `http://127.0.0.1:3000/reset-password?token=${rawToken}`;
    const secret = Buffer.alloc(40, 31).toString("base64");
    const mailbox = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      secret,
    });
    const provider = new MockEmailProvider(
      new PrismaEmailLogRepository(database),
      {
        mailbox: {
          validate: (input: LocalMockMailboxCaptureInput) => {
            mailbox.validate(input);
          },
          capture: (input: LocalMockMailboxCaptureInput) => {
            mailbox.capture(input);
          },
        },
      },
    );
    const input = {
      to: resetRecipient,
      templateKey: "password_reset_mock" as const,
      data: {
        firstName: rawToken,
        idempotencyKey: "reset-row-version-20260720",
        resetUrl,
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    };

    const results = await Promise.all(
      Array.from({ length: 12 }, () => provider.send(input)),
    );
    expect(new Set(results.map(({ logId }) => logId))).toHaveLength(1);

    const rows = await database.emailLog.findMany({
      where: { recipient: resetRecipient },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "password_reset_mock",
      templateKey: "password_reset_mock",
      status: "MOCK_RECORDED",
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(resetUrl);
    expect(serialized).not.toMatch(/https?:\/\//i);

    await expect(
      provider.send({
        ...input,
        data: {
          ...input.data,
          resetUrl:
            "http://127.0.0.1:3000/reset-password?token=different-token-that-is-at-least-thirty-two-bytes",
        },
      }),
    ).rejects.toThrow(EmailLogIdempotencyConflictError);
    await expect(
      database.emailLog.count({ where: { recipient: resetRecipient } }),
    ).resolves.toBe(1);

    const firstRead = mailbox.consume(`Bearer ${secret}`);
    expect(firstRead).toMatchObject({
      status: "delivered",
      envelope: { actionUrl: resetUrl },
    });
    expect(mailbox.consume(`Bearer ${secret}`)).toEqual({ status: "empty" });
  });

  it("dedupes one invitation version while recording a rotated version separately", async () => {
    const provider = new MockEmailProvider(
      new PrismaEmailLogRepository(database),
    );
    const sendInvitation = (version: string, rawToken: string) =>
      provider.send({
        to: invitationRecipient,
        templateKey: "company_invitation",
        data: {
          companyName: "Phase 04 Beispiel AG",
          invitationVersion: version,
          invitationUrl:
            `http://127.0.0.1:3000/invitations/${rawToken}`,
        },
        subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
      });

    const firstToken = "raw-first-token-that-is-at-least-thirty-two-bytes";
    const secondToken = "raw-second-token-that-is-at-least-thirty-two-bytes";
    const first = await sendInvitation("invitation-version-1", firstToken);
    const retry = await sendInvitation("invitation-version-1", firstToken);
    const rotated = await sendInvitation("invitation-version-2", secondToken);

    expect(retry.logId).toBe(first.logId);
    expect(rotated.logId).not.toBe(first.logId);
    const rows = await database.emailLog.findMany({
      where: { recipient: invitationRecipient },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every(({ status }) => status === "MOCK_RECORDED")).toBe(true);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(firstToken);
    expect(serialized).not.toContain(secondToken);
    expect(serialized).not.toMatch(/https?:\/\//i);
  });
});
