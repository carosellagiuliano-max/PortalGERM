import { describe, expect, it } from "vitest";

import {
  parseSafeNextForPortals,
  resolveSafeNextForPortal,
} from "@/lib/auth/safe-next";

describe("Phase 27 portal-bound safe next", () => {
  it("accepts only paths belonging to an available portal", () => {
    expect(
      parseSafeNextForPortals("/candidate/applications?status=open", [
        "CANDIDATE",
      ]),
    ).toBe("/candidate/applications?status=open");
    expect(
      parseSafeNextForPortals("/employer/billing", ["CANDIDATE"]),
    ).toBeNull();
    expect(
      parseSafeNextForPortals("/admin/users", ["CANDIDATE", "EMPLOYER"]),
    ).toBeNull();
    expect(
      parseSafeNextForPortals("/account/portal", ["CANDIDATE"]),
    ).toBe("/account/portal");
  });

  it.each([
    "//evil.example/steal",
    "/%2f%2fevil.example/steal",
    "/candidate\\..\\admin",
    "/candidate/%0aSet-Cookie:stolen",
    "https://evil.example/candidate",
  ])("rejects malformed or external destination %s", (value) => {
    expect(
      parseSafeNextForPortals(value, ["CANDIDATE", "EMPLOYER", "ADMIN"]),
    ).toBeNull();
  });

  it("keeps invitation and job intent exceptions bound to their owning portal", () => {
    expect(
      parseSafeNextForPortals("/invite/resume", ["EMPLOYER"]),
    ).toBe("/invite/resume");
    expect(
      parseSafeNextForPortals("/invite/resume", ["CANDIDATE"]),
    ).toBeNull();
    expect(
      parseSafeNextForPortals("/jobs/software-engineer?intent=abc.def", [
        "CANDIDATE",
      ]),
    ).toBe("/jobs/software-engineer?intent=abc.def");
    expect(
      parseSafeNextForPortals("/jobs/software-engineer?intent=abc.def", [
        "EMPLOYER",
      ]),
    ).toBeNull();
  });

  it("falls back to the destination of exactly the active portal", () => {
    expect(resolveSafeNextForPortal("/admin", "CANDIDATE")).toBe(
      "/candidate/dashboard",
    );
    expect(resolveSafeNextForPortal("/candidate", "EMPLOYER")).toBe(
      "/employer/dashboard",
    );
  });
});
