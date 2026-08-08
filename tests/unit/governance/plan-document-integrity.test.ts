import { describe, expect, it } from "vitest";

import { inspectPlanDocumentIntegrity } from "@/lib/governance/plan-document-integrity";

describe("plan document integrity", () => {
  it("accepts a structurally valid table, escaped pipe and fenced example", () => {
    const source = [
      "| ID | Contract |",
      "| --- | --- |",
      "| AC-1 | `READ \\| WRITE` |",
      "",
      "```text",
      "| bad | example | only |",
      "| --- | --- |",
      "…7440 tokens truncated…",
      "```",
    ].join("\n");

    expect(inspectPlanDocumentIntegrity(source)).toEqual([]);
  });

  it("rejects transport truncation markers outside code fences", () => {
    expect(
      inspectPlanDocumentIntegrity("Evidence: …7440 tokens truncated…"),
    ).toEqual([
      {
        code: "TRUNCATION_MARKER",
        line: 1,
        message: "contains a transport truncation marker",
      },
    ]);
  });

  it("rejects header, separator and data-row cell-count drift", () => {
    const source = [
      "| A | B |",
      "| --- | --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 | 5 | 6 |",
    ].join("\n");

    expect(inspectPlanDocumentIntegrity(source)).toEqual([
      expect.objectContaining({
        code: "MALFORMED_MARKDOWN_TABLE",
        line: 2,
      }),
      expect.objectContaining({
        code: "MALFORMED_MARKDOWN_TABLE",
        line: 3,
      }),
      expect.objectContaining({
        code: "MALFORMED_MARKDOWN_TABLE",
        line: 4,
      }),
    ]);
  });

  it("treats an unescaped pipe in an inline capability as a real delimiter", () => {
    const source = [
      "| Route | Capability |",
      "| --- | --- |",
      "| /admin | `READ | WRITE` |",
    ].join("\n");

    expect(inspectPlanDocumentIntegrity(source)).toEqual([
      expect.objectContaining({
        code: "MALFORMED_MARKDOWN_TABLE",
        line: 3,
      }),
    ]);
  });
});
