import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const incidentId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";

import ErrorPage from "@/app/error";

describe("route error page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the server-correlatable error digest without the raw error", async () => {
    const secretCanary = "raw-error-secret-canary";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    const user = userEvent.setup();
    const error = Object.assign(new Error(secretCanary), {
      digest: "next-error-digest-123",
    });

    render(<ErrorPage error={error} reset={reset} />);

    expect(await screen.findByRole("alert")).toHaveFocus();
    await screen.findByText("Referenz: next-error-digest-123");
    expect(screen.queryByText(secretCanary)).not.toBeInTheDocument();

    await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    const serializedLog = String(consoleError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain("next-error-digest-123");
    expect(serializedLog).toContain("route_error_boundary_shown");
    expect(serializedLog).toContain("next_error_digest");
    expect(serializedLog).not.toContain(secretCanary);

    await user.click(screen.getByRole("button", { name: /Erneut versuchen/ }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("uses an explicitly labelled client incident fallback", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(incidentId);

    render(<ErrorPage error={new Error("safe test error")} reset={vi.fn()} />);

    await screen.findByText(`Referenz: ${incidentId}`);
    await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    const serializedLog = String(consoleError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain(incidentId);
    expect(serializedLog).toContain("client_incident");
    expect(serializedLog).not.toContain("correlationId");
  });

  it("allows the longest accepted support reference to wrap on mobile", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errorReference = "a".repeat(128);
    const error = Object.assign(new Error("safe test error"), {
      digest: errorReference,
    });

    render(<ErrorPage error={error} reset={vi.fn()} />);

    const reference = await screen.findByText(`Referenz: ${errorReference}`);
    expect(reference).toHaveClass("break-all");
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
