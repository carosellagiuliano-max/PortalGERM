import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  apply: vi.fn(),
  save: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/app/candidate/applications/actions", () => ({
  applyToJobAction: actions.apply,
}));
vi.mock("@/app/candidate/saved-jobs/actions", () => ({
  confirmSaveJobAction: actions.save,
}));
vi.mock("@/app/(public)/jobs/actions", () => ({
  startPublicJobIntentAction: actions.start,
}));

import {
  ApplyIntentConfirmation,
  SaveIntentConfirmation,
} from "@/components/public/apply-save-actions";
import { APPLICATION_CONFIRMATION_NOTICE_V1 } from "@/lib/applications/contracts";

describe("explicit resumed job intent UI", () => {
  it("renders without executing Save and requires a deliberate submit", () => {
    render(<SaveIntentConfirmation signedIntent="payload.signature" />);
    expect(actions.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /jetzt speichern/iu })).toHaveAttribute("type", "submit");
  });

  it("never auto-submits Apply and exposes the exact required confirmation", () => {
    render(
      <ApplyIntentConfirmation
        signedIntent="payload.signature"
        idempotencyKey="application:test:one"
        identityComplete
        documents={[
          {
            id: "10000000-0000-4000-8000-000000000001",
            safeFilename: "lebenslauf.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10_000,
          },
        ]}
        projection={{
          confirmationVersion: "application-confirmation-v1",
          confirmationNotice: APPLICATION_CONFIRMATION_NOTICE_V1,
          confirmationNoticeHash: "a".repeat(64),
          confirmationSnapshotHash: "b".repeat(64),
          candidate: {
            firstName: "Mara",
            lastName: "Muster",
            email: "mara@example.test",
          },
          recipient: {
            companyName: "Muster AG",
            contactKind: "EMAIL",
            contactValue: "jobs@muster.example",
          },
          job: {
            revisionId: "10000000-0000-4000-8000-000000000002",
            slug: "pflege-zuerich",
            title: "Pflegefachperson",
            responseTargetDays: 5,
            applicationEffort: "SIMPLE",
            requiredDocumentKinds: ["CV"],
          },
        }}
      />,
    );
    expect(actions.apply).not.toHaveBeenCalled();
    expect(screen.getByText(APPLICATION_CONFIRMATION_NOTICE_V1)).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(screen.getByRole("checkbox")).toHaveAttribute("name", "confirmed");
    expect(screen.getByRole("checkbox")).toHaveAttribute("value", "true");
    expect(screen.getByRole("button", { name: /schnellbewerbung senden/iu })).toHaveAttribute("type", "submit");
  });
});
