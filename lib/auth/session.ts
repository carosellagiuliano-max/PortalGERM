import { createHash, createHmac, randomBytes } from "node:crypto";

import type { KeyringEntry, SecretHandle } from "@/lib/config/env-schema";
import { hashIpWithFirstKey } from "@/lib/utils/hash";
import type { PortalContextV2 } from "@/lib/auth/persona-policy";

export const SESSION_POLICY_V1 = Object.freeze({
  cookieName: "session",
  idleTtlMilliseconds: 7 * 24 * 60 * 60 * 1_000,
  absoluteTtlMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  rotationAgeMilliseconds: 24 * 60 * 60 * 1_000,
  rotationTransitionMilliseconds: 2 * 60 * 1_000,
  tokenBytes: 32,
});

export type SessionRecord = Readonly<{
  id: string;
  userId: string;
  tokenHash: string;
  pendingTokenHash: string | null;
  pendingTokenExpiresAt: Date | null;
  previousTokenHash: string | null;
  previousTokenExpiresAt: Date | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  userAgent: string | null;
  ipHash: string | null;
  activePortal?: PortalContextV2 | null;
  activeCompanyId?: string | null;
  contextVersion?: number;
  contextChangedAt?: Date | null;
}>;

export type SessionCreateRecord = Omit<
  SessionRecord,
  | "id"
  | "pendingTokenHash"
  | "pendingTokenExpiresAt"
  | "previousTokenHash"
  | "previousTokenExpiresAt"
  | "rotatedAt"
  | "revokedAt"
>;

export interface SessionStore {
  create(input: SessionCreateRecord): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  touch(id: string, expiresAt: Date): Promise<void>;
  stageRotation(
    id: string,
    currentTokenHash: string,
    pendingTokenHash: string,
    stagedAt: Date,
    pendingTokenExpiresAt: Date,
    expiresAt: Date,
  ): Promise<SessionRecord | null>;
  promotePendingToken(
    id: string,
    pendingTokenHash: string,
    promotedAt: Date,
    previousTokenExpiresAt: Date,
    expiresAt: Date,
  ): Promise<SessionRecord | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeAllForUser(userId: string, revokedAt: Date): Promise<void>;
}

export type SessionClock = Readonly<{ now: Date }>;

export type SessionIpContext = Readonly<{
  sourceIp: string;
  keyring: readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];
}>;

export type SessionCookieOptions = Readonly<{
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}>;

export interface SessionCookieReader {
  get(name: string): { value: string } | undefined;
}

export interface SessionCookieWriter extends SessionCookieReader {
  set(name: string, value: string, options: SessionCookieOptions): void;
  delete(name: string): void;
}

export type CreatedSession = Readonly<{
  token: string;
  record: SessionRecord;
  cookie: Readonly<{
    name: string;
    value: string;
    options: SessionCookieOptions;
  }>;
}>;

