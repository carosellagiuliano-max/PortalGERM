import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/app/candidate/jobpass/actions", () => ({
  completeCandidateOnboardingAction: mocks.complete,
  saveCandidateProfileAction: mocks.save,
}));

import {
  JobPassForm,
  type JobPassFormInitialValues,
} from "@/components/candidate/JobPassForm";
import { TALENT_RADAR_VISIBILITY_NOTICE_V1 } from "@/lib/candidate/profile";

const INITIAL: JobPassFormInitialValues = Object.freeze({
  revision: "2026-07-29T08:00:00.000Z",
  firstName: "Mira",
  lastName: "Muster",
  publicDisplayName: "Mira M.",
  email: "mira@example.test",
  phone: "",
  cantonId: "canton-zh",
  cityLabel: "Zürich",
  summary: "",
  desiredTitles: "Softwareentwicklerin",
  skillIds: Object.freeze(["skill-typescript"]),
  languages: Object.freeze([Object.freeze({ code: "de", level: "C1" })]),
  categoryIds: Object.freeze(["category-it"]),
  workloadMin: "60",
  workloadMax: "80",
  desiredSalaryMin: "",
  desiredSalaryMax: "",
  desiredSalaryPeriod: "",
  jobTypes: Object.freeze(["PERMANENT"]),
  remotePreference: "HYBRID",
  mobilityRadiusKm: "30",
  availabilityDate: "",
  workPermitType: "C",
  radarVisible: false,
  currentDocument: null,
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.complete.mockReset();
  mocks.save.mockReset();
  mocks.save.mockResolvedValue({
    status: "success",
    message: "Gespeichert.",
    revision: INITIAL.revision,
    saveMode: "manual",
  });
});

describe("Phase-29 SwissJobPass stepper and autosave", () => {
  it("keeps every section reachable through a keyboard-operable four-step flow", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(
      screen.getByRole("navigation", { name: "SwissJobPass-Fortschritt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Persönliche Angaben" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Berufliche Ziele" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(
      screen.getByRole("group", { name: "Berufliche Ziele" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Beruf/ }),
    ).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByRole("button", { name: /Rahmen/ }));
    expect(
      screen.getByRole("group", { name: "Rahmenbedingungen" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Sichtbarkeit/ }));
    expect(
      screen.getByRole("group", { name: "Anonymer Talent Radar" }),
    ).toBeVisible();
    expect(
      screen.getByText(TALENT_RADAR_VISIBILITY_NOTICE_V1.text),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Jetzt speichern" }),
    ).toBeVisible();
  });

  it("debounces changes, identifies autosave explicitly and resumes with the returned revision", async () => {
    mocks.save
      .mockResolvedValueOnce({
        status: "success",
        message: "Entwurf automatisch gespeichert.",
        revision: "2026-07-29T08:01:00.000Z",
        saveMode: "autosave",
      })
      .mockResolvedValue({
        status: "error",
        message: "Bitte prüfe die markierten Profilangaben.",
        fieldErrors: { lastName: ["Bitte prüfe den Nachnamen."] },
      });
    renderForm();

    fireEvent.change(screen.getByLabelText("Vorname"), {
      target: { value: "Mirjam" },
    });
    fireEvent.change(screen.getByLabelText("Kanton"), {
      target: { value: "canton-be" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Änderungen warten auf Autosave.",
    );

    expect(mocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });

    const submitted = mocks.save.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("saveMode")).toBe("autosave");
    expect(submitted.get("revision")).toBe(INITIAL.revision);
    expect(submitted.get("cantonId")).toBe("canton-be");
    await waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>('input[name="revision"]'),
      ).toHaveValue("2026-07-29T08:01:00.000Z"),
    );
    expect(screen.getByLabelText("Kanton")).toHaveValue("canton-be");

    fireEvent.change(screen.getByLabelText("Nachname"), {
      target: { value: "" },
    });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    const rejected = mocks.save.mock.calls[1]?.[1] as FormData;
    expect(rejected.get("revision")).toBe("2026-07-29T08:01:00.000Z");
    expect(rejected.get("cantonId")).toBe("canton-be");
    await waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>('input[name="revision"]'),
      ).toHaveValue("2026-07-29T08:01:00.000Z"),
    );
  });
});

function renderForm() {
  return render(
    <JobPassForm
      initial={INITIAL}
      cantons={[
        { id: "canton-zh", code: "ZH", name: "Zürich" },
        { id: "canton-be", code: "BE", name: "Bern" },
      ]}
      skills={[
        {
          id: "skill-typescript",
          name: "TypeScript",
        },
      ]}
      categories={[{ id: "category-it", name: "Informatik" }]}
      radarNotice={TALENT_RADAR_VISIBILITY_NOTICE_V1.text}
      legacyCvMetadataEnabled={false}
    />,
  );
}
