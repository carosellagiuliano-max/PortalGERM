import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/candidate/alerts/actions", () => ({
  createJobAlertAction: vi.fn(),
  deleteJobAlertAction: vi.fn(),
  grantJobAlertDeliveryAction: vi.fn(),
  pauseJobAlertAction: vi.fn(),
  resumeJobAlertAction: vi.fn(),
  revokeJobAlertDeliveryAction: vi.fn(),
  runJobAlertDigestMockAction: vi.fn(),
  updateJobAlertAction: vi.fn(),
}));

import { AlertForm } from "@/components/candidate/alert-form";
import {
  AlertDeliveryConsentCard,
  AlertList,
} from "@/components/candidate/alert-list";
import type { JobAlertDeliveryAvailability } from "@/lib/candidate/job-alert-delivery-runtime";
import type { CandidateJobAlertPageData } from "@/lib/candidate/job-alerts";

const UNAVAILABLE: JobAlertDeliveryAvailability = Object.freeze({
  canActivate: false,
  manualMockEnabled: false,
  mode: "UNAVAILABLE",
  reason: "WORKER_HEARTBEAT_STALE",
});
const LOCAL_MOCK: JobAlertDeliveryAvailability = Object.freeze({
  canActivate: true,
  manualMockEnabled: true,
  mode: "LOCAL_MOCK",
  reason: "AVAILABLE",
});
const REFERENCES = Object.freeze({
  cantons: Object.freeze([]),
  categories: Object.freeze([]),
  cities: Object.freeze([]),
});
const ALERT = Object.freeze({
  id: "91000000-0000-4000-8000-000000000003",
  query: Object.freeze({
    keyword: "Pflege",
    cantonId: null,
    cityId: null,
    radiusKm: 0,
    categoryId: null,
    workloadMin: 40,
    workloadMax: 100,
    salaryTransparentOnly: false,
    remotePreference: "ANY" as const,
  }),
  legacyLabel: null,
  filterRequiresRepair: false,
  frequency: "DAILY" as const,
  status: "ACTIVE" as const,
  nextDueAt: new Date("2026-08-07T06:00:00.000Z"),
  lastSuccessfulCutoffAt: null,
  lastDigestAt: null,
  lastDigestCount: null,
  createdAt: new Date("2026-08-06T06:00:00.000Z"),
});

describe("job-alert delivery truth UI", () => {
  it("locks consent and new activation when the real runtime path is unavailable", () => {
    const { unmount } = render(
      <AlertDeliveryConsentCard availability={UNAVAILABLE} granted={false} />,
    );

    expect(
      screen.getByRole("button", { name: "Zustellung derzeit nicht verfügbar" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Provider-, Worker- und Scheduler-Pfad/u),
    ).toBeInTheDocument();
    unmount();

    render(
      <AlertForm
        deliveryAvailability={UNAVAILABLE}
        deliveryConsentGranted={false}
        references={REFERENCES}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Dieses Jobabo ausdrücklich aktivieren",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /Ich möchte dieses Jobabo per Service-E-Mail erhalten/u,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Jobabo erstellen" }),
    ).toBeEnabled();
  });

  it("shows existing ACTIVE as user intent with blocked delivery and keeps recovery actions open", () => {
    const data: CandidateJobAlertPageData = Object.freeze({
      alerts: Object.freeze([ALERT]),
      deliveryConsentGranted: true,
      references: REFERENCES,
    });

    render(<AlertList availability={UNAVAILABLE} data={data} />);

    expect(
      screen.getByText("Aktivierungswunsch · Zustellung gesperrt"),
    ).toBeInTheDocument();
    expect(screen.getByText("Zustellung gesperrt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pausieren" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Löschen" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Fälligen Mock-Digest ausführen" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the isolated local path available and labels its effect as a mock", () => {
    const data: CandidateJobAlertPageData = Object.freeze({
      alerts: Object.freeze([{ ...ALERT, status: "PAUSED" as const }]),
      deliveryConsentGranted: true,
      references: REFERENCES,
    });

    const { unmount } = render(
      <AlertForm
        deliveryAvailability={LOCAL_MOCK}
        deliveryConsentGranted={false}
        references={REFERENCES}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Dieses Jobabo ausdrücklich aktivieren",
      }),
    ).toBeEnabled();
    unmount();

    render(<AlertList availability={LOCAL_MOCK} data={data} />);
    expect(
      screen.getByRole("button", { name: "Ausdrücklich aktivieren" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Fälligen Mock-Digest ausführen" }),
    ).toBeEnabled();
  });
});
