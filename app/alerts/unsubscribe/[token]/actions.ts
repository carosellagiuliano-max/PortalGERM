"use server";

import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { unsubscribeJobAlertWithToken } from "@/lib/candidate/job-alerts";

export type UnsubscribeActionState = Readonly<{
  status: "idle" | "complete";
  message: string;
}>;

export const INITIAL_UNSUBSCRIBE_ACTION_STATE: UnsubscribeActionState = Object.freeze({
  status: "idle",
  message: "",
});

const GENERIC_MESSAGE =
  "Falls der Abmeldelink gültig war, wurde dieses Jobabo pausiert. Es wurden keine Kontodaten offengelegt.";

export async function unsubscribeJobAlertAction(
  rawToken: string,
  _previous: UnsubscribeActionState,
  formData: FormData,
): Promise<UnsubscribeActionState> {
  const request = await getAuthRequestContext();
  if (
    !isValidAuthMutationOrigin(request) ||
    ![...formData.keys()].every((field) => field.startsWith("$ACTION_"))
  ) {
    return completeState();
  }
  try {
    await unsubscribeJobAlertWithToken(rawToken, { now: new Date() });
  } catch {
    // Deliberately indistinguishable: never expose token validity, account or alert state.
  }
  return completeState();
}

function completeState(): UnsubscribeActionState {
  return Object.freeze({ status: "complete", message: GENERIC_MESSAGE });
}
