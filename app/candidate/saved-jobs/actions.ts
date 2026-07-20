"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import type { SavedJobActionState } from "@/lib/candidate/saved-job-action-state";
import {
  removeSavedJob,
  saveJobFromSignedIntent,
} from "@/lib/candidate/saved-jobs";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

const GENERIC_SAVE_ERROR =
  "Die Stelle konnte nicht gespeichert werden. Bitte öffne die aktuelle Stellenseite erneut.";

export async function confirmSaveJobAction(
  _previousState: SavedJobActionState,
  formData: FormData,
): Promise<SavedJobActionState> {
  const [user, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (user?.role !== "CANDIDATE" || !isValidAuthMutationOrigin(request)) {
    return errorState(GENERIC_SAVE_ERROR);
  }
  const signedIntent = formData.get("signedIntent");
  if (typeof signedIntent !== "string") return errorState(GENERIC_SAVE_ERROR);
  const environment = getServerEnvironment();
  const result = await saveJobFromSignedIntent(
    { signedIntent, candidateUserId: user.id },
    {
      database: getDatabase(),
      environment,
      signingKey: environment.secrets.session,
    },
  );
  if (!result.ok) {
    return errorState(
      result.code === "LIMIT_REACHED"
        ? "Du kannst höchstens 100 Stellen speichern. Entferne zuerst eine ältere Stelle."
        : GENERIC_SAVE_ERROR,
    );
  }
  revalidatePath("/candidate/saved-jobs");
  revalidatePath(`/jobs/${result.jobSlug}`);
  redirect(`/jobs/${result.jobSlug}?saved=1`);
}

export async function removeSavedJobAction(formData: FormData): Promise<void> {
  const [user, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (user?.role !== "CANDIDATE" || !isValidAuthMutationOrigin(request)) return;
  const savedJobId = formData.get("savedJobId");
  if (typeof savedJobId !== "string") return;
  await removeSavedJob(
    { savedJobId, candidateUserId: user.id },
    getDatabase(),
  );
  revalidatePath("/candidate/saved-jobs");
}

function errorState(message: string): SavedJobActionState {
  return Object.freeze({ status: "error", message });
}
