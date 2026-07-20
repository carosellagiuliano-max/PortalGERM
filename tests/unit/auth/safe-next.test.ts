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
});
