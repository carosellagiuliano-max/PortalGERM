"use server";

import {
  createPublicReport,
  publicReportInputSchema,
  type ResolvedPublicReportTarget,
} from "@/lib/abuse/public-report";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getPublicCompanyCardBySlug } from "@/lib/companies/public-read-model";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { emailProvider } from "@/lib/providers/email";
import { getPublicJobBySlug } from "@/lib/jobs/public-read-model";
import type { PublicReportActionState } from "@/lib/abuse/public-report-state";
import {
  preflightPublicIntakePrivacyGate,
  readPublicIntakePrivacyExpectedBinding,
} from "@/lib/privacy/public-intake-privacy-gate";

export async function submitPublicReportAction(
  _previousState: PublicReportActionState,
  formData: FormData,
): Promise<PublicReportActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return errorState("Die Meldung konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.");
  }

  const parsed = publicReportInputSchema.safeParse({
    targetType: formData.get("targetType"),
    slug: formData.get("slug"),
    reasonCode: formData.get("reasonCode"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return errorState("Bitte wähle einen Grund und beschreibe das Problem mit mindestens 20 Zeichen.");
  }

  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();
  const privacyBinding = readPublicIntakePrivacyExpectedBinding(
    formData,
    "ABUSE_REPORT",
  );
  if (
    privacyBinding === null ||
    !(await preflightPublicIntakePrivacyGate(privacyBinding, {
      database,
      environment,
      now,
    })).allowed
  ) {
    return errorState(
      "Der Datenschutzhinweis ist nicht verfügbar oder hat sich geändert. Es wurden keine Angaben übermittelt. Bitte lade die Seite neu.",
    );
  }
  const currentUser = await getCurrentUser();
  const resolved = await resolveReportTarget(parsed.data.targetType, parsed.data.slug);
  const result = await createPublicReport(
    parsed.data,
    resolved,
    {
      database,
      environment,
      request,
      currentUser,
      emailProvider,
      now,
      privacyBinding,
    },
  );

  if (result.ok) {
    return Object.freeze({
      status: "success",
      message: "Danke. Deine Meldung wurde sicher erfasst und wird geprüft.",
    });
  }
  if (result.code === "RATE_LIMITED") {
    return errorState("Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut.");
  }
  if (result.code === "INVALID_INPUT") {
    return errorState("Bitte wähle einen Grund und beschreibe das Problem mit mindestens 20 Zeichen.");
  }
  if (result.code === "PRIVACY_UNAVAILABLE") {
    return errorState(
      "Der Datenschutzhinweis ist nicht verfügbar oder hat sich geändert. Es wurden keine Angaben übermittelt. Bitte lade die Seite neu.",
    );
  }
  return errorState("Die Meldung konnte nicht erfasst werden. Bitte versuche es später erneut.");
}

async function resolveReportTarget(
  targetType: "JOB" | "COMPANY",
  slug: string,
): Promise<ResolvedPublicReportTarget | null> {
  if (targetType === "JOB") {
    const job = await getPublicJobBySlug(slug);
    return job === null ? null : Object.freeze({ id: job.id, targetType, companyId: job.company.id });
  }
  const company = await getPublicCompanyCardBySlug(slug, 0);
  return company === null ? null : Object.freeze({ id: company.id, targetType, companyId: company.id });
}

function errorState(message: string): PublicReportActionState {
  return Object.freeze({ status: "error", message });
}
