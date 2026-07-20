import { z } from "zod";

import {
  JobType,
  LanguageLevel,
  RemotePreference,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import {
  MOCK_STORAGE_ALLOWED_MIME_TYPES,
  MOCK_STORAGE_POLICY_V1,
} from "@/lib/providers/storage/mock-storage-provider";
import {
  addOrderedRangeIssue,
  percentageSchema,
  trimmedString,
  uuidSchema,
  wholeChfSchema,
} from "@/lib/validation/common";

export const CANDIDATE_LANGUAGE_CODES = ["de", "fr", "it", "en"] as const;
export const CANDIDATE_LANGUAGE_CODE_PATTERN = /^[a-z]{2}$/u;

// CandidatePreference is constrained to a real percentage value in Postgres.
// Keep the shared percentage schema unchanged because other contracts may
// deliberately accept zero.
const candidateWorkloadPercentageSchema = percentageSchema.min(1);

// Kept local so draft validation remains available while the Prisma client is
// regenerated together with the Phase-09 migration.
export const WORK_PERMIT_TYPES = [
  "SWISS_OR_EU_EFTA",
  "B",
  "C",
  "G",
  "L",
  "F",
  "N",
  "S",
  "OTHER",
] as const;

const candidateLanguageSchema = z
  .object({
    code: trimmedString(2, 2)
      .transform((code) => code.toLowerCase())
      .pipe(
        z
          .string()
          .regex(
            CANDIDATE_LANGUAGE_CODE_PATTERN,
            "Language code must contain exactly two ASCII letters.",
          ),
      ),
    level: z.enum(LanguageLevel),
  })
  .strict();

export const candidateCvMetadataSchema = z
  .object({
    fileName: trimmedString(
      1,
      MOCK_STORAGE_POLICY_V1.maximumFileNameCharacters,
    ),
    mimeType: z.enum(MOCK_STORAGE_ALLOWED_MIME_TYPES),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MOCK_STORAGE_POLICY_V1.maximumBytes),
  })
  .strict();

/**
 * Progressive draft schema. Completeness is intentionally evaluated by the
 * canonical onboarding predicate in `lib/candidate/profile.ts`, not by making
 * every field required here.
 */
export const swissJobPassSchema = z
  .object({
    firstName: trimmedString(1, 100).optional(),
    lastName: trimmedString(1, 100).optional(),
    publicDisplayName: trimmedString(2, 160).optional(),
    phone: trimmedString(7, 40)
      .regex(
        /^\+?[0-9() ./-]+$/u,
        "Phone number contains unsupported characters.",
      )
      .optional(),
    cantonId: uuidSchema.optional(),
    cityLabel: trimmedString(2, 160).optional(),
    summary: trimmedString(1, 500).optional(),
    desiredTitles: z.array(trimmedString(2, 120)).max(12).default([]),
    skillIds: z.array(uuidSchema).max(50).default([]),
    languages: z.array(candidateLanguageSchema).max(12).default([]),
    categoryIds: z.array(uuidSchema).max(18).default([]),
    // Retained for compatibility with the Phase-03 contract. The current
    // schema stores the home canton and mobility radius, not a second canton
    // join table.
    acceptableCantonIds: z.array(uuidSchema).max(26).default([]),
    workloadMin: candidateWorkloadPercentageSchema.optional(),
    workloadMax: candidateWorkloadPercentageSchema.optional(),
    desiredSalaryMin: wholeChfSchema.optional(),
    desiredSalaryMax: wholeChfSchema.optional(),
    desiredSalaryPeriod: z.enum(SalaryPeriod).optional(),
    jobTypes: z.array(z.enum(JobType)).max(6).default([]),
    remotePreference: z.enum(RemotePreference).optional(),
    mobilityRadiusKm: z.number().int().min(0).max(300).optional(),
    availabilityDate: z.coerce.date().optional(),
    workPermitType: z.enum(WORK_PERMIT_TYPES).optional(),
    radarVisible: z.boolean().default(false),
    cv: candidateCvMetadataSchema.optional(),
    removeCv: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    addOrderedRangeIssue(
      context,
      value.workloadMin,
      value.workloadMax,
      "workloadMax",
    );
    addOrderedRangeIssue(
      context,
      value.desiredSalaryMin,
      value.desiredSalaryMax,
      "desiredSalaryMax",
    );

    requireCompleteOptionalGroup(
      context,
      [value.workloadMin, value.workloadMax],
      "workloadMax",
      "Workload minimum and maximum must be supplied together.",
    );
    requireCompleteOptionalGroup(
      context,
      [
        value.desiredSalaryMin,
        value.desiredSalaryMax,
        value.desiredSalaryPeriod,
      ],
      "desiredSalaryPeriod",
      "Salary minimum, maximum and period must be supplied together.",
    );

    addUniqueArrayIssue(context, value.desiredTitles, "desiredTitles");
    addUniqueArrayIssue(context, value.skillIds, "skillIds");
    addUniqueArrayIssue(context, value.categoryIds, "categoryIds");
    addUniqueArrayIssue(
      context,
      value.acceptableCantonIds,
      "acceptableCantonIds",
    );
    addUniqueArrayIssue(context, value.jobTypes, "jobTypes");
    addUniqueArrayIssue(
      context,
      value.languages.map(({ code }) => code),
      "languages",
    );

    if (value.cv !== undefined && value.removeCv) {
      context.addIssue({
        code: "custom",
        path: ["removeCv"],
        message: "A CV cannot be uploaded and removed in the same command.",
      });
    }
  });

export const applicationSchema = z
  .object({
    jobId: uuidSchema,
    coverLetter: trimmedString(20, 5_000).optional(),
    documentMetadataIds: z.array(uuidSchema).max(12).default([]),
    idempotencyKey: trimmedString(8, 128),
  })
  .strict();

export type SwissJobPassInput = z.infer<typeof swissJobPassSchema>;
export type CandidateCvMetadataInput = z.infer<
  typeof candidateCvMetadataSchema
>;
export type CandidateApplicationInput = z.infer<typeof applicationSchema>;

function requireCompleteOptionalGroup(
  context: z.RefinementCtx,
  parts: readonly unknown[],
  path: string,
  message: string,
) {
  if (
    parts.some((part) => part !== undefined) &&
    parts.some((part) => part === undefined)
  ) {
    context.addIssue({ code: "custom", path: [path], message });
  }
}

function addUniqueArrayIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: string,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: "Values must be unique.",
    });
  }
}
