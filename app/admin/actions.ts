"use server";

import { revalidatePath } from "next/cache";

import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { emailProvider } from "@/lib/providers/email";
import { startAdminJobReview, requestAdminJobChanges, approveAdminJob, rejectAdminJob, publishAdminJob, cancelAdminJobBoost, projectAdminBoostStatuses } from "@/lib/admin/jobs";
import { requestCompanyVerificationEvidence, verifyCompany, rejectCompanyVerification, revokeCompanyVerification, suspendCompany, reactivateCompany, requestCompanyClaimEvidence, rejectCompanyClaim, approveCompanyClaim } from "@/lib/admin/companies";
import { suspendUser, reactivateUser, forceLogoutUser } from "@/lib/admin/users";
import { mutateAdminTaxonomy } from "@/lib/admin/taxonomy";
import { triageAbuseReport, applyModerationRestriction, liftModerationRestriction, expireModerationRestriction, resolveAbuseReport, dismissAbuseReport } from "@/lib/admin/moderation";
import { parseLicensedImport, decideImportItem, commitImportRun, rollbackImportRun, approveImportSetup, revokeImportSetup, expireImportSetup } from "@/lib/admin/imports";
import { manageSupportCase } from "@/lib/admin/support";
import { projectExpiredClusterLaunches, saveContentDraft, transitionContentRevision, transitionClusterLaunch } from "@/lib/admin/content";
import { evaluateClusterLaunch } from "@/lib/admin/cluster-launch";
import { manageSalesLead } from "@/lib/admin/leads";
import { projectAdminSlaAlerts } from "@/lib/admin/sla";
import { deactivatePlanVersion, deactivateProductVersion, grantAdminCredits, reverseCreditConsume, schedulePlanVersion, scheduleProductVersion } from "@/lib/billing/admin-billing";
import { adminMockRenewSubscription, type AdminMockRenewalResult } from "@/lib/billing/admin-renewal";
import { projectDueCatalogVersions } from "@/lib/billing/catalog-lifecycle";
import { recordProductReleaseDecision } from "@/lib/billing/product-release";
import { projectDueSubscriptionBoundaries, type SubscriptionBoundaryProjectionResult } from "@/lib/billing/subscriptions";
import { projectDueCreditExpiries, type CreditExpiryProjectionResult } from "@/lib/billing/credits";

export type AdminActionState = Readonly<{ status: "idle" | "success" | "error"; message: string; code?: string }>;
export const INITIAL_ADMIN_ACTION_STATE: AdminActionState = Object.freeze({ status: "idle", message: "" });

