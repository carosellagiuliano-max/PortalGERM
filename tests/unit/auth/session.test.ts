// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { KeyringEntry, SecretHandle } from "@/lib/config/env-schema";

import {
  clearSessionCookie,
  createSession,
  deriveRotatedSessionToken,
  destroySession,
  getSessionCookieOptions,
  getSessionRotationDueAt,
  hashSessionToken,
  isSessionRotationDue,
  readSession,
  readSessionCookie,
  rotateSession,
  SESSION_POLICY_V1,
  writeSessionCookie,
  type SessionCreateRecord,
  type SessionRecord,
  type SessionStore,
} from "@/lib/auth/session";
import { hashIp } from "@/lib/utils/hash";

class MemorySessionStore implements SessionStore {
  records = new Map<string, SessionRecord>();
  counter = 0;

  async create(input: SessionCreateRecord) {
    this.counter += 1;
    const record: SessionRecord = {
      ...input,
      id: `session-${this.counter}`,
      pendingTokenHash: null,
      pendingTokenExpiresAt: null,
      previousTokenHash: null,
      previousTokenExpiresAt: null,
      rotatedAt: null,
      revokedAt: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  async findByTokenHash(tokenHash: string, now: Date) {
    return (
      [...this.records.values()].find(
        (record) =>
          !record.revokedAt &&
          record.expiresAt > now &&
          record.absoluteExpiresAt > now &&
          (record.tokenHash === tokenHash ||
            (record.pendingTokenHash === tokenHash &&
              record.pendingTokenExpiresAt !== null &&
              record.pendingTokenExpiresAt > now) ||
            (record.previousTokenHash === tokenHash &&
              record.previousTokenExpiresAt !== null &&
              record.previousTokenExpiresAt > now)),
      ) ?? null
    );
  }

  async touch(id: string, expiresAt: Date) {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, expiresAt });
  }

  async stageRotation(
    id: string,
    currentTokenHash: string,
    pendingTokenHash: string,
    stagedAt: Date,
    pendingTokenExpiresAt: Date,
    expiresAt: Date,
  ) {
    const record = this.records.get(id);
    if (
      record?.tokenHash === currentTokenHash &&
      record.pendingTokenHash === pendingTokenHash &&
      record.pendingTokenExpiresAt !== null &&
      record.pendingTokenExpiresAt > stagedAt &&
      !record.revokedAt
    ) {
      return record;
    }
    if (
      !record ||
      record.tokenHash !== currentTokenHash ||
      record.revokedAt ||
      (record.pendingTokenHash !== null &&
        record.pendingTokenExpiresAt !== null &&
        record.pendingTokenExpiresAt > stagedAt)
    ) {
      return null;
    }
    const staged = {
      ...record,
      pendingTokenHash,
      pendingTokenExpiresAt,
      expiresAt,
    };
    this.records.set(id, staged);
    return staged;
  }

  async promotePendingToken(
    id: string,
    pendingTokenHash: string,
    promotedAt: Date,
    previousTokenExpiresAt: Date,
    expiresAt: Date,
  ) {
    const record = this.records.get(id);
    if (
      !record ||
      record.pendingTokenHash !== pendingTokenHash ||
      record.pendingTokenExpiresAt === null ||
      record.pendingTokenExpiresAt <= promotedAt ||
      record.revokedAt
    ) {
      return null;
    }
    const promoted = {
      ...record,
      tokenHash: pendingTokenHash,
      pendingTokenHash: null,
      pendingTokenExpiresAt: null,
      previousTokenHash: record.tokenHash,
      previousTokenExpiresAt,
      rotatedAt: promotedAt,
      expiresAt,
    };
    this.records.set(id, promoted);
    return promoted;
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date) {
    const record = [...this.records.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash ||
        candidate.pendingTokenHash === tokenHash ||
        candidate.previousTokenHash === tokenHash,
    );
    if (record) this.records.set(record.id, { ...record, revokedAt });
  }

  async revokeAllForUser(userId: string, revokedAt: Date) {
    for (const record of this.records.values()) {
      if (record.userId === userId && !record.revokedAt) {
        this.records.set(record.id, { ...record, revokedAt });
      }
    }
  }
}

