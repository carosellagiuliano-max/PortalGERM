// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  EXTERNAL_APPLICATION_RESUME_POLICY_V1,
  signExternalApplicationResumeIntent,
  verifyExternalApplicationResumeIntent,
} from "@/lib/recruiting/external-application-intent";
import {
  EXTERNAL_APPLICATION_TRANSITIONS_V1,
} from "@/lib/recruiting/external-tracker";
import { createValidEnvironment } from "@/tests/fixtures/environment";

describe("Phase 28 external application tracker contract", () => {
  it("models only candidate-confirmed forward and terminal transitions", () => {
    expect(EXTERNAL_APPLICATION_TRANSITIONS_V1).toEqual({
      BEGUN: ["SUBMITTED", "WITHDRAWN", "ARCHIVED"],
      SUBMITTED: ["INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"],
      INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"],
      OFFER: ["HIRED", "REJECTED", "WITHDRAWN", "ARCHIVED"],
      REJECTED: ["ARCHIVED"],
      HIRED: ["ARCHIVED"],
      WITHDRAWN: ["ARCHIVED"],
      ARCHIVED: [],
    });
    expect(EXTERNAL_APPLICATION_TRANSITIONS_V1.BEGUN).not.toContain("HIRED");
    expect(EXTERNAL_APPLICATION_TRANSITIONS_V1.ARCHIVED).toHaveLength(0);
  });

  it("signs a resume-only intent and rejects tampering, future and expiry", () => {
    const environment = parseEnvironment(createValidEnvironment());
    const now = new Date("2026-07-29T10:00:00.000Z");
    const input = {
      jobId: randomUUID(),
      jobRevisionId: randomUUID(),
      jobSlug: "phase-28-external-role",
      now,
    };
    const token = signExternalApplicationResumeIntent(
      input,
      environment.secrets.session,
    );
    const verified = verifyExternalApplicationResumeIntent(
      token,
      now,
      environment.secrets.session,
    );

    expect(verified).toMatchObject({
      version: 1,
      jobId: input.jobId,
      jobRevisionId: input.jobRevisionId,
      jobSlug: input.jobSlug,
    });
    expect(verified).not.toHaveProperty("status");
    expect(verified).not.toHaveProperty("submitted");
    const tamperedToken =
      `${token.slice(0, -1)}${token.endsWith("x") ? "y" : "x"}`;
    expect(
      verifyExternalApplicationResumeIntent(
        tamperedToken,
        now,
        environment.secrets.session,
      ),
    ).toBeNull();
    expect(
      verifyExternalApplicationResumeIntent(
        token,
        new Date(
          now.getTime() +
            EXTERNAL_APPLICATION_RESUME_POLICY_V1.ttlMilliseconds,
        ),
        environment.secrets.session,
      ),
    ).toBeNull();
    expect(
      verifyExternalApplicationResumeIntent(
        token,
        new Date(now.getTime() - 31_000),
        environment.secrets.session,
      ),
    ).toBeNull();
  });
});
