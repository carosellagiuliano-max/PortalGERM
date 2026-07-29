// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  isRecruitingFeatureAvailableV1,
  recruitingFeatureModeV1,
} from "@/lib/recruiting/feature-gates";
import { createExternalApplicationTracker } from "@/lib/recruiting/external-tracker";
import { proposeInterview } from "@/lib/recruiting/interviews";
import { createValidEnvironment } from "@/tests/fixtures/environment";

describe("Phase 28 independent demand gates", () => {
  it("keeps both tracks independently disabled by default", () => {
    const environment = parseEnvironment(createValidEnvironment());
    expect(
      recruitingFeatureModeV1(environment, "external_application_tracker"),
    ).toBe("disabled");
    expect(recruitingFeatureModeV1(environment, "interview_scheduler")).toBe(
      "disabled",
    );
    expect(
      isRecruitingFeatureAvailableV1(
        environment,
        "external_application_tracker",
      ),
    ).toBe(false);
    expect(
      isRecruitingFeatureAvailableV1(environment, "interview_scheduler"),
    ).toBe(false);
  });

  it("rejects test activation outside isolated Local/CI environments per flag", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "staging",
          EXTERNAL_APPLICATION_TRACKER: "test",
        }),
      ),
    ).toThrow(/EXTERNAL_APPLICATION_TRACKER|Phase-28 test activation/iu);
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "staging",
          INTERVIEW_SCHEDULER: "test",
        }),
      ),
    ).toThrow(/INTERVIEW_SCHEDULER|Phase-28 test activation/iu);
  });

  it("fails closed before any database read or write for both disabled tracks", async () => {
    const database = new Proxy(
      {},
      {
        get() {
          throw new Error("disabled feature touched the database");
        },
      },
    );
    const environment = parseEnvironment(createValidEnvironment());
    const dependencies = {
      database,
      environment,
      request: {
        correlationId: randomUUID(),
        expectedOrigin: environment.APP_URL,
        origin: environment.APP_URL,
        production: false,
        sourceIp: "127.0.0.1",
        userAgent: "phase28-unit",
      },
      now: new Date("2026-07-29T10:00:00.000Z"),
    };
    const external = await createExternalApplicationTracker(
      {
        candidateUserId: randomUUID(),
        jobId: randomUUID(),
        jobRevisionId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
      dependencies as never,
    );
    const interview = await proposeInterview(
      {
        companyId: randomUUID(),
        membershipId: randomUUID(),
        userId: randomUUID(),
        membershipRole: "OWNER",
      },
      {
        applicationId: randomUUID(),
        timeZone: "Europe/Zurich",
        subject: "Interview",
        slots: [
          {
            startsAt: new Date("2026-07-30T10:00:00.000Z"),
            endsAt: new Date("2026-07-30T11:00:00.000Z"),
          },
        ],
        idempotencyKey: randomUUID(),
      },
      dependencies as never,
    );

    expect(external).toEqual({ ok: false, code: "FEATURE_UNAVAILABLE" });
    expect(interview).toEqual({ ok: false, code: "FEATURE_UNAVAILABLE" });
    expect(vi.isMockFunction(database)).toBe(false);
  });
});
