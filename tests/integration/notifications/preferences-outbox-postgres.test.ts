import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { setNotificationPreference } from "@/lib/notifications/preferences";
import type {
  EmailDeliveryProvider,
  EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE20_NOW,
  createPhase20User,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase20_notification_preferences");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = phase20Environment(migrated.connectionString, {
    EMAIL_PROVIDER_MODE: "local_mock",
    NOTIFICATION_DISPATCH: "command",
    OPTIONAL_EMAIL: "true",
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe.sequential("Phase 20 notification preferences and outbox", () => {
  it.each([
    ["CANDIDATE", "preference-candidate@example.test"],
    ["EMPLOYER", "preference-employer@example.test"],
  ] as const)(
    "versions %s self-service changes with one event and one audit",
    async (role, email) => {
      const user = await createPhase20User(db(), {
        email,
        role,
        verified: true,
      });
      const created = await setNotificationPreference(
        {
          userId: user.id,
          actorUserId: user.id,
          purpose: "JOB_ALERT",
          enabled: true,
          expectedVersion: 0,
          reasonCode: "USER_SETTINGS",
        },
        dependencies(1),
      );
      expect(created).toMatchObject({
        ok: true,
        preference: { enabled: true, version: 1 },
      });
      const updated = await setNotificationPreference(
        {
          userId: user.id,
          actorUserId: user.id,
          purpose: "JOB_ALERT",
          enabled: false,
          expectedVersion: 1,
          reasonCode: "USER_SETTINGS",
        },
        dependencies(2),
      );
      expect(updated).toMatchObject({
        ok: true,
        preference: { enabled: false, version: 2 },
      });
      expect(
        await db().notificationPreferenceEvent.findMany({
          where: { userId: user.id },
          orderBy: { version: "asc" },
          select: {
            enabled: true,
            version: true,
            actorUserId: true,
            reasonCode: true,
          },
        }),
      ).toEqual([
        {
          enabled: true,
          version: 1,
          actorUserId: user.id,
          reasonCode: "USER_SETTINGS",
        },
        {
          enabled: false,
          version: 2,
          actorUserId: user.id,
          reasonCode: "USER_SETTINGS",
        },
      ]);
      expect(
        await db().auditLog.count({
          where: {
            actorUserId: user.id,
            action: "NOTIFICATION_PREFERENCE_CHANGED",
          },
        }),
      ).toBe(2);
    },
  );

  it("denies mandatory purposes, cross-user writes and stale versions before mutation", async () => {
    const owner = await createPhase20User(db(), {
      email: "preference-owner@example.test",
      verified: true,
    });
    const attacker = await createPhase20User(db(), {
      email: "preference-attacker@example.test",
      verified: true,
    });
    await expect(
      setNotificationPreference(
        {
          userId: owner.id,
          actorUserId: owner.id,
          purpose: "PASSWORD_RESET",
          enabled: false,
          reasonCode: "USER_SETTINGS",
        },
        dependencies(10),
      ),
    ).resolves.toEqual({ ok: false, code: "MANDATORY_OR_UNKNOWN" });
    await expect(
      setNotificationPreference(
        {
          userId: owner.id,
          actorUserId: attacker.id,
          purpose: "JOB_ALERT",
          enabled: false,
          reasonCode: "USER_SETTINGS",
        },
        dependencies(11),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await setNotificationPreference(
      {
        userId: owner.id,
        actorUserId: owner.id,
        purpose: "JOB_ALERT",
        enabled: true,
        expectedVersion: 0,
        reasonCode: "USER_SETTINGS",
      },
      dependencies(12),
    );
    await expect(
      setNotificationPreference(
        {
          userId: owner.id,
          actorUserId: owner.id,
          purpose: "JOB_ALERT",
          enabled: false,
          expectedVersion: 0,
          reasonCode: "STALE_FORM",
        },
        dependencies(13),
      ),
    ).resolves.toEqual({ ok: false, code: "VERSION_CONFLICT" });
    expect(
      await db().notificationPreference.findUniqueOrThrow({
        where: {
          userId_purpose_channel: {
            userId: owner.id,
            purpose: "JOB_ALERT",
            channel: "EMAIL",
          },
        },
      }),
    ).toMatchObject({ enabled: true, version: 1 });
  });

  it("rechecks an optional opt-out at dispatch while mandatory mail still sends", async () => {
    const user = await createPhase20User(db(), {
      email: "preference-dispatch@example.test",
      verified: true,
    });
    await setNotificationPreference(
      {
        userId: user.id,
        actorUserId: user.id,
        purpose: "JOB_ALERT",
        enabled: true,
        expectedVersion: 0,
        reasonCode: "USER_SETTINGS",
      },
      dependencies(20),
    );
    await db().$transaction(async (transaction) => {
      await enqueueNotification(transaction, {
        recipient: { userId: user.id },
        templateKey: "job_alert_preview",
        payloadSchemaVersion: "job-alert-v1",
        payload: { alertName: "Phase 20", jobCount: 3 },
        dedupeKey: "phase20-preference-optional",
        availableAt: PHASE20_NOW,
      });
      await enqueueNotification(transaction, {
        recipient: { userId: user.id },
        templateKey: "login_email_changed_notice",
        payloadSchemaVersion: "identity-v1",
        payload: {
          emailChangeId: "20000000-0000-4000-8000-000000000020",
        },
        dedupeKey: "phase20-preference-mandatory",
        availableAt: PHASE20_NOW,
      });
    });
    await setNotificationPreference(
      {
        userId: user.id,
        actorUserId: user.id,
        purpose: "JOB_ALERT",
        enabled: false,
        expectedVersion: 1,
        reasonCode: "USER_SETTINGS",
      },
      dependencies(21),
    );
    // Even a corrupted legacy projection cannot opt a user out of a mandatory
    // purpose; the closed classifier remains authoritative.
    await db().notificationPreference.create({
      data: {
        userId: user.id,
        purpose: "LOGIN_EMAIL_CHANGED_NOTICE",
        channel: "EMAIL",
        enabled: false,
        version: 1,
        createdAt: PHASE20_NOW,
      },
    });

    const provider = new CapturingProvider();
    const result = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "preference-recheck",
      batchSize: 10,
      clock: () => PHASE20_NOW,
    });
    expect(result).toMatchObject({
      claimed: 2,
      delivered: 1,
      suppressed: 1,
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.templateKey).toBe(
      "login_email_changed_notice",
    );
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { dedupeKey: "phase20-preference-optional" },
      }),
    ).toMatchObject({
      status: "SUPPRESSED",
      lastErrorCode: "OPTIONAL_PREFERENCE",
    });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { dedupeKey: "phase20-preference-mandatory" },
      }),
    ).toMatchObject({ status: "DELIVERED" });
  });

  it("fails a tampered unknown template closed without provider access", async () => {
    const user = await createPhase20User(db(), {
      email: "preference-tamper@example.test",
      verified: true,
    });
    const row = await db().$transaction((transaction) =>
      enqueueNotification(transaction, {
        recipient: { userId: user.id },
        templateKey: "login_email_changed_notice",
        payloadSchemaVersion: "identity-v1",
        payload: {
          emailChangeId: "20000000-0000-4000-8000-000000000021",
        },
        dedupeKey: "phase20-template-tamper",
        availableAt: PHASE20_NOW,
      }),
    );
    await db().$executeRaw`
      UPDATE "NotificationOutbox"
         SET "templateKey" = 'unreviewed_template'
       WHERE "id" = ${row.id}::uuid
    `;
    const provider = new CapturingProvider();
    const result = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "template-tamper",
      clock: () => PHASE20_NOW,
    });
    expect(result).toMatchObject({ claimed: 1, deadLettered: 1 });
    expect(provider.requests).toHaveLength(0);
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      status: "DEAD_LETTER",
      lastErrorCode: "TEMPLATE_UNKNOWN",
    });
  });
});

class CapturingProvider implements EmailDeliveryProvider {
  readonly providerClass = "phase20-preference-provider-v1";
  readonly requests: EmailDeliveryRequest[] = [];

  async deliver(input: EmailDeliveryRequest) {
    this.requests.push(input);
    return Object.freeze({
      providerClass: this.providerClass,
      providerReceipt: `preference-receipt-${this.requests.length}`,
      accepted: true as const,
    });
  }
}

function dependencies(index: number) {
  return Object.freeze({
    database: db(),
    environment: env(),
    request: phase20Request(index),
    now: PHASE20_NOW,
  });
}

function db() {
  if (database === undefined) throw new Error("Phase 20 database unavailable.");
  return database;
}

function env() {
  if (environment === undefined) {
    throw new Error("Phase 20 environment unavailable.");
  }
  return environment;
}
