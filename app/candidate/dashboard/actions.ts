"use server";

import { revalidatePath } from "next/cache";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { markCandidateNotificationRead } from "@/lib/candidate/dashboard";
import { getDatabase } from "@/lib/db/client";

export async function markCandidateNotificationReadAction(formData: FormData) {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return;
  const notificationId = String(formData.get("notificationId") ?? "");
  if (await markCandidateNotificationRead(getDatabase(), user.id, notificationId)) {
    revalidatePath("/candidate/dashboard");
  }
}
