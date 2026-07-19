import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const APPLICATION_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_REJECTION_REASONS = [
  "NOT_A_MATCH",
  "POSITION_FILLED",
  "REQUIREMENTS_NOT_MET",
  "OTHER_REVIEWED",
] as const;

export type ApplicationRejectionReason =
  (typeof APPLICATION_REJECTION_REASONS)[number];

export const APPLICATION_TRANSITION_ACTIONS = [
  "CREATE_SUBMISSION",
  "WITHDRAW",
  "START_REVIEW",
  "SHORTLIST",
  "SCHEDULE_INTERVIEW",
  "MAKE_OFFER",
  "HIRE",
  "REJECT",
] as const;

export type ApplicationTransitionAction =
  (typeof APPLICATION_TRANSITION_ACTIONS)[number];

export const APPLICATION_ACTOR_CAPABILITIES = [
  "CANDIDATE_OWNER",
  "COMPANY_OWNER_PIPELINE",
  "COMPANY_ADMIN_PIPELINE",
  "RECRUITER_EDITOR_PIPELINE",
  "RECRUITER_PIPELINE",
] as const;

export type ApplicationActorCapability =
  (typeof APPLICATION_ACTOR_CAPABILITIES)[number];

type ApplicationPolicyReason =
  | "APPLICATION_CAPABILITY_REQUIRED"
  | "APPLICATION_REJECTION_REASON_INVALID"
  | "APPLICATION_TRANSITION_NOT_ALLOWED";

type ApplicationTransitionRule = Readonly<{
  allowedActors: readonly ApplicationActorCapability[];
  allowedFrom: readonly (ApplicationStatus | null)[];
  nextStatus: ApplicationStatus;
  rejectionReasonRequired?: boolean;
}>;

const COMPANY_PIPELINE_ACTORS = [
  "COMPANY_OWNER_PIPELINE",
  "COMPANY_ADMIN_PIPELINE",
  "RECRUITER_EDITOR_PIPELINE",
  "RECRUITER_PIPELINE",
] as const satisfies readonly ApplicationActorCapability[];

const APPLICATION_TRANSITION_RULES = {
  CREATE_SUBMISSION: {
    allowedActors: ["CANDIDATE_OWNER"],
    allowedFrom: [null],
    nextStatus: "SUBMITTED",
  },
  WITHDRAW: {
    allowedActors: ["CANDIDATE_OWNER"],
    allowedFrom: [
      "SUBMITTED",
      "IN_REVIEW",
      "SHORTLISTED",
      "INTERVIEW",
      "OFFER",
    ],
    nextStatus: "WITHDRAWN",
  },
  START_REVIEW: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["SUBMITTED"],
    nextStatus: "IN_REVIEW",
  },
  SHORTLIST: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["IN_REVIEW"],
    nextStatus: "SHORTLISTED",
  },
  SCHEDULE_INTERVIEW: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["SHORTLISTED"],
    nextStatus: "INTERVIEW",
  },
  MAKE_OFFER: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["INTERVIEW"],
    nextStatus: "OFFER",
  },
  HIRE: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["OFFER"],
    nextStatus: "HIRED",
  },
  REJECT: {
    allowedActors: COMPANY_PIPELINE_ACTORS,
    allowedFrom: ["IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER"],
    nextStatus: "REJECTED",
    rejectionReasonRequired: true,
  },
} as const satisfies Record<
  ApplicationTransitionAction,
  ApplicationTransitionRule
>;

export function decideApplicationTransition(input: Readonly<{
  action: ApplicationTransitionAction;
  actor: ApplicationActorCapability;
  currentStatus: ApplicationStatus | null;
  rejectionReason?: string;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<ApplicationStatus, ApplicationTransitionAction>,
  ApplicationPolicyReason
> {
  const rule: ApplicationTransitionRule =
    APPLICATION_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("APPLICATION_CAPABILITY_REQUIRED");
  }

  if (
    rule.rejectionReasonRequired &&
    !isApplicationRejectionReason(input.rejectionReason)
  ) {
    return policyValidation("APPLICATION_REJECTION_REASON_INVALID", [
      "rejectionReason",
    ]);
  }

  if (input.replay === true && input.currentStatus === rule.nextStatus) {
    return policyOk(
      transitionDecision({
        action: input.action,
        currentStatus: input.currentStatus,
        nextStatus: rule.nextStatus,
        idempotent: true,
      }),
    );
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("APPLICATION_TRANSITION_NOT_ALLOWED");
  }

  return policyOk(
    transitionDecision({
      action: input.action,
      currentStatus: input.currentStatus,
      nextStatus: rule.nextStatus,
    }),
  );
}

export function isApplicationRejectionReason(
  value: string | undefined,
): value is ApplicationRejectionReason {
  return APPLICATION_REJECTION_REASONS.some((reason) => reason === value);
}
