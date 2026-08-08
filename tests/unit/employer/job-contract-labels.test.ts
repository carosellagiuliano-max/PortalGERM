import { describe, expect, it } from "vitest";

import {
  employerJobAssignmentRoleLabel,
  employerJobBoostStatusLabel,
  employerJobEventLabel,
  employerJobStatusLabel,
  employerReportingResultLabel,
} from "@/lib/employer/job-contracts";
import {
  applicationContactLabel,
  applicationEffortLabel,
  jobTypeLabel,
  remoteTypeLabel,
  requiredDocumentLabel,
  salaryPeriodLabel,
} from "@/lib/jobs/labels-de";

describe("employer job labels", () => {
  it.each([
    [jobTypeLabel, "PERMANENT", "Festanstellung"],
    [remoteTypeLabel, "HYBRID", "Hybrid"],
    [salaryPeriodLabel, "MONTHLY", "Monat"],
    [applicationEffortLabel, "LONG", "Umfangreich"],
    [applicationContactLabel, "APPLY_URL", "Externer Bewerbungslink"],
    [requiredDocumentLabel, "NONE", "Keine Pflichtunterlagen"],
    [requiredDocumentLabel, "CV", "Lebenslauf"],
    [requiredDocumentLabel, "COVER_LETTER", "Motivationsschreiben"],
    [employerReportingResultLabel, "UNKNOWN", "Nicht eindeutig bestimmbar"],
    [employerJobStatusLabel, "CHANGES_REQUESTED", "Änderungen verlangt"],
    [employerJobBoostStatusLabel, "SCHEDULED", "Geplant"],
    [employerJobAssignmentRoleLabel, "REVIEWER", "Prüfung"],
    [employerJobEventLabel, "DRAFT_CREATED", "Entwurf erstellt"],
  ] as const)("maps %s(%s) to de-CH copy", (label, value, expected) => {
    expect(label(value)).toBe(expected);
  });

  it("preserves an unknown future value instead of rendering an empty label", () => {
    expect(employerJobStatusLabel("FUTURE_STATUS")).toBe("FUTURE_STATUS");
  });
});
