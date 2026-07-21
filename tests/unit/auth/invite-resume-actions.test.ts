// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptCompanyInvitation: vi.fn(),
  cookies: vi.fn(),
  getAuthRequestContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(() => ({ kind: "database" })),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(() => true),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
  registerAndAcceptCompanyInvitation: vi.fn(),
  setEmployerCompanyContext: vi.fn(async () => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/auth/employer-context", () => ({
  setEmployerCompanyContext: mocks.setEmployerCompanyContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies: vi.fn(() => false),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/team", () => ({
  acceptCompanyInvitation: mocks.acceptCompanyInvitation,
  registerAndAcceptCompanyInvitation:
    mocks.registerAndAcceptCompanyInvitation,
}));

import {
  acceptInvitationAction,
  registerInvitationAccountAction,
} from "@/app/(auth)/invite/resume/actions";
import {
  createInviteResumeCookie,
  type InviteResumeKey,
} from "@/lib/auth/invite-resume";

const TOKEN = "resume-cookie-invitation-token-that-is-long-enough";
const MALICIOUS_FORM_TOKEN = "attacker-controlled-token-that-is-long-enough";
const USER = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  email: "invitee@example.test",
  role: "RECRUITER",
});
const REQUEST = Object.freeze({
  correlationId: "22222222-2222-4222-8222-222222222222",
  expectedOrigin: "http://127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  production: false,
  sourceIp: "127.0.0.1",
  userAgent: "vitest",
});
const KEY: InviteResumeKey = Object.freeze({
  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(Buffer.alloc(32, 41).toString("base64"));
  },
});
const ENVIRONMENT = Object.freeze({
  APP_ENV: "local",
  secrets: Object.freeze({ session: KEY }),
});

describe("invitation resume actions", () => {
  const cookieStore = { get: vi.fn(), set: vi.fn() };

  beforeEach(() => {
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
    const resume = createInviteResumeCookie(
      { token: TOKEN, now: new Date(), secure: false },
      KEY,
    );
    cookieStore.get.mockReturnValue({ value: resume.value });
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.getCurrentUser.mockResolvedValue(USER);
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.getServerEnvironment.mockReturnValue(ENVIRONMENT);
  });

  it("accepts only the sealed cookie token and clears it after success", async () => {
    mocks.acceptCompanyInvitation.mockResolvedValue({
      ok: true,
      companyId: "33333333-3333-4333-8333-333333333333",
      membershipId: "44444444-4444-4444-8444-444444444444",
    });
    const formData = new FormData();
    formData.set("token", MALICIOUS_FORM_TOKEN);

    await expect(
      acceptInvitationAction({ status: "idle" }, formData),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/employer/dashboard?invitation=accepted",
    );

    expect(mocks.acceptCompanyInvitation).toHaveBeenCalledWith(
      TOKEN,
      USER,
      expect.objectContaining({
        database: { kind: "database" },
        request: REQUEST,
        environment: ENVIRONMENT,
      }),
    );
    expect(mocks.acceptCompanyInvitation).not.toHaveBeenCalledWith(
      MALICIOUS_FORM_TOKEN,
      expect.anything(),
      expect.anything(),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "invite_resume",
      "",
      expect.objectContaining({ path: "/invite", maxAge: 0 }),
    );
  });

  it("registers with the sealed token, writes the session and clears resume", async () => {
    mocks.registerAndAcceptCompanyInvitation.mockResolvedValue({
      ok: true,
      companyId: "33333333-3333-4333-8333-333333333333",
      membershipId: "44444444-4444-4444-8444-444444444444",
      session: {
        cookie: {
          name: "session",
          value: "S".repeat(43),
          options: {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            path: "/",
            expires: new Date(Date.now() + 60_000),
          },
        },
      },
    });
    const formData = new FormData();
    formData.set("token", MALICIOUS_FORM_TOKEN);
    formData.set("name", "Invite User");
    formData.set("email", USER.email);
    formData.set("password", "Long-test-password-123");
    formData.set("acceptedTerms", "true");

    await expect(
      registerInvitationAccountAction({ status: "idle" }, formData),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/employer/dashboard?invitation=accepted",
    );

    expect(mocks.registerAndAcceptCompanyInvitation).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ email: USER.email }),
      expect.objectContaining({ environment: ENVIRONMENT }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "session",
      "S".repeat(43),
      expect.objectContaining({ path: "/" }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "invite_resume",
      "",
      expect.objectContaining({ path: "/invite", maxAge: 0 }),
    );
  });

  it("fails closed and clears an invalid resume before domain mutation", async () => {
    cookieStore.get.mockReturnValue({ value: "tampered" });

    await expect(
      acceptInvitationAction({ status: "idle" }, new FormData()),
    ).resolves.toEqual({
      status: "error",
      message:
        "Die Einladung ist ungültig, abgelaufen oder nicht für dieses Konto bestimmt.",
    });

    expect(mocks.acceptCompanyInvitation).not.toHaveBeenCalled();
    expect(cookieStore.set).toHaveBeenCalledWith(
      "invite_resume",
      "",
      expect.objectContaining({ path: "/invite", maxAge: 0 }),
    );
  });
});
