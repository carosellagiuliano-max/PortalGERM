// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerEnvironment } = vi.hoisted(() => ({
  getServerEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));

import { GET } from "@/app/(auth)/invite/[token]/route";
import {
  INVITE_RESUME_COOKIE_POLICY_V1,
  readInviteResumeToken,
  type InviteResumeKey,
} from "@/lib/auth/invite-resume";

const TOKEN = "route-invitation-token-that-is-forty-three-chars";
const KEY: InviteResumeKey = Object.freeze({
  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(Buffer.alloc(32, 29).toString("base64"));
  },
});

describe("invitation entry route", () => {
  beforeEach(() => {
    getServerEnvironment.mockReturnValue({
      APP_ENV: "production",
      secrets: { session: KEY },
    });
  });

  it("moves the bearer into a sealed HttpOnly cookie before auth navigation", async () => {
    const before = Date.now();
    const response = await GET(
      new Request(`https://swisstalenthub.test/invite/${TOKEN}`),
      { params: Promise.resolve({ token: TOKEN }) },
    );
    const after = Date.now();
    const setCookie = response.headers.get("set-cookie") ?? "";
    const sealedValue = cookieValue(setCookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://swisstalenthub.test/invite/resume",
    );
    expect(response.headers.get("location")).not.toContain(TOKEN);
    expect(setCookie).not.toContain(TOKEN);
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/Secure/iu);
    expect(setCookie).toMatch(/SameSite=lax/iu);
    expect(setCookie).toMatch(/Path=\/invite/iu);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(
      readInviteResumeToken(sealedValue, new Date(before), KEY),
    ).toBe(TOKEN);
    expect(
      readInviteResumeToken(sealedValue, new Date(after), KEY),
    ).toBe(TOKEN);
  });

  it("clears an earlier resume when the path token is malformed", async () => {
    const response = await GET(
      new Request("https://swisstalenthub.test/invite/short"),
      { params: Promise.resolve({ token: "short" }) },
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://swisstalenthub.test/invite/resume",
    );
    expect(setCookie).toContain(
      `${INVITE_RESUME_COOKIE_POLICY_V1.cookieName}=`,
    );
    expect(setCookie).toMatch(/Max-Age=0/iu);
    expect(setCookie).toMatch(/Path=\/invite/iu);
  });
});

function cookieValue(setCookie: string): string {
  const match = new RegExp(
    `(?:^|,\\s*)${INVITE_RESUME_COOKIE_POLICY_V1.cookieName}=([^;]+)`,
    "u",
  ).exec(setCookie);
  if (match?.[1] === undefined) throw new Error("Resume cookie missing.");
  return match[1];
}
