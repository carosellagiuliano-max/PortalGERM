import { describe, expect, it } from "vitest";

import { documentScanDedupeKey } from "@/lib/ops/worker-scheduler";

describe("Phase-33 document scan scheduling", () => {
  it("uses one stable work identity for every automatic retry", () => {
    const handler = {
      handlerKey: "documents.scan",
      handlerVersion: "v1",
    } as const;
    const versionId = "1bd73e38-a33a-43fd-8fe4-b88c15049b39";

    expect(documentScanDedupeKey(handler, versionId)).toBe(
      `documents.scan:v1:${versionId}`,
    );
    expect(documentScanDedupeKey(handler, versionId)).not.toContain(
      "attempt",
    );
  });
});
