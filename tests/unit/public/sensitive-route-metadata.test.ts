import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata as supportCaseMetadata } from "@/app/support/[id]/page";
import { metadata as supportMetadata } from "@/app/support/page";

describe("out-of-layout support metadata", () => {
  it.each([
    ["support index", supportMetadata],
    ["support case", supportCaseMetadata],
  ])("keeps the %s private without emitting a referrer", (_name, metadata) => {
    expect(metadata).toMatchObject({
      referrer: "no-referrer",
      robots: {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
      },
    });
  });
});
