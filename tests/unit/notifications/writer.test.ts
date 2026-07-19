import { describe, expect, it, vi } from "vitest";

import {
  NotificationInputValidationError,
  buildNotificationPersistenceRecord,
  buildNotificationStorageDedupeKey,
  writeNotificationExactlyOnce,
  type NotificationPersistenceRecord,
  type NotificationWritePort,
} from "@/lib/notifications/writer";

const recipientUserId = "11111111-1111-4111-8111-111111111111";
const otherRecipientUserId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";

const BASE_INPUT = Object.freeze({
  dedupeKey: "application-submitted:33333333",
  kind: "APPLICATION_SUBMITTED",
  payload: Object.freeze({ applicationId, status: "SUBMITTED" }),
  recipientUserId,
} as const);

type StoredRow = Readonly<{
  data: NotificationPersistenceRecord;
  id: string;
}>;

function createMemoryPort() {
  const rows = new Map<string, StoredRow>();
  const upsert = vi.fn<
    NotificationWritePort<StoredRow>["notification"]["upsert"]
  >(async ({ create }) => {
    const existing = rows.get(create.dedupeKey);
    if (existing) {
      return existing;
    }
    const row = Object.freeze({ data: create, id: `row-${rows.size + 1}` });
    rows.set(create.dedupeKey, row);
    return row;
  });
  const port: NotificationWritePort<StoredRow> = {
    notification: { upsert },
  };
  return { port, rows, upsert };
}

describe("notification writer contract", () => {
  it("stores a strict V1 payload with a privacy-preserving global dedupe key", async () => {
    const { port, upsert } = createMemoryPort();

    const row = await writeNotificationExactlyOnce(port, BASE_INPUT);

    expect(row.data).toEqual({
      dedupeKey: expect.stringMatching(/^notification-v1:[a-f0-9]{64}$/),
      kind: "APPLICATION_SUBMITTED",
      payload: { applicationId, status: "SUBMITTED" },
      recipientUserId,
      schemaVersion: "1",
    });
    expect(row.data.dedupeKey).not.toContain(BASE_INPUT.dedupeKey);
    expect(upsert).toHaveBeenCalledWith({
      create: row.data,
      update: {},
      where: {
        recipientUserId_kind_dedupeKey: {
          recipientUserId,
          kind: "APPLICATION_SUBMITTED",
          dedupeKey: row.data.dedupeKey,
        },
      },
    });
  });

  it("returns the same row for retries of the same recipient, kind and key", async () => {
    const { port, rows, upsert } = createMemoryPort();

    const first = await writeNotificationExactlyOnce(port, BASE_INPUT);
    const retry = await writeNotificationExactlyOnce(port, BASE_INPUT);

    expect(retry).toBe(first);
    expect(rows).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("scopes idempotency by recipient and notification kind", () => {
    const same = buildNotificationStorageDedupeKey(BASE_INPUT);
    const otherRecipient = buildNotificationStorageDedupeKey({
      ...BASE_INPUT,
      recipientUserId: otherRecipientUserId,
    });
    const otherKind = buildNotificationStorageDedupeKey({
      ...BASE_INPUT,
      kind: "MESSAGE_RECEIVED",
    });

    expect(otherRecipient).not.toBe(same);
    expect(otherKind).not.toBe(same);
    expect(otherKind).not.toBe(otherRecipient);
  });

  it("rejects invalid payloads before persistence without leaking content", async () => {
    const piiCanary = "candidate-private-message-canary";
    const { port, upsert } = createMemoryPort();

    try {
      await writeNotificationExactlyOnce(port, {
        ...BASE_INPUT,
        payload: { ...BASE_INPUT.payload, message: piiCanary },
      });
      expect.unreachable("PII-bearing payload must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationInputValidationError);
      expect(String(error)).not.toContain(piiCanary);
      expect(JSON.stringify(error)).not.toContain(piiCanary);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects extra top-level fields and malformed runtime enum or ids", () => {
    expect(() =>
      buildNotificationPersistenceRecord({
        ...BASE_INPUT,
        rawEmail: "private@example.test",
      } as typeof BASE_INPUT),
    ).toThrow(NotificationInputValidationError);
    expect(() =>
      buildNotificationPersistenceRecord({
        ...BASE_INPUT,
        recipientUserId: "not-a-uuid",
      }),
    ).toThrow(NotificationInputValidationError);
    expect(() =>
      buildNotificationPersistenceRecord({
        ...BASE_INPUT,
        kind: "ARBITRARY_KIND",
      } as unknown as Parameters<
        typeof buildNotificationPersistenceRecord
      >[0]),
    ).toThrow(NotificationInputValidationError);
  });
});
