// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getPublicCatalog: vi.fn(),
  getPublicCompanyCardBySlug: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  redirect: vi.fn(),
  registerCandidate: vi.fn(),
  registerEmployer: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  setEmployerCompanyContext: vi.fn(),
  writeSessionCookie: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/auth-service", () => ({
  loginWithPassword: mocks.loginWithPassword,
  registerCandidate: mocks.registerCandidate,
  registerEmployer: mocks.registerEmployer,
  requestPasswordReset: mocks.requestPasswordReset,
  resetPassword: mocks.resetPassword,
}));
vi.mock("@/lib/auth/employer-context", () => ({
  setEmployerCompanyContext: mocks.setEmployerCompanyContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/session", () => ({
  writeSessionCookie: mocks.writeSessionCookie,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/companies/public-read-model", () => ({
  getPublicCompanyCardBySlug: mocks.getPublicCompanyCardBySlug,
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicCatalog: mocks.getPublicCatalog,
}));
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));

import {
  COMPANY_CLAIM_INTENT_POLICY_V1,
  signCompanyClaimIntent,
} from "@/lib/auth/company-claim-intent";
import { registerEmployerAction } from "@/lib/auth/server-actions";

const COMPANY_SLUG = "musterfirma-ag";
const SECRET = Buffer.alloc(32, 7).toString("base64");
const signingKey = Object.freeze({
  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(SECRET);
  },
});

describe("employer registration company-claim bridge", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAuthRequestContext.mockResolvedValue({ ipAddress: "127.0.0.1" });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getServerEnvironment.mockReturnValue({
      secrets: { session: signingKey },
    });
    mocks.getDatabase.mockReturnValue({ marker: "database" });
    mocks.getPublicCompanyCardBySlug.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      slug: COMPANY_SLUG,
      name: "Musterfirma AG",
      canton: "Zürich",
    });
    mocks.getPublicCatalog.mockResolvedValue({
      cantons: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "ZH",
          name: "Zürich",
          slug: "zuerich",
        },
      ],
      cities: [],
      categories: [],
    });
    mocks.registerEmployer.mockResolvedValue({
      ok: false,
      code: "REGISTRATION_FAILED",
    });
  });

  it("re-verifies a valid claim and overwrites manipulated company signals canonically", async () => {
    const intent = signCompanyClaimIntent(
      { companySlug: COMPANY_SLUG, now: new Date() },
      signingKey,
    );
    const formData = validEmployerFormData();
    formData.set("companyName", "Manipulierter Name");
    formData.set("cantonCode", "GE");
    formData.set("claim", COMPANY_SLUG);
    formData.set("intent", intent);

    const result = await registerEmployerAction({ status: "idle" }, formData);

    expect(mocks.getPublicCompanyCardBySlug).toHaveBeenCalledWith(
      COMPANY_SLUG,
      0,
    );
    expect(mocks.registerEmployer).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Musterfirma AG",
        cantonCode: "ZH",
      }),
      expect.objectContaining({
        database: { marker: "database" },
        claimedCompanyId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(result.values).toMatchObject({
      companyName: "Musterfirma AG",
      cantonCode: "ZH",
    });
  });

  it.each([
    ["forged", () => `${validIntent()}.forged`],
    [
      "expired",
      () =>
        signCompanyClaimIntent(
          {
            companySlug: COMPANY_SLUG,
            now: new Date(
              Date.now() - COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds - 1,
            ),
          },
          signingKey,
        ),
    ],
  ])("rejects a %s intent generically before registration", async (_label, token) => {
    const formData = validEmployerFormData();
    formData.set("claim", COMPANY_SLUG);
    formData.set("intent", token());

    const result = await registerEmployerAction({ status: "idle" }, formData);

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/ungültig oder abgelaufen/u),
    });
    expect(mocks.getPublicCompanyCardBySlug).not.toHaveBeenCalled();
    expect(mocks.registerEmployer).not.toHaveBeenCalled();
  });

  it("rejects half-present claim data instead of falling back to normal registration", async () => {
    const formData = validEmployerFormData();
    formData.set("claim", COMPANY_SLUG);

    const result = await registerEmployerAction({ status: "idle" }, formData);

    expect(result.message).toMatch(/ungültig oder abgelaufen/u);
    expect(mocks.registerEmployer).not.toHaveBeenCalled();
  });

  it("keeps ordinary employer registration unchanged when both claim fields are absent", async () => {
    const formData = validEmployerFormData();

    await registerEmployerAction({ status: "idle" }, formData);

    expect(mocks.getPublicCompanyCardBySlug).not.toHaveBeenCalled();
    expect(mocks.getPublicCatalog).not.toHaveBeenCalled();
    expect(mocks.registerEmployer).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Eingereichte Firma AG",
        cantonCode: "BE",
      }),
      expect.any(Object),
    );
  });
});

function validIntent() {
  return signCompanyClaimIntent(
    { companySlug: COMPANY_SLUG, now: new Date() },
    signingKey,
  );
}

function validEmployerFormData() {
  const formData = new FormData();
  formData.set("name", "Erika Muster");
  formData.set("email", "erika@musterfirma.ch");
  formData.set("password", "StrongPassword1!");
  formData.set("passwordConfirmation", "StrongPassword1!");
  formData.set("companyName", "Eingereichte Firma AG");
  formData.set("cantonCode", "BE");
  formData.set("companySize", "10-49");
  formData.set("acceptedTerms", "on");
  return formData;
}