export async function adminCommandAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const [user, request] = await Promise.all([requireAdminPage(), getAuthRequestContext()]);
  if (!isValidAuthMutationOrigin(request)) return errorState("Die Anfrage konnte nicht sicher bestätigt werden.", "FORBIDDEN");
  const operation = singleValue(formData, "operation");
  if (operation === null) return errorState("Das Formular ist unvollständig.", "INVALID_INPUT");
  const input = formObject(formData);
  delete input.operation;
  const dependencies = Object.freeze({ actor: { userId: user.id, email: user.email, role: user.role, status: user.status }, correlationId: request.correlationId, database: getDatabase(), now: new Date() });
  try {
    const result = operation === "job-start-review" ? await startAdminJobReview(input as never, dependencies)
      : operation === "job-request-changes" ? await requestAdminJobChanges(input as never, dependencies)
        : operation === "job-approve" ? await approveAdminJob(input as never, dependencies, emailProvider)
          : operation === "job-reject" ? await rejectAdminJob(input as never, dependencies, emailProvider)
            : operation === "job-publish" ? await publishAdminJob(input as never, dependencies)
              : operation === "job-boost-cancel" ? await cancelAdminJobBoost(input, dependencies)
                : operation === "boost-status-project" ? await projectAdminBoostStatuses(input, dependencies)
              : operation === "verification-evidence" ? await requestCompanyVerificationEvidence(input as never, dependencies)
                : operation === "verification-verify" ? await verifyCompany(input as never, dependencies)
                  : operation === "verification-reject" ? await rejectCompanyVerification(input as never, dependencies)
                    : operation === "verification-revoke" ? await revokeCompanyVerification(input as never, dependencies)
                      : operation === "company-suspend" ? await suspendCompany(input, dependencies)
                        : operation === "company-reactivate" ? await reactivateCompany(input, dependencies)
                          : operation === "claim-evidence" ? await requestCompanyClaimEvidence(input, dependencies)
                            : operation === "claim-reject" ? await rejectCompanyClaim(input, dependencies)
                              : operation === "claim-approve" ? await approveCompanyClaim(input, dependencies)
                                : operation === "user-suspend" ? await suspendUser(input, dependencies)
                                  : operation === "user-reactivate" ? await reactivateUser(input, dependencies)
                                    : operation === "user-force-logout" ? await forceLogoutUser(input, dependencies)
                                      : operation === "taxonomy-mutate" ? await mutateAdminTaxonomy(input, dependencies)
                                        : operation === "report-triage" ? await triageAbuseReport(input, dependencies)
                                          : operation === "restriction-apply" ? await applyModerationRestriction(input, dependencies)
                                            : operation === "restriction-lift" ? await liftModerationRestriction(input, dependencies)
                                              : operation === "restriction-expire" ? await expireModerationRestriction(input, dependencies)
                                                : operation === "report-resolve" ? await resolveAbuseReport(input, dependencies)
                                                  : operation === "report-dismiss" ? await dismissAbuseReport(input, dependencies)
                                                    : operation === "import-parse" ? await parseLicensedImport(input, dependencies)
                                                      : operation === "import-decision" ? await decideImportItem(input, dependencies)
                                                        : operation === "import-commit" ? await commitImportRun(input, dependencies)
                                                          : operation === "import-rollback" ? await rollbackImportRun(input, dependencies)
                                                            : operation === "import-setup-approve" ? await approveImportSetup(input, dependencies)
                                                              : operation === "import-setup-revoke" ? await revokeImportSetup(input, dependencies)
                                                                : operation === "import-setup-expire" ? await expireImportSetup(input, dependencies)
                                                                  : operation === "support-manage" ? await manageSupportCase(input, dependencies)
                                                                    : operation === "content-draft" ? await saveContentDraft(input, dependencies)
                                                                      : operation === "content-transition" ? await transitionContentRevision(input, dependencies)
                                                                        : operation === "cluster-evaluate" ? await evaluateClusterLaunch(input, dependencies)
                                                                          : operation === "cluster-expire" ? await projectExpiredClusterLaunches(input, dependencies)
                                                                            : operation === "cluster-transition" ? await transitionClusterLaunch(input, dependencies)
                                                                          : operation === "lead-manage" ? await manageSalesLead(input, dependencies)
                                                                          : operation === "sla-project" ? await projectAdminSlaAlerts(input as never, dependencies)
                                                                            : operation === "credit-grant" ? await grantAdminCredits(input, dependencies)
                                                                              : operation === "credit-reverse" ? await reverseCreditConsume(input, dependencies)
                                                                                : operation === "catalog-plan-schedule" ? await schedulePlanVersion(input, dependencies)
                                                                                  : operation === "catalog-product-release-decide" ? await recordProductReleaseDecision(input, dependencies)
                                                                                  : operation === "catalog-product-schedule" ? await scheduleProductVersion(input, dependencies)
                                                                                    : operation === "catalog-plan-deactivate" ? await deactivatePlanVersion(input, dependencies)
                                                                                      : operation === "catalog-product-deactivate" ? await deactivateProductVersion(input, dependencies)
                                                                                        : operation === "catalog-project-due" ? await projectDueCatalogVersions(input, dependencies)
                                                                                          : operation === "subscription-renew-mock" ? await adminMockRenewSubscription(input, dependencies)
                                                                                            : operation === "subscription-boundaries-project" ? await projectDueSubscriptionBoundaries(input, dependencies)
                                                                                              : operation === "credit-expiries-project" ? await projectDueCreditExpiries(input, dependencies)
                                                                                          : null;
    if (result === null) return errorState("Unbekannte Admin-Aktion.", "INVALID_INPUT");
    if (!result.ok) return errorState(messageForCode(result.code), result.code);
    revalidateAdminPaths();
    if (operation === "subscription-boundaries-project") {
      revalidateSubscriptionBoundaryPaths();
      return Object.freeze({
        status: "success",
        message: subscriptionProjectionMessage(result.value as SubscriptionBoundaryProjectionResult),
      });
    }
    if (operation === "credit-expiries-project") {
      const projection = result.value as CreditExpiryProjectionResult;
      return Object.freeze({
        status: "success",
        message: `Credit-Ablauf projiziert: ${projection.projectedGrantCount} Grant(s), ${projection.expiredCreditAmount} Credit(s).`,
      });
    }
    if (operation === "boost-status-project") {
      const projection = result.value as { activated: number; expired: number };
      return Object.freeze({
        status: "success",
        message: `Boost-Projektion abgeschlossen: ${projection.activated} aktiviert, ${projection.expired} abgelaufen.`,
      });
    }
    if (operation === "subscription-renew-mock") {
      const renewal = result.value as AdminMockRenewalResult;
      revalidatePath(`/admin/companies/${renewal.companyId}`);
      revalidateSubscriptionBoundaryPaths();
      return Object.freeze({
        status: "success",
        message: result.replay
          ? "Mock-Verlängerung war bereits sicher verarbeitet. Es wurde keine Zahlung oder Rechnung erzeugt."
          : "Mock-Verlängerung wurde aktiviert. Es wurde keine Zahlung oder Rechnung erzeugt.",
      });
    }
    return Object.freeze({ status: "success", message: result.replay ? "Aktion war bereits sicher verarbeitet." : "Aktion wurde sicher verarbeitet." });
  } catch {
    return errorState("Die Aktion konnte nicht vollständig ausgeführt werden.", "WRITE_FAILED");
  }
}

