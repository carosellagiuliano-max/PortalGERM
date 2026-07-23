import {
  JOBROOM_REASON_CODES,
  type JobroomReasonCode,
} from "@/lib/providers/jobroom/jobroom-provider";
import { jobroomReasonCopy } from "@/lib/providers/jobroom/reason-copy";
import { describe, expect, it } from "vitest";

const EXPECTED_COPY = Object.freeze({
  REPORTING_REQUIRED:
    "Die gewählte Berufsart ist im aktuellen Mock-Datensatz als meldepflichtig klassifiziert.",
  REPORTING_NOT_REQUIRED:
    "Die gewählte Berufsart ist im aktuellen Mock-Datensatz nicht als meldepflichtig klassifiziert.",
  SOURCE_RESULT_UNKNOWN:
    "Für die gewählte Berufsart enthält der aktuelle Mock-Datensatz kein eindeutiges Ergebnis.",
  MISSING_OCCUPATION_CODE:
    "Für den Meldepflicht-Check wurde keine Berufsart übermittelt.",
  OCCUPATION_CODE_NOT_FOUND:
    "Die gewählte Berufsart ist im aktuellen Mock-Datensatz nicht enthalten.",
  AMBIGUOUS_OCCUPATION_CODE:
    "Die gewählte Berufsart ist mehrdeutig; bitte führen Sie die offizielle Prüfung durch.",
  STALE_DATASET:
    "Der hinterlegte Mock-Datensatz ist nicht mehr aktuell; bitte führen Sie die offizielle Prüfung durch.",
  STALE_OCCUPATION_CODE:
    "Die Klassifikation der gewählten Berufsart ist nicht mehr aktuell; bitte führen Sie die offizielle Prüfung durch.",
  UNSUPPORTED_CANTON:
    "Der gewählte Kanton wird vom Mock-Check nicht unterstützt; bitte führen Sie die offizielle Prüfung durch.",
  INVALID_INPUT:
    "Der Meldepflicht-Check konnte die übermittelten Angaben nicht sicher verarbeiten.",
  INVALID_FIXTURE_DATA:
    "Der versionierte Mock-Datensatz ist ungültig; bitte führen Sie die offizielle Prüfung durch.",
  UNSUPPORTED_SOURCE_RESULT:
    "Das Ergebnis des Mock-Datensatzes wird nicht unterstützt; bitte führen Sie die offizielle Prüfung durch.",
} satisfies Readonly<Record<JobroomReasonCode, string>>);

describe("Jobroom reason copy", () => {
  it("maps every provider reason to reviewed German copy", () => {
    expect(Object.keys(EXPECTED_COPY).sort()).toEqual(
      [...JOBROOM_REASON_CODES].sort(),
    );
    for (const reasonCode of JOBROOM_REASON_CODES) {
      const copy = jobroomReasonCopy(reasonCode);
      expect(copy).toBe(EXPECTED_COPY[reasonCode]);
      expect(copy).not.toContain(reasonCode);
    }
  });

  it("does not expose unknown raw provider reason codes", () => {
    const unknownCode = "FUTURE_PROVIDER_INTERNAL_CODE";
    const copy = jobroomReasonCopy(unknownCode);

    expect(copy).toBe(
      "Der Mock-Check konnte keinen eindeutigen Prüfgrund aus dem versionierten Datensatz ableiten.",
    );
    expect(copy).not.toContain(unknownCode);
  });
});
