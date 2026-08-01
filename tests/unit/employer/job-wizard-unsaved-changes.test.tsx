import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Link from "@/components/shared/app-link";
import {
  UNSAVED_CHANGES_PROMPT,
  useUnsavedChanges,
} from "@/components/employer/job-wizard/use-unsaved-changes";

function Harness() {
  const { clearDirty, dirty, markDirty } = useUnsavedChanges();
  return (
    <div>
      <label>
        Titel
        <input onChange={markDirty} />
      </label>
      <p>{dirty ? "ungespeichert" : "gespeichert"}</p>
      <Link
        href="/employer/jobs/job-1?step=2"
        onClick={(event) => event.preventDefault()}
      >
        Nächster Schritt
      </Link>
      <button type="button" onClick={clearDirty}>
        Als gespeichert markieren
      </button>
    </div>
  );
}

describe("employer job wizard unsaved-change guard", () => {
  it("blocks same-tab navigation when the user keeps unsaved input", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "Noch nicht gespeichert" },
    });
    const link = screen.getByRole("link", { name: "Nächster Schritt" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    expect(link.dispatchEvent(click)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_PROMPT);
    expect(screen.getByText("ungespeichert")).toBeInTheDocument();
  });

  it("arms beforeunload and disarms both guards after an explicit discard", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "Entwurf" },
    });

    const unloadWhileDirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadWhileDirty);
    expect(unloadWhileDirty.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("link", { name: "Nächster Schritt" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText("gespeichert")).toBeInTheDocument();

    const unloadAfterDiscard = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadAfterDiscard);
    expect(unloadAfterDiscard.defaultPrevented).toBe(false);
  });

  it("does not prompt after the form was marked as saved", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "Gespeicherter Entwurf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Als gespeichert markieren" }));
    fireEvent.click(screen.getByRole("link", { name: "Nächster Schritt" }));

    expect(confirm).not.toHaveBeenCalled();
  });
});