const NOW = new Date("2026-07-19T10:00:00.000Z");
const SESSION_ROTATION_KEY = {
  withValue: <T>(consumer: (value: string) => T) =>
    consumer(Buffer.alloc(32, 0x5a).toString("base64")),
} as unknown as SecretHandle<"SESSION_SECRET">;
const SESSION_IP_KEYRING = [
  {
    version: "audit-test-v1",
    key: {
      withValue: <T>(consumer: (value: string) => T) =>
        consumer("session-ip-secret"),
    },
  },
] as unknown as readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];

describe("opaque session lifecycle", () => {
  it("derives a stable domain-separated successor without exposing key material", () => {
    const token = "A".repeat(43);
    const successor = deriveRotatedSessionToken(token, SESSION_ROTATION_KEY);

    expect(successor).toHaveLength(43);
    expect(successor).toBe(
      deriveRotatedSessionToken(token, SESSION_ROTATION_KEY),
    );
    expect(successor).not.toBe(token);
    expect(
      deriveRotatedSessionToken("B".repeat(43), SESSION_ROTATION_KEY),
    ).not.toBe(successor);
  });

  it("stores only a token hash and returns secure cookie metadata", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: true, userAgent: "test" },
      { store, clock: { now: NOW } },
    );

    expect(created.token).toHaveLength(43);
    expect(created.record.tokenHash).toBe(hashSessionToken(created.token));
    expect(JSON.stringify(created.record)).not.toContain(created.token);
    expect(created.cookie).toMatchObject({
      name: "session",
      options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    });
    expect(
      getSessionCookieOptions(created.record.absoluteExpiresAt, false).secure,
    ).toBe(false);
  });

  it("hashes a source IP internally and rejects invalid or unkeyed input", async () => {
    const store = new MemorySessionStore();
    const sourceIp = "2001:0db8:0:0:0:0:0:1";
    const created = await createSession(
      {
        userId: "user-ip",
        production: false,
        ipContext: { sourceIp, keyring: SESSION_IP_KEYRING },
      },
      { store, clock: { now: NOW } },
    );

    expect(created.record.ipHash).toBe(
      hashIp(sourceIp, {
        version: "audit-test-v1",
        secret: "session-ip-secret",
      }),
    );
    expect(JSON.stringify(created.record)).not.toContain(sourceIp);
    await expect(
      createSession(
        {
          userId: "user-unkeyed",
          production: false,
          ipContext: { sourceIp: "192.0.2.1", keyring: [] },
        },
        { store, clock: { now: NOW } },
      ),
    ).rejects.toThrow("AUDIT_IP_HASH_KEYS requires an active writer key");
    await expect(
      createSession(
        {
          userId: "user-invalid-ip",
          production: false,
          ipContext: { sourceIp: "not-an-ip", keyring: SESSION_IP_KEYRING },
        },
        { store, clock: { now: NOW } },
      ),
    ).rejects.toThrow(TypeError);
  });

  it("enforces half-open idle and absolute expiry boundaries", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: false },
      { store, clock: { now: NOW } },
    );
    expect(
      await readSession(created.token, { store, clock: { now: NOW } }),
    ).not.toBeNull();

    const idleBoundary = new Date(
      NOW.getTime() + SESSION_POLICY_V1.idleTtlMilliseconds,
    );
    const untouchedStore = new MemorySessionStore();
    const untouched = await createSession(
      { userId: "user-2", production: false },
      { store: untouchedStore, clock: { now: NOW } },
    );
    expect(
      await readSession(untouched.token, {
        store: untouchedStore,
        clock: { now: idleBoundary },
      }),
    ).toBeNull();

    const record = store.records.get(created.record.id) as SessionRecord;
    store.records.set(record.id, {
      ...record,
      expiresAt: record.absoluteExpiresAt,
    });
    expect(
      await readSession(created.token, {
        store,
        clock: { now: new Date(record.absoluteExpiresAt) },
      }),
    ).toBeNull();
  });

  it("stages, promotes and briefly overlaps a rotated token", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: false },
      { store, clock: { now: NOW } },
    );
    const beforeRotation = new Date(
      created.record.createdAt.getTime() +
        SESSION_POLICY_V1.rotationAgeMilliseconds -
        1,
    );
    expect(isSessionRotationDue(created.record, beforeRotation)).toBe(false);
    await expect(
      rotateSession(created.token, {
        store,
        clock: { now: beforeRotation },
        rotationKey: SESSION_ROTATION_KEY,
      }),
    ).resolves.toBeNull();

    const later = new Date(
      created.record.createdAt.getTime() +
        SESSION_POLICY_V1.rotationAgeMilliseconds,
    );
    expect(getSessionRotationDueAt(created.record)).toEqual(later);
    expect(isSessionRotationDue(created.record, later)).toBe(true);
    const rotated = await rotateSession(created.token, {
      store,
      clock: { now: later },
      rotationKey: SESSION_ROTATION_KEY,
    });
    expect(rotated).not.toBeNull();
    if (rotated === null) throw new Error("Expected staged rotation.");
    expect(rotated.record).toMatchObject({
      tokenHash: hashSessionToken(created.token),
      pendingTokenHash: hashSessionToken(rotated.token),
      rotatedAt: null,
    });
    expect(
      await readSession(created.token, { store, clock: { now: later } }),
    ).not.toBeNull();
    expect(
      await readSession(rotated.token, { store, clock: { now: later } }),
    ).not.toBeNull();
    expect(
      await readSession(created.token, { store, clock: { now: later } }),
    ).not.toBeNull();
    const afterTransition = new Date(
      later.getTime() + SESSION_POLICY_V1.rotationTransitionMilliseconds,
    );
    expect(
      await readSession(created.token, {
        store,
        clock: { now: afterTransition },
      }),
    ).toBeNull();
    expect(
      await readSession(rotated.token, {
        store,
        clock: { now: afterTransition },
      }),
    ).not.toBeNull();
    await destroySession(rotated.token, {
      store,
      clock: { now: afterTransition },
    });
    expect(
      await readSession(rotated.token, {
        store,
        clock: { now: afterTransition },
      }),
    ).toBeNull();
  });

  it("keeps the current token valid when a staged rotation response is lost", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: false },
      { store, clock: { now: NOW } },
    );
    const dueAt = getSessionRotationDueAt(created.record);
    const staged = await rotateSession(created.token, {
      store,
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    expect(staged).not.toBeNull();
    if (staged === null) throw new Error("Expected staged rotation.");
    const repeated = await rotateSession(created.token, {
      store,
      clock: { now: new Date(dueAt.getTime() + 1) },
      rotationKey: SESSION_ROTATION_KEY,
    });
    expect(repeated?.token).toBe(staged.token);
    expect(repeated?.record.pendingTokenHash).toBe(
      staged.record.pendingTokenHash,
    );

    const afterTransitionWindow = new Date(
      dueAt.getTime() + SESSION_POLICY_V1.rotationTransitionMilliseconds + 1,
    );
    expect(staged.record.pendingTokenExpiresAt).toEqual(
      staged.record.expiresAt,
    );
    await expect(
      readSession(created.token, {
        store,
        clock: { now: afterTransitionWindow },
      }),
    ).resolves.not.toBeNull();
  });

  it("revokes a staged successor when logout races with rotation", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: false },
      { store, clock: { now: NOW } },
    );
    const dueAt = getSessionRotationDueAt(created.record);
    const staged = await rotateSession(created.token, {
      store,
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    expect(staged).not.toBeNull();
    if (staged === null) throw new Error("Expected staged rotation.");

    await destroySession(created.token, { store, clock: { now: dueAt } });
    await expect(
      readSession(staged.token, { store, clock: { now: dueAt } }),
    ).resolves.toBeNull();
  });

  it("reads, writes and clears the canonical cookie through a narrow port", async () => {
    const store = new MemorySessionStore();
    const created = await createSession(
      { userId: "user-1", production: false },
      { store, clock: { now: NOW } },
    );
    const values = new Map<string, string>();
    const cookies = {
      get: (name: string) =>
        values.has(name) ? { value: values.get(name) as string } : undefined,
      set: (name: string, value: string) => {
        values.set(name, value);
      },
      delete: (name: string) => {
        values.delete(name);
      },
    };
    writeSessionCookie(cookies, created);
    expect(readSessionCookie(cookies)).toBe(created.token);
    clearSessionCookie(cookies);
    expect(readSessionCookie(cookies)).toBeUndefined();
  });
});
