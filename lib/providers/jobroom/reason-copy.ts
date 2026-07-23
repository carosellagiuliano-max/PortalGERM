import type { JobroomReasonCode } from "./jobroom-provider";

const JOBROOM_REASON_COPY = Object.freeze({
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

const UNKNOWN_REASON_COPY =
  "Der Mock-Check konnte keinen eindeutigen Prüfgrund aus dem versionierten Datensatz ableiten.";

export function jobroomReasonCopy(reasonCode: string) {
  return Object.prototype.hasOwnProperty.call(JOBROOM_REASON_COPY, reasonCode)
    ? JOBROOM_REASON_COPY[reasonCode as JobroomReasonCode]
    : UNKNOWN_REASON_COPY;
}
