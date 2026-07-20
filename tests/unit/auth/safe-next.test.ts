import { describe, expect, it } from "vitest";

import {
  parseSafeNext,
  resolveSafeNext,
} from "@/lib/auth/safe-next";

describe("role-bound safe next", () => {
  it.each([
    ["CANDIDATE", "/candidate/jobpass?step=2", "/candidate/jobpass?step=2"],
    ["EMPLOYER", "/employer/dashboard", "/employer/dashboard"],
    ["RECRUITER", "/employer/jobs#active", "/employer/jobs#active"],
    ["ADMIN", "/admin", "/admin"],
  ] as const)("allows the %s private route family", (role, value, expected) => {
    expect(parseSafeNext(value, role)).toBe(expected);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "/%2f%2fevil.example/steal",
    "/employer/%252f%252fevil.example/steal",
    "/%5cevil.example/steal",
    "/candidate/%0d%0aSet-Cookie:attack",
    "/employer-malicious",
  ])("rejects unsafe or ambiguous next value %s", (value) => {
    expect(parseSafeNext(value, "EMPLOYER")).toBeNull();
  });

  it("rejects cross-role routes and falls back by role", () => {
    expect(parseSafeNext("/admin", "EMPLOYER")).toBeNull();
    expect(parseSafeNext("/employer/dashboard", "CANDIDATE")).toBeNull();
    expect(resolveSafeNext("/admin", "CANDIDATE")).toBe(
      "/candidate/dashboard",
    );
    expect(resolveSafeNext(undefined, "RECRUITER")).toBe(
      "/employer/dashboard",
    );
  });

  it("allows only the strict signed job-intent shape for candidates", () => {
    const intent = "eyJ2ZXJzaW9uIjoxfQ.signature";
    expect(
      parseSafeNext(`/jobs/pflege-zuerich?intent=${intent}`, "CANDIDATE"),
    ).toBe(`/jobs/pflege-zuerich?intent=${intent}`);
    expect(parseSafeNext(`/jobs/pflege-zuerich?intent=${intent}`, "EMPLOYER")).toBeNull();
  });

  it.each([
    "/jobs/pflege-zuerich",
    "/jobs/pflege-zuerich?intent=a.b&next=/admin",
    "/jobs/pflege-zuerich?intent=a.b&intent=c.d",
    "/jobs/pflege-zuerich?intent=a.b#fragment",
    "/jobs/Pflege-Zuerich?intent=a.b",
    "/jobs/pflege-zuerich?intent=not-a-token",
  ])("rejects ambiguous candidate job-intent next path %s", (value) => {
    expect(parseSafeNext(value, "CANDIDATE")).toBeNull();
  });
});
