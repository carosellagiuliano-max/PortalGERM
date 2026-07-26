"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import {
  createLegalDraft,
  publishLegalRevision,
  reviewLegalRevision,
  revokeLegalPublication,
} from "@/lib/legal/publication-service";

export async function adminLegalAction(formData: FormData): Promise<void> {
  const [admin, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    redirect("/admin/legal?result=forbidden");
  }
  const operation = single(formData, "operation");
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    now: new Date(),
  } as const;

  const result =
    operation === "create-draft"
      ? await createLegalDraft(
          {
            type: single(formData, "type"),
            locale: single(formData, "locale"),
            title: single(formData, "title"),
            slug: single(formData, "slug"),
            versionLabel: single(formData, "versionLabel"),
            contentMarkdown: single(formData, "contentMarkdown"),
            changeSummary: single(formData, "changeSummary"),
            requiresReconsent:
              single(formData, "requiresReconsent") === "true",
          },
          dependencies,
        )
      : operation === "approve-revision" ||
          operation === "reject-revision"
        ? await reviewLegalRevision(
            {
              revisionId: single(formData, "revisionId"),
              approve: operation === "approve-revision",
              reasonCode: single(formData, "reasonCode"),
            },
            dependencies,
          )
        : operation === "publish-revision"
          ? await publishLegalRevision(
              {
                revisionId: single(formData, "revisionId"),
                effectiveAt: parseDate(single(formData, "effectiveAt")),
                expiresAt: parseOptionalDate(single(formData, "expiresAt")),
                reasonCode: single(formData, "reasonCode"),
              },
              dependencies,
            )
          : operation === "revoke-publication"
            ? await revokeLegalPublication(
                {
                  publicationId: single(formData, "publicationId"),
                  reasonCode: single(formData, "reasonCode"),
                },
                dependencies,
              )
            : null;

  revalidatePath("/admin/legal");
  revalidatePath("/legal/privacy");
  revalidatePath("/legal/terms");
  revalidatePath("/legal/imprint");
  redirect(
    `/admin/legal?result=${
      result === null
        ? "invalid"
        : result.ok
          ? result.replay
            ? "replayed"
            : "saved"
          : result.code.toLowerCase()
    }`,
  );
}

function single(formData: FormData, name: string) {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function parseDate(value: string | null) {
  return new Date(value ?? Number.NaN);
}

function parseOptionalDate(value: string | null) {
  return value === null || value === "" ? null : new Date(value);
}
