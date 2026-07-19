// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { KeyringEntry } from "@/lib/config/env-schema";

import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionCookieOptions,
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
      rotatedAt: null,
      revokedAt: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  async findByTokenHash(tokenHash: string) {
    return (
      [...this.records.values()].find(
        (record) => record.tokenHash === tokenHash,
      ) ?? null
    );
  }

  async touch(id: string, expiresAt: Date) {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, expiresAt });
  }

  async rotate(
    id: string,
    oldTokenHash: string,
    newTokenHash: string,
    rotatedAt: Date,
    expiresAt: Date,
  ) {
    const record = this.records.get(id);
    if (!record || record.tokenHash !== oldTokenHash || record.revokedAt)
      return false;
    this.records.set(id, {
      ...record,
      tokenHash: newTokenHash,
      rotatedAt,
      expiresAt,
    });
    return true;
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date) {
    const record = await this.findByTokenHash(tokenHash);
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

  it("rotates atomically and revokes old or destroyed tokens", async () => {
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
      }),
    ).resolves.toBeNull();

    const later = new Date(
      created.record.createdAt.getTime() +
        SESSION_POLICY_V1.rotationAgeMilliseconds,
    );
    expect(isSessionRotationDue(created.record, later)).toBe(true);
    const rotated = await rotateSession(created.token, {
      store,
      clock: { now: later },
    });
    expect(rotated).not.toBeNull();
    expect(
      await readSession(created.token, { store, clock: { now: later } }),
    ).toBeNull();
    expect(
      await readSession(rotated?.token, { store, clock: { now: later } }),
    ).not.toBeNull();
    await destroySession(rotated?.token, { store, clock: { now: later } });
    expect(
      await readSession(rotated?.token, { store, clock: { now: later } }),
    ).toBeNull();
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
