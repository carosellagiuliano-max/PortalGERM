import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(public)/actions", () => ({
  submitPublicReportAction: vi.fn(),
}));

import { PublicIntakePrivacyProvider } from "@/components/privacy/public-intake-privacy";
import { ReportForm } from "@/components/public/report-form";
import { ABUSE_REPORT_PRIVACY_NOTICE_V1 } from "@/lib/privacy/public-intake-privacy-contract";

describe.each([
  ["JOB" as const, "test-job"],
  ["COMPANY" as const, "test-company"],
])("public %s report privacy boundary", (targetType, slug) => {
  it("enables the local synthetic form with the complete exact binding", () => {
    const { container } = render(
      <PublicIntakePrivacyProvider
        decision={{
          allowed: true,
          binding: {
            purpose: "ABUSE_REPORT",
            evidenceMode: "LOCAL_SYNTHETIC",
            legalPublicationId: null,
            publicationHash: null,
            publicationVersion: null,
            noticeVersion: ABUSE_REPORT_PRIVACY_NOTICE_V1.version,
            noticeHash: ABUSE_REPORT_PRIVACY_NOTICE_V1.hash,
            noticeText: ABUSE_REPORT_PRIVACY_NOTICE_V1.text,
          },
        }}
      >
        <ReportForm targetType={targetType} slug={slug} />
      </PublicIntakePrivacyProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Meldung absenden" }),
    ).toBeEnabled();
    expect(container.querySelector('input[name="privacyPurpose"]')).toHaveValue(
      "ABUSE_REPORT",
    );
    expect(
      container.querySelector('input[name="privacyEvidenceMode"]'),
    ).toHaveValue("LOCAL_SYNTHETIC");
    expect(
      screen.getByText(/Lokaler synthetischer Testvertrag/u),
    ).toBeInTheDocument();
  });

  it("renders a visible locked state in preview when no publication exists", () => {
    render(
      <PublicIntakePrivacyProvider
        decision={{ allowed: false, code: "PUBLICATION_UNAVAILABLE" }}
      >
        <ReportForm targetType={targetType} slug={slug} />
      </PublicIntakePrivacyProvider>,
    );

    expect(screen.getByText("Meldung derzeit gesperrt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Meldung absenden" }),
    ).not.toBeInTheDocument();
  });
});
