import { describe, expect, it } from "vitest";

import { jobAlertNextDueLabel } from "@/lib/candidate/job-alert-copy";

describe("candidate dashboard job-alert copy", () => {
  it("does not describe a production-like delivery as a local mock run", () => {
    expect(jobAlertNextDueLabel(true)).toBe("Nächste geplante Zustellung");
  });

  it("keeps the mock disclosure in an isolated local or CI data context", () => {
    expect(jobAlertNextDueLabel(false)).toBe("Nächster lokaler Mock-Lauf");
  });
});
