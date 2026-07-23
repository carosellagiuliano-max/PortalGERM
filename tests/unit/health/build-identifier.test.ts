import { describe, expect, it } from "vitest";

import { getBuildIdentifier } from "@/lib/health/build-identifier";

describe("getBuildIdentifier", () => {
  it("selects a safe deployment identifier without exposing arbitrary input", () => {
    expect(
      getBuildIdentifier({
        APP_BUILD_ID: "release-2026.07.23",
      }),
    ).toBe("release-2026.07.23");
    expect(
      getBuildIdentifier({
        APP_BUILD_ID: "<script>secret</script>",
        GITHUB_SHA: "abc123def456",
      }),
    ).toBe("abc123def456");
  });

  it("uses a non-sensitive local fallback", () => {
    expect(getBuildIdentifier({})).toBe("local-development");
  });
});
