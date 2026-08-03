import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.restoreAllMocks();
    actions.apply.mockReset();
    actions.save.mockReset();
    actions.start.mockReset();
    globalThis.history.replaceState({}, "", "/");
  });

  it("renders without executing Save and requires a deliberate submit", () => {
    render(<SaveIntentConfirmation signedIntent="payload.signature" />);
    expect(actions.save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /jetzt speichern/iu }),
    ).toHaveAttribute("type", "submit");
  });

  it("confirms one Save immediately and scrubs the signed intent without a navigation", async () => {
    const user = userEvent.setup();
    let resolveSave:
      | ((value: {
          status: "success";
          message: string;
          jobSlug: string;
        }) => void)
      | undefined;
    actions.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    globalThis.history.replaceState(
      {},
      "",
      "/jobs/pflege-zuerich?signedIntent=sensitive-token",
    );
    const replaceState = vi.spyOn(globalThis.history, "replaceState");
    render(<SaveIntentConfirmation signedIntent="payload.signature" />);

    await user.click(screen.getByRole("button", { name: "Jetzt speichern" }));

    expect(actions.save).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();
    await act(async () => {
      resolveSave?.({
        status: "success",
        message: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
        jobSlug: "pflege-zuerich",
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
    );
    expect(actions.save).toHaveBeenCalledOnce();
    expect(globalThis.location.pathname).toBe("/jobs/pflege-zuerich");
    expect(globalThis.location.search).toBe("?saved=1");
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/jobs/pflege-zuerich?saved=1",
    );
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
    expect(
      screen.getByRole("button", { name: /schnellbewerbung senden/iu }),
    ).toHaveAttribute("type", "submit");
  });

  it("restores the cover letter after a rejected application submit", async () => {
    const user = userEvent.setup();
    actions.apply.mockResolvedValue({
      status: "error",
      message: "Die Stelle ist nicht mehr verfügbar.",
      nextIdempotencyKey: "application:test:retry",
      values: {
        coverLetter: "Mein sorgfältig verfasstes Motivationsschreiben.",
      },
    });
    render(
      <ApplyIntentConfirmation
        signedIntent="payload.signature"
        idempotencyKey="application:test:initial"
        identityComplete
        documents={[]}
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
            requiredDocumentKinds: ["COVER_LETTER"],
          },
        }}
      />,
    );

    const coverLetter = screen.getByRole("textbox", {
      name: /Motivationsschreiben/,
    });
    await user.type(
      coverLetter,
      "Mein sorgfältig verfasstes Motivationsschreiben.",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Schnellbewerbung senden" }),
    );

    expect(
      await screen.findByText("Die Stelle ist nicht mehr verfügbar."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Motivationsschreiben/ }),
    ).toHaveValue("Mein sorgfältig verfasstes Motivationsschreiben.");
    expect(document.querySelector('input[name="idempotencyKey"]')).toHaveValue(
      "application:test:retry",
    );
  });
});
