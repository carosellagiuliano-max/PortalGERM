import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const JOB_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "CLOSED",
  "REJECTED",
  "REMOVED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "SUBMIT",
  "START_REVIEW",
  "REQUEST_CHANGES",
  "APPROVE",
  "REJECT",
  "PUBLISH",
  "PAUSE_UNCHANGED",
  "PAUSE_FOR_MATERIAL_EDIT",
  "REACTIVATE_UNCHANGED",
  "CREATE_REVISION_FROM_PAUSED",
  "CLONE_REJECTED_REVISION",
  "CLOSE",
  "EXPIRE",
  "ROLLBACK_IMPORT",
] as const;

export type JobTransitionAction = (typeof JOB_TRANSITION_ACTIONS)[number];

export const JOB_ACTOR_CAPABILITIES = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "RECRUITER_EDITOR",
  "RECRUITER_PIPELINE",
  "PLATFORM_REVIEWER",
  "PLATFORM_PUBLISHER",
  "PLATFORM_IMPORT_OPERATOR",
  "SYSTEM_JOB_LIFECYCLE",
] as const;

export type JobActorCapability = (typeof JOB_ACTOR_CAPABILITIES)[number];

type JobPolicyReason =
  | "JOB_CAPABILITY_REQUIRED"
  | "JOB_REASON_REQUIRED"
  | "JOB_TRANSITION_NOT_ALLOWED";

type JobTransitionRule = Readonly<{
  allowedActors: readonly JobActorCapability[];
  allowedFrom: readonly (JobStatus | null)[];
  allowIdempotentReplay?: boolean;
  nextStatus: JobStatus;
  reasonRequired?: boolean;
}>;

const COMPANY_JOB_EDITORS = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "RECRUITER_EDITOR",
] as const satisfies readonly JobActorCapability[];

const COMPANY_JOB_MANAGERS = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
] as const satisfies readonly JobActorCapability[];

const JOB_TRANSITION_RULES = {
  CREATE_DRAFT: {
    allowedActors: [...COMPANY_JOB_EDITORS, "PLATFORM_IMPORT_OPERATOR"],
    allowedFrom: [null],
    nextStatus: "DRAFT",
  },
  SUBMIT: {
    allowedActors: COMPANY_JOB_EDITORS,
    allowedFrom: ["DRAFT", "CHANGES_REQUESTED"],
    nextStatus: "SUBMITTED",
  },
  START_REVIEW: {
    allowedActors: ["PLATFORM_REVIEWER"],
    allowedFrom: ["SUBMITTED"],
    nextStatus: "IN_REVIEW",
  },
  REQUEST_CHANGES: {
    allowedActors: ["PLATFORM_REVIEWER"],
    allowedFrom: ["IN_REVIEW"],
    nextStatus: "CHANGES_REQUESTED",
    reasonRequired: true,
  },
  APPROVE: {
    allowedActors: ["PLATFORM_REVIEWER"],
    allowedFrom: ["IN_REVIEW"],
    nextStatus: "APPROVED",
  },
  REJECT: {
    allowedActors: ["PLATFORM_REVIEWER"],
    allowedFrom: ["IN_REVIEW"],
    nextStatus: "REJECTED",
    reasonRequired: true,
  },
  PUBLISH: {
    allowedActors: ["PLATFORM_PUBLISHER"],
    allowedFrom: ["APPROVED"],
    nextStatus: "PUBLISHED",
  },
  PAUSE_UNCHANGED: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["PUBLISHED"],
    nextStatus: "PAUSED",
  },
  PAUSE_FOR_MATERIAL_EDIT: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["PUBLISHED"],
    nextStatus: "PAUSED",
  },
  REACTIVATE_UNCHANGED: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["PAUSED"],
    nextStatus: "PUBLISHED",
  },
  CREATE_REVISION_FROM_PAUSED: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["PAUSED"],
    nextStatus: "DRAFT",
  },
  CLONE_REJECTED_REVISION: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["REJECTED"],
    allowIdempotentReplay: true,
    nextStatus: "DRAFT",
  },
  CLOSE: {
    allowedActors: COMPANY_JOB_MANAGERS,
    allowedFrom: ["PUBLISHED", "PAUSED", "EXPIRED"],
    nextStatus: "CLOSED",
  },
  EXPIRE: {
    allowedActors: ["SYSTEM_JOB_LIFECYCLE"],
    allowedFrom: ["PUBLISHED"],
    nextStatus: "EXPIRED",
  },
  ROLLBACK_IMPORT: {
    allowedActors: ["PLATFORM_IMPORT_OPERATOR"],
    allowedFrom: ["DRAFT"],
    nextStatus: "REMOVED",
  },
} as const satisfies Record<JobTransitionAction, JobTransitionRule>;

export function decideJobTransition(input: Readonly<{
  action: JobTransitionAction;
  actor: JobActorCapability;
  currentStatus: JobStatus | null;
  reasonCode?: string;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<JobStatus, JobTransitionAction>,
  JobPolicyReason
> {
  const rule: JobTransitionRule = JOB_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("JOB_CAPABILITY_REQUIRED");
  }

  if (rule.reasonRequired && !hasReason(input.reasonCode)) {
    return policyValidation("JOB_REASON_REQUIRED", ["reasonCode"]);
  }

  if (
    input.replay === true &&
    rule.allowIdempotentReplay === true &&
    input.currentStatus === rule.nextStatus
  ) {
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
    return policyConflict("JOB_TRANSITION_NOT_ALLOWED");
  }

  return policyOk(
    transitionDecision({
      action: input.action,
      currentStatus: input.currentStatus,
      nextStatus: rule.nextStatus,
    }),
  );
}

function hasReason(value: string | undefined) {
  return value !== undefined && value.trim().length > 0;
}
