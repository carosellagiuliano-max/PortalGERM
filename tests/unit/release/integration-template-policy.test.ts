import { describe, expect, it } from "vitest";

import { resolveIntegrationTemplateDatabaseName } from "@/tests/fixtures/integration-template-policy";

const templateName = "swisstalenthub_test_tpl_0123456789abcdef0123456789abcdef";

describe("integration database template policy", () => {
  it("accepts only a generated test-template database name", () => {
    expect(resolveIntegrationTemplateDatabaseName(templateName)).toBe(
      templateName,
    );
    expect(resolveIntegrationTemplateDatabaseName(undefined)).toBe(undefined);
  });

  it.each([
    "swisstalenthub_test_0123456789abcdef0123456789abcdef",
    "swisstalenthub_test_tpl_not-random",
    `${templateName}_suffix`,
    "production",
  ])("rejects an unauthorized template name", (candidate) => {
    expect(() => resolveIntegrationTemplateDatabaseName(candidate)).toThrow(
      "TEST_DATABASE_TEMPLATE_NAME_FORBIDDEN",
    );
  });

  it("keeps generated template identifiers below PostgreSQL's 63-byte limit", () => {
    expect(Buffer.byteLength(templateName, "utf8")).toBeLessThanOrEqual(63);
  });
});
