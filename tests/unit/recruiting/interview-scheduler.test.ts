// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  hashInterviewCalendarV1,
  renderInterviewCalendarV1,
} from "@/lib/recruiting/ics";
import {
  formatInTimeZone,
  resolveLocalDateTime,
} from "@/lib/recruiting/time-zones";

describe("Phase 28 interview scheduler primitives", () => {
  it("resolves normal Zurich wall time and rejects DST gaps and repeated hours", () => {
    const normal = resolveLocalDateTime(
      "2026-07-30T14:30",
      "Europe/Zurich",
    );
    expect(normal).toEqual({
      ok: true,
      instant: new Date("2026-07-30T12:30:00.000Z"),
    });
    expect(
      resolveLocalDateTime("2026-03-29T02:30", "Europe/Zurich"),
    ).toEqual({ ok: false, code: "NONEXISTENT_LOCAL_TIME" });
    expect(
      resolveLocalDateTime("2026-10-25T02:30", "Europe/Zurich"),
    ).toEqual({ ok: false, code: "AMBIGUOUS_LOCAL_TIME" });
    expect(resolveLocalDateTime("2026-07-30T14:30", "Zurich")).toEqual({
      ok: false,
      code: "INVALID_TIME_ZONE",
    });
    expect(() =>
      formatInTimeZone(
        new Date("2026-07-30T12:30:00.000Z"),
        "Europe/Zurich",
      ),
    ).not.toThrow();
  });

  it("renders deterministic, folded and injection-safe request/cancel ICS", () => {
    const common = {
      uid: "interview-12345678@swisstalenthub.local",
      sequence: 2,
      issuedAt: new Date("2026-07-29T10:00:00.000Z"),
      startsAt: new Date("2026-07-30T12:30:00.000Z"),
      endsAt: new Date("2026-07-30T13:30:00.000Z"),
      subject: "Interview\r\nATTENDEE:evil@example.test",
      location:
        "Sehr langer Ort, Zürich; Gebäude A mit einer zusätzlichen Beschreibung für sichere Faltung",
    } as const;
    const request = renderInterviewCalendarV1({
      ...common,
      method: "REQUEST",
    });
    const cancel = renderInterviewCalendarV1({
      ...common,
      method: "CANCEL",
      sequence: 3,
    });

    expect(request).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(request).toContain("STATUS:CONFIRMED");
    expect(request).not.toContain("\r\nATTENDEE:");
    expect(request.split("\r\n").every((line) => Buffer.byteLength(line) <= 75))
      .toBe(true);
    expect(hashInterviewCalendarV1(request)).toMatch(/^[a-f0-9]{64}$/u);
    expect(cancel).toContain("\r\nMETHOD:CANCEL\r\n");
    expect(cancel).toContain("STATUS:CANCELLED");
    expect(cancel).not.toBe(request);
  });
});
