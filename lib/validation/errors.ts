import { z } from "zod";

export type DeChValidationError = Readonly<{
  field: string;
  code: z.core.$ZodIssue["code"];
  message: string;
}>;

const DE_CH_MESSAGES: Readonly<Record<z.core.$ZodIssue["code"], string>> = {
  invalid_type: "Die Eingabe hat das falsche Format.",
  too_big: "Die Eingabe ist zu gross oder zu lang.",
  too_small: "Die Eingabe ist zu klein oder zu kurz.",
  invalid_format: "Die Eingabe hat kein gültiges Format.",
  not_multiple_of: "Die Eingabe hat eine ungültige Abstufung.",
  unrecognized_keys: "Die Eingabe enthält nicht erlaubte Felder.",
  invalid_union: "Die Eingabe passt zu keiner erlaubten Variante.",
  invalid_key: "Der Schlüssel ist nicht erlaubt.",
  invalid_element: "Ein Listenelement ist nicht gültig.",
  invalid_value: "Die Eingabe enthält einen nicht erlaubten Wert.",
  custom: "Die Eingabe erfüllt die fachliche Regel nicht.",
};

/** Stable de-CH UI mapping that never echoes the rejected input value. */
export function toDeChValidationErrors(error: z.ZodError): readonly DeChValidationError[] {
  return Object.freeze(error.issues.map((issue) => Object.freeze({
    field: issue.path.join(".") || "form",
    code: issue.code,
    message: DE_CH_MESSAGES[issue.code],
  })));
}
