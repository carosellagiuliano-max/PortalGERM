import type { FairJobReasonCodeV2 } from "@/lib/scoring/fair-job-score";

export const FAIR_JOB_REASON_FALLBACK_HINT_DE_V2 =
  "Prüfe die Angaben in diesem Abschnitt und ergänze fehlende oder unklare Informationen.";

export const FAIR_JOB_REASON_HINTS_DE_V2 = Object.freeze({
  SALARY_MISSING:
    "Ergänze eine vollständige, plausible Lohnspanne mit Minimum, Maximum und Lohnperiode.",
  SALARY_PARTIAL:
    "Vervollständige die Lohnangaben: Minimum, Maximum und Lohnperiode müssen zusammenpassen.",
  SALARY_MET: "Die Lohnspanne ist vollständig und plausibel angegeben.",
  TASKS_REQUIREMENTS_MISSING:
    "Beschreibe mindestens drei konkrete Aufgaben und drei konkrete Muss-Anforderungen.",
  TASKS_REQUIREMENTS_PARTIAL:
    "Ergänze Aufgaben und Muss-Anforderungen auf jeweils mindestens drei konkrete Punkte.",
  TASKS_REQUIREMENTS_MET:
    "Aufgaben und Muss-Anforderungen sind ausreichend konkret beschrieben.",
  WORKLOAD_CONTRACT_START_MISSING:
    "Gib Pensum, Vertragsart und entweder ein Startdatum oder «nach Vereinbarung» eindeutig an.",
  WORKLOAD_CONTRACT_START_PARTIAL:
    "Vervollständige Pensum, Vertragsart und Startangabe, damit alle drei Angaben eindeutig sind.",
  WORKLOAD_CONTRACT_START_MET:
    "Pensum, Vertragsart und Startangabe sind vollständig definiert.",
  LOCATION_REMOTE_MISSING:
    "Definiere das Arbeitsmodell und ergänze den dazu passenden Arbeitsort oder das Remote-Land.",
  LOCATION_REMOTE_PARTIAL:
    "Vervollständige Arbeitsmodell und Ortsangaben, damit der mögliche Arbeitsort eindeutig ist.",
  LOCATION_REMOTE_MET:
    "Arbeitsmodell und mögliche Arbeitsorte sind eindeutig angegeben.",
  APPLICATION_PROCESS_MISSING:
    "Beschreibe mindestens einen konkreten Bewerbungsschritt und wähle Aufwand sowie benötigte Unterlagen.",
  APPLICATION_PROCESS_PARTIAL:
    "Vervollständige Bewerbungsschritte, Aufwand und benötigte Unterlagen.",
  APPLICATION_PROCESS_MET:
    "Bewerbungsprozess, Aufwand und benötigte Unterlagen sind nachvollziehbar.",
  RESPONSE_TARGET_MISSING:
    "Nenne ein realistisches Antwortziel zwischen 1 und 30 Tagen.",
  RESPONSE_TARGET_PARTIAL:
    "Präzisiere das Antwortziel als Anzahl Tage zwischen 1 und 30.",
  RESPONSE_TARGET_MET: "Das Antwortziel ist klar und realistisch angegeben.",
  BENEFITS_MISSING:
    "Beschreibe mindestens zwei unterschiedliche Benefits mit konkretem Nutzen.",
  BENEFITS_PARTIAL:
    "Ergänze einen weiteren konkreten Benefit oder präzisiere die vorhandenen Leistungen.",
  BENEFITS_MET: "Mindestens zwei konkrete Benefits sind nachvollziehbar beschrieben.",
  INCLUSION_CONTACT_MISSING:
    "Ergänze einen konkreten Inklusionshinweis und einen gültigen Bewerbungskontakt.",
  INCLUSION_CONTACT_PARTIAL:
    "Vervollständige Inklusionshinweis und Bewerbungskontakt, damit beides eindeutig ist.",
  INCLUSION_CONTACT_MET:
    "Inklusionshinweis und Bewerbungskontakt sind vollständig angegeben.",
  FRESHNESS_MISSING:
    "Setze ein zukünftiges Gültigkeitsdatum innerhalb der nächsten 120 Tage.",
  FRESHNESS_PARTIAL:
    "Prüfe das Gültigkeitsdatum und lege es innerhalb der nächsten 120 Tage fest.",
  FRESHNESS_MET: "Das Inserat hat ein aktuelles, plausibles Gültigkeitsdatum.",
} satisfies Readonly<Record<FairJobReasonCodeV2, string>>);

export function getFairJobEmployerHintDe(reasonCode: unknown): string {
  if (typeof reasonCode !== "string") {
    return FAIR_JOB_REASON_FALLBACK_HINT_DE_V2;
  }

  const normalized = reasonCode.trim();
  if (
    normalized === "" ||
    !Object.prototype.hasOwnProperty.call(
      FAIR_JOB_REASON_HINTS_DE_V2,
      normalized,
    )
  ) {
    return FAIR_JOB_REASON_FALLBACK_HINT_DE_V2;
  }

  return FAIR_JOB_REASON_HINTS_DE_V2[normalized as FairJobReasonCodeV2];
}
