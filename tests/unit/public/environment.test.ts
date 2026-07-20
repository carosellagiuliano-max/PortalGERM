import { describe, expect, it, vi } from "vitest";

const getServerEnvironment = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));

import { getPublicDataContext } from "@/lib/public/environment";

describe("public data environment policy", () => {
  it.each(["production", "staging"] as const)(
    "restricts %s to LIVE data without a demo banner",
    (appEnvironment) => {
      getServerEnvironment.mockReturnValue({ APP_ENV: appEnvironment });

      expect(getPublicDataContext()).toEqual({
        eligibilityEnvironment: "production",
        liveOnly: true,
        publicIndexingAllowed: appEnvironment === "production",
        showDemoBanner: false,
      });
    },
  );

  it.each(["local", "preview"] as const)(
    "makes demo provenance visible in %s",
    (appEnvironment) => {
      getServerEnvironment.mockReturnValue({ APP_ENV: appEnvironment });

      expect(getPublicDataContext()).toEqual({
        eligibilityEnvironment: "non-production",
        liveOnly: false,
        publicIndexingAllowed: false,
        showDemoBanner: true,
      });
    },
  );

  it("keeps CI non-production and labels its demo fixtures", () => {
    getServerEnvironment.mockReturnValue({ APP_ENV: "ci" });

    expect(getPublicDataContext()).toEqual({
      eligibilityEnvironment: "non-production",
      liveOnly: false,
      publicIndexingAllowed: false,
      showDemoBanner: true,
    });
  });
});
