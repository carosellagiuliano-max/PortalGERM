import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const CANDIDATE_ONBOARDING_STATUSES = ["DRAFT", "COMPLETE"] as const;

export type CandidateOnboardingStatus =
  (typeof CANDIDATE_ONBOARDING_STATUSES)[number];

export const CANDIDATE_ONBOARDING_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "COMPLETE",
  "REOPEN_AFTER_REQUIRED_DATA_REMOVAL",
] as const;

export type CandidateOnboardingTransitionAction =
  (typeof CANDIDATE_ONBOARDING_TRANSITION_ACTIONS)[number];

export const CANDIDATE_ONBOARDING_ACTOR_CAPABILITIES = [
  "AUTH_REGISTRATION",
  "CANDIDATE_OWNER",
] as const;

export type CandidateOnboardingActorCapability =
  (typeof CANDIDATE_ONBOARDING_ACTOR_CAPABILITIES)[number];

type CandidateOnboardingPolicyReason =
  | "CANDIDATE_ONBOARDING_CAPABILITY_REQUIRED"
  | "CANDIDATE_ONBOARDING_REQUIREMENTS_INCOMPLETE"
  | "CANDIDATE_ONBOARDING_REQUIREMENTS_STILL_COMPLETE"
  | "CANDIDATE_ONBOARDING_TRANSITION_NOT_ALLOWED";

export function decideCandidateOnboardingTransition(input: Readonly<{
  action: CandidateOnboardingTransitionAction;
  actor: CandidateOnboardingActorCapability;
  currentStatus: CandidateOnboardingStatus | null;
  onboardingRequirementsComplete?: boolean;
}>): PolicyResult<
  TransitionDecision<
    CandidateOnboardingStatus,
    CandidateOnboardingTransitionAction
  >,
  CandidateOnboardingPolicyReason
> {
  if (input.action === "CREATE_DRAFT") {
    if (input.actor !== "AUTH_REGISTRATION") {
      return policyForbidden("CANDIDATE_ONBOARDING_CAPABILITY_REQUIRED");
    }
    if (input.currentStatus !== null) {
      return policyConflict("CANDIDATE_ONBOARDING_TRANSITION_NOT_ALLOWED");
    }
    return accepted(input, "DRAFT");
  }

  if (input.actor !== "CANDIDATE_OWNER") {
    return policyForbidden("CANDIDATE_ONBOARDING_CAPABILITY_REQUIRED");
  }

  if (input.action === "COMPLETE") {
    if (input.onboardingRequirementsComplete !== true) {
      return policyValidation(
        "CANDIDATE_ONBOARDING_REQUIREMENTS_INCOMPLETE",
      );
    }
    if (input.currentStatus !== "DRAFT") {
      return policyConflict("CANDIDATE_ONBOARDING_TRANSITION_NOT_ALLOWED");
    }
    return accepted(input, "COMPLETE");
  }

  if (input.onboardingRequirementsComplete !== false) {
    return policyValidation(
      "CANDIDATE_ONBOARDING_REQUIREMENTS_STILL_COMPLETE",
    );
  }
  if (input.currentStatus !== "COMPLETE") {
    return policyConflict("CANDIDATE_ONBOARDING_TRANSITION_NOT_ALLOWED");
  }
  return accepted(input, "DRAFT");
}

function accepted(
  input: Readonly<{
    action: CandidateOnboardingTransitionAction;
    currentStatus: CandidateOnboardingStatus | null;
  }>,
  nextStatus: CandidateOnboardingStatus,
) {
  return policyOk(
    transitionDecision({
      action: input.action,
      currentStatus: input.currentStatus,
      nextStatus,
    }),
  );
}
