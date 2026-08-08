import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import JobsErrorPage from "@/app/(public)/jobs/error";

const INCIDENT_ID = "0196f82d-3fb4-7f1a-8c9d-123456789abc";

describe("public jobs error boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a search failure local, redacts the raw error and offers all recovery paths", async () => {
    const secretCanary = "postgresql://raw-search-secret";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const retry = vi.fn();
    const user = userEvent.setup();
    const error = Object.assign(new Error(secretCanary), {
      digest: "public-search-digest-123",
    });

    render(<JobsErrorPage error={error} unstable_retry={retry} />);

    expect(await screen.findByRole("alert")).toHaveFocus();
    expect(
      screen.getByRole("heading", {
        name: "Die Stellensuche ist gerade nicht verfügbar.",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Referenz: public-search-digest-123"),
    ).toHaveClass("break-all");
    expect(screen.queryByText(secretCanary)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Suche ohne Filter/u })).toHaveAttribute(
      "href",
      "/jobs",
    );
    expect(screen.getByRole("link", { name: /Zur Startseite/u })).toHaveAttribute(
      "href",
      "/",
    );

    await user.click(screen.getByRole("button", { name: /Suche erneut laden/u }));
    expect(retry).toHaveBeenCalledOnce();

    await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    const serializedLog = String(consoleError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain("public_jobs_error_boundary_shown");
    expect(serializedLog).toContain("public-search-digest-123");
    expect(serializedLog).toContain("next_error_digest");
    expect(serializedLog).not.toContain(secretCanary);
  });

  it("creates a labelled incident reference when Next provides no safe digest", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(INCIDENT_ID);

    render(
      <JobsErrorPage
        error={Object.assign(new Error("sensitive provider detail"), {
          digest: "postgresql://invalid-sensitive-digest",
        })}
        unstable_retry={vi.fn()}
      />,
    );

    await screen.findByText(`Referenz: ${INCIDENT_ID}`);
    await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    const serializedLog = String(consoleError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain(INCIDENT_ID);
    expect(serializedLog).toContain("client_incident");
    expect(serializedLog).not.toContain("sensitive provider detail");
    expect(serializedLog).not.toContain("invalid-sensitive-digest");
  });
});
