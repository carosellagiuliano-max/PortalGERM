// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_REFRESH_AFTER_HEADER,
  SESSION_REFRESH_STATE_HEADER,
  SESSION_REFRESH_STATES,
} from "@/lib/auth/session-refresh-contract";

const NOW = new Date("2026-08-04T00:00:00.000Z");
const cookieStore = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(() => ({ value: "A".repeat(43) })),
  set: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  getCurrentAuthContext: vi.fn(),
  rotateSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentAuthContext: mocks.getCurrentAuthContext,
}));
vi.mock("@/lib/auth/session", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/session")>(
      "@/lib/auth/session",
    );
  return { ...actual, rotateSession: mocks.rotateSession };
});
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: vi.fn(async () => ({})),
  isValidAuthMutationOrigin: vi.fn(() => true),
  shouldUseSecureAuthCookies: vi.fn(() => true),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: vi.fn(() => ({
    APP_ENV: "production",
    secrets: {
      session: {
        withValue: (consumer: (value: string) => unknown) =>
          consumer(Buffer.alloc(32, 0x41).toString("base64")),
      },
    },
  })),
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));

import { POST } from "@/app/(auth)/session/refresh/route";

describe("session refresh route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    cookieStore.set.mockReset();
    cookieStore.delete.mockReset();
    mocks.rotateSession.mockReset();
    mocks.getCurrentAuthContext.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("does not overwrite a newly rotated cookie when a racing old-token request gets 401", async () => {
    mocks.getCurrentAuthContext.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get(SESSION_REFRESH_AFTER_HEADER)).toBe("1000");
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("returns a server-authoritative delay when rotation is not due", async () => {
    mocks.getCurrentAuthContext.mockResolvedValue(authContext(NOW));

    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get(SESSION_REFRESH_AFTER_HEADER)).toBe(
      String(24 * 60 * 60 * 1_000),
    );
    expect(response.headers.get(SESSION_REFRESH_STATE_HEADER)).toBe(
      SESSION_REFRESH_STATES.current,
    );
    expect(mocks.rotateSession).not.toHaveBeenCalled();
  });

  it("marks a newly staged token so the browser confirms it immediately", async () => {
    const dueAt = new Date(NOW.getTime() - 24 * 60 * 60 * 1_000);
    mocks.getCurrentAuthContext.mockResolvedValue(authContext(dueAt));
    mocks.rotateSession.mockResolvedValue({
      token: "B".repeat(43),
      record: {
        absoluteExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000),
      },
    });

    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get(SESSION_REFRESH_STATE_HEADER)).toBe(
      SESSION_REFRESH_STATES.staged,
    );
    expect(cookieStore.set).toHaveBeenCalledOnce();
  });

  it("never upgrades a racing previous-token bearer to the current token", async () => {
    mocks.getCurrentAuthContext.mockResolvedValue({
      ...authContext(NOW),
      session: {
        ...authContext(NOW).session,
        presentedTokenState: "PREVIOUS",
      },
    });
    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.headers.get(SESSION_REFRESH_AFTER_HEADER)).toBe("60000");
    expect(response.headers.get(SESSION_REFRESH_STATE_HEADER)).toBeNull();
    expect(mocks.rotateSession).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("bounds a promotion conflict retry instead of returning the pending credential lifetime", async () => {
    const dueAt = new Date(NOW.getTime() - 24 * 60 * 60 * 1_000);
    mocks.getCurrentAuthContext.mockResolvedValue(authContext(dueAt));
    mocks.rotateSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.headers.get(SESSION_REFRESH_AFTER_HEADER)).toBe("60000");
  });
});

function authContext(rotationBase: Date) {
  return {
    user: { id: "user" },
    session: {
      id: "session",
      userId: "user",
      presentedTokenState: "CURRENT",
      createdAt: rotationBase,
      rotatedAt: null,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
      activePortal: "CANDIDATE",
      activeCompanyId: null,
      contextVersion: 1,
      contextChangedAt: NOW,
    },
  };
}