function formObject(formData: FormData) {
  const output: Record<string, unknown> = {};
  for (const key of new Set([...formData.keys()].filter((field) => !field.startsWith("$ACTION_")))) {
    const values = formData.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string") return {};
    const value = values[0].trim();
    output[key] = value === "" ? null : value === "true" ? true : value === "false" ? false : value;
  }
  return output;
}
function singleValue(formData: FormData, key: string) { const values = formData.getAll(key); return values.length === 1 && typeof values[0] === "string" ? values[0].trim() : null; }
function errorState(message: string, code: string): AdminActionState { return Object.freeze({ status: "error", message, code }); }
function messageForCode(code: string) { return code === "CONFLICT" ? "Der Datensatz wurde inzwischen geändert. Bitte lade den aktuellen Stand neu." : code === "FORBIDDEN" ? "Für diese Aktion fehlt die Berechtigung." : code === "NOT_FOUND" ? "Der Datensatz ist nicht mehr verfügbar." : code === "QUOTA_EXCEEDED" ? "Das aktuelle Nutzungslimit verhindert diese Aktion." : code === "RESTRICTED" ? "Eine aktive Moderationssperre verhindert diese Aktion." : code === "VERIFICATION_REQUIRED" ? "Die Firma ist aktuell nicht gültig verifiziert." : code === "INCOMPLETE" ? "Die nötigen Entscheidungen oder Angaben sind noch nicht vollständig." : code === "INVALID_INPUT" ? "Bitte prüfe die Eingaben." : "Die Änderung konnte nicht gespeichert werden."; }
function revalidateAdminPaths() { for (const path of ["/admin", "/admin/jobs", "/admin/companies", "/admin/users", "/admin/taxonomy", "/admin/reports", "/admin/imports", "/admin/support", "/admin/content", "/admin/leads", "/admin/billing", "/admin/orders", "/admin/invoices", "/admin/plans", "/admin/products", "/admin/analytics", "/admin/business-cockpit", "/jobs", "/companies", "/guide", "/support"]) revalidatePath(path); }
function revalidateSubscriptionBoundaryPaths() { for (const path of ["/employer/billing", "/employer/jobs", "/employer/team"]) revalidatePath(path); }
function subscriptionProjectionMessage(result: SubscriptionBoundaryProjectionResult) { return `Projektion abgeschlossen: ${result.appliedCancellationCount} Kündigung(en), ${result.appliedDowngradeCount} Downgrade(s), ${result.expiredSubscriptionCount} natürliche Vertragsabläufe angewendet.`; }
