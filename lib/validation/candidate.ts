import { z } from "zod";

import {
  JobType,
  LanguageLevel,
  RemotePreference,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import {
  addOrderedRangeIssue,
  percentageSchema,
  trimmedString,
  uuidSchema,
  wholeChfSchema,
} from "@/lib/validation/common";

const candidateLanguageSchema = z
  .object({
    code: trimmedString(2, 16).transform((code) => code.toLowerCase()),
    level: z.enum(LanguageLevel),
  })
  .strict();

export const swissJobPassSchema = z
  .object({
    publicDisplayName: trimmedString(2, 160),
    cantonId: uuidSchema,
    summary: trimmedString(20, 3_000),
    skillIds: z.array(uuidSchema).max(50),
    languages: z.array(candidateLanguageSchema).max(12),
    acceptableCantonIds: z.array(uuidSchema).max(26),
    workloadMin: percentageSchema,
    workloadMax: percentageSchema,
    desiredSalaryMin: wholeChfSchema.optional(),
    desiredSalaryMax: wholeChfSchema.optional(),
    desiredSalaryPeriod: z.enum(SalaryPeriod).optional(),
    jobTypes: z.array(z.enum(JobType)).max(6),
    remotePreference: z.enum(RemotePreference),
    availabilityDate: z.coerce.date().optional(),
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
    const salaryParts = [
      value.desiredSalaryMin,
      value.desiredSalaryMax,
      value.desiredSalaryPeriod,
    ];
    if (
      salaryParts.some((part) => part !== undefined) &&
      salaryParts.some((part) => part === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["desiredSalaryPeriod"],
        message:
          "Salary minimum, maximum and period must be supplied together.",
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
export type CandidateApplicationInput = z.infer<typeof applicationSchema>;