function assertValidDate(date: Date, label: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be valid.`);
  }
}

export function hashSessionToken(token: string): string {
  if (token.length < 32) {
    throw new TypeError("Session token is malformed.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function activeSessionTokenHashWhere(tokenHash: string, now: Date) {
  if (!/^[a-f0-9]{64}$/u.test(tokenHash)) {
    throw new TypeError("Session token hash is malformed.");
  }
  assertValidDate(now, "now");
  return {
    revokedAt: null,
    expiresAt: { gt: now },
    absoluteExpiresAt: { gt: now },
    OR: [
      { tokenHash },
      {
        pendingTokenHash: tokenHash,
        pendingTokenExpiresAt: { gt: now },
      },
      {
        previousTokenHash: tokenHash,
        previousTokenExpiresAt: { gt: now },
      },
    ],
  };
}

export function getSessionCookieOptions(
  absoluteExpiresAt: Date,
  production: boolean,
): SessionCookieOptions {
  assertValidDate(absoluteExpiresAt, "absoluteExpiresAt");
  return Object.freeze({
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    expires: new Date(absoluteExpiresAt),
  });
}

export async function createSession(
  input: Readonly<{
    userId: string;
    userAgent?: string | null;
    ipContext?: SessionIpContext | null;
    production: boolean;
  }>,
  dependencies: Readonly<{ store: SessionStore; clock: SessionClock }>,
): Promise<CreatedSession> {
  assertValidDate(dependencies.clock.now, "clock.now");
  const token = randomBytes(SESSION_POLICY_V1.tokenBytes).toString("base64url");
  const absoluteExpiresAt = new Date(
    dependencies.clock.now.getTime() +
      SESSION_POLICY_V1.absoluteTtlMilliseconds,
  );
  const expiresAt = new Date(
    dependencies.clock.now.getTime() + SESSION_POLICY_V1.idleTtlMilliseconds,
  );
  const record = await dependencies.store.create({
    userId: input.userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    absoluteExpiresAt,
    createdAt: new Date(dependencies.clock.now),
    userAgent: input.userAgent?.slice(0, 512) ?? null,
    ipHash:
      input.ipContext == null
        ? null
        : hashIpWithFirstKey(
            input.ipContext.sourceIp,
            input.ipContext.keyring,
            "AUDIT_IP_HASH_KEYS",
          ),
    activePortal: null,
    activeCompanyId: null,
    contextVersion: 1,
    contextChangedAt: new Date(dependencies.clock.now),
  });
  const options = getSessionCookieOptions(absoluteExpiresAt, input.production);

  return Object.freeze({
    token,
    record,
    cookie: Object.freeze({
      name: SESSION_POLICY_V1.cookieName,
      value: token,
      options,
    }),
  });
}

export async function readSession(
  token: string | undefined,
  dependencies: Readonly<{ store: SessionStore; clock: SessionClock }>,
): Promise<SessionRecord | null> {
  if (token === undefined || token.length < 32) {
    return null;
  }
  const nowMs = dependencies.clock.now.getTime();
  const presentedTokenHash = hashSessionToken(token);
  let record = await dependencies.store.findByTokenHash(
    presentedTokenHash,
    dependencies.clock.now,
  );
  if (!isActiveSessionRecord(record, nowMs)) {
    return null;
  }

  if (record.pendingTokenHash === presentedTokenHash) {
    const expiresAt = new Date(
      Math.min(
        nowMs + SESSION_POLICY_V1.idleTtlMilliseconds,
        record.absoluteExpiresAt.getTime(),
      ),
    );
    record = await dependencies.store.promotePendingToken(
      record.id,
      presentedTokenHash,
      dependencies.clock.now,
      new Date(
        Math.min(
          nowMs + SESSION_POLICY_V1.rotationTransitionMilliseconds,
          record.absoluteExpiresAt.getTime(),
        ),
      ),
      expiresAt,
    );
    if (record === null) {
      record = await dependencies.store.findByTokenHash(
        presentedTokenHash,
        dependencies.clock.now,
      );
      if (!isActiveSessionRecord(record, nowMs)) return null;
    }
  }

  const extendedIdle = Math.min(
    nowMs + SESSION_POLICY_V1.idleTtlMilliseconds,
    record.absoluteExpiresAt.getTime(),
  );
  if (extendedIdle > record.expiresAt.getTime()) {
    await dependencies.store.touch(record.id, new Date(extendedIdle));
    return Object.freeze({ ...record, expiresAt: new Date(extendedIdle) });
  }
  return record;
}

function isActiveSessionRecord(
  record: SessionRecord | null,
  nowMilliseconds: number,
): record is SessionRecord {
  return (
    record !== null &&
    record.revokedAt === null &&
    nowMilliseconds < record.expiresAt.getTime() &&
    nowMilliseconds < record.absoluteExpiresAt.getTime()
  );
}

export async function rotateSession(
  token: string,
  dependencies: Readonly<{
    store: SessionStore;
    clock: SessionClock;
    rotationKey: SecretHandle<"SESSION_SECRET">;
  }>,
): Promise<Readonly<{ token: string; record: SessionRecord }> | null> {
  const record = await readSession(token, dependencies);
  const currentTokenHash = hashSessionToken(token);
  if (
    record === null ||
    record.tokenHash !== currentTokenHash ||
    !isSessionRotationDue(record, dependencies.clock.now)
  ) {
    return null;
  }
  const nextToken = deriveRotatedSessionToken(token, dependencies.rotationKey);
  const nextHash = hashSessionToken(nextToken);
  const expiresAt = new Date(
    Math.min(
      dependencies.clock.now.getTime() + SESSION_POLICY_V1.idleTtlMilliseconds,
      record.absoluteExpiresAt.getTime(),
    ),
  );
  const stagedAt = dependencies.clock.now;
  const staged = await dependencies.store.stageRotation(
    record.id,
    currentTokenHash,
    nextHash,
    stagedAt,
    expiresAt,
    expiresAt,
  );
  return staged
    ? Object.freeze({
        token: nextToken,
        record: staged,
      })
    : null;
}

export function deriveRotatedSessionToken(
  token: string,
  rotationKey: SecretHandle<"SESSION_SECRET">,
): string {
  if (token.length < 32) throw new TypeError("Session token is malformed.");
  return rotationKey.withValue((encodedKey) =>
    createHmac("sha256", Buffer.from(encodedKey, "base64"))
      .update("SwissTalentHub/session-rotation/v1\0", "utf8")
      .update(token, "utf8")
      .digest("base64url"),
  );
}

export function isSessionRotationDue(
  record: Pick<SessionRecord, "createdAt" | "rotatedAt">,
  now: Date,
): boolean {
  assertValidDate(now, "now");
  return now.getTime() >= getSessionRotationDueAt(record).getTime();
}

export function getSessionRotationDueAt(
  record: Pick<SessionRecord, "createdAt" | "rotatedAt">,
): Date {
  const rotationBase = record.rotatedAt ?? record.createdAt;
  assertValidDate(rotationBase, "session rotation timestamp");
  return new Date(
    rotationBase.getTime() + SESSION_POLICY_V1.rotationAgeMilliseconds,
  );
}

export async function destroySession(
  token: string | undefined,
  dependencies: Readonly<{ store: SessionStore; clock: SessionClock }>,
): Promise<void> {
  if (token !== undefined && token.length >= 32) {
    await dependencies.store.revokeByTokenHash(
      hashSessionToken(token),
      dependencies.clock.now,
    );
  }
}

export function readSessionCookie(
  cookies: SessionCookieReader,
): string | undefined {
  return cookies.get(SESSION_POLICY_V1.cookieName)?.value;
}

export function writeSessionCookie(
  cookies: SessionCookieWriter,
  created: CreatedSession,
): void {
  cookies.set(
    created.cookie.name,
    created.cookie.value,
    created.cookie.options,
  );
}

export function clearSessionCookie(cookies: SessionCookieWriter): void {
  cookies.delete(SESSION_POLICY_V1.cookieName);
}
