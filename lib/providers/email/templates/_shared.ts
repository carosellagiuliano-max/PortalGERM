import type { EmailTemplateKey } from "@/lib/providers/email/email-provider";

export type EmailTemplateData = Readonly<Record<string, unknown>>;

export type RenderedEmail = Readonly<{
  subject: string;
  body: string;
}>;

export type EmailTemplateRenderer = (
  data: EmailTemplateData,
) => RenderedEmail;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
const WHITESPACE = /\s+/g;

export function text(
  data: EmailTemplateData,
  key: string,
  fallback: string,
  maximumLength = 160,
) {
  const value = data[key];
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .slice(0, maximumLength);
  return normalized || fallback;
}

export function integer(
  data: EmailTemplateData,
  key: string,
  fallback = 0,
) {
  const value = data[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

export function actionUrl(
  data: EmailTemplateData,
  key: string,
): string | undefined {
  const value = data[key];
  if (typeof value !== "string" || value.length > 2_048) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function paragraphs(...values: readonly string[]) {
  return values.filter((value) => value.trim().length > 0).join("\n\n");
}

export function greeting(data: EmailTemplateData) {
  const firstName = text(data, "firstName", "", 80);
  return firstName ? `Guten Tag ${firstName}` : "Guten Tag";
}

export function renderAction(
  data: EmailTemplateData,
  key: string,
  unavailableText: string,
) {
  return actionUrl(data, key) ?? unavailableText;
}

export function assertTemplateRegistryComplete(
  registry: Readonly<Record<EmailTemplateKey, EmailTemplateRenderer>>,
) {
  return registry;
}
