import { z } from "zod";

import {
  ApplicationContactKind,
  ApplicationEffort,
  JobBenefitCode,
  JobType,
  RemoteType,
  RequiredDocumentKind,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import {
  addOrderedRangeIssue,
  isSafeAbsoluteHttpUrl,
  normalizedEmailSchema,
  percentageSchema,
  swissPhoneSchema,
  trimmedString,
  uuidSchema,
  wholeChfSchema,
} from "@/lib/validation/common";

const normalizedContentItemSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/gu, " "))
  .refine(
    (value) => Array.from(value).length >= 20,
    "Must contain at least 20 characters.",
  )
  .refine(
    (value) => Array.from(value).length <= 500,
    "Must contain at most 500 characters.",
  );

export const companyProfileSchema = z
  .object({
    name: trimmedString(2, 200),
    uid: trimmedString(5, 32).optional(),
    industry: trimmedString(2, 160),
    size: trimmedString(1, 64),
    website: trimmedString(3, 512)
      .refine(
        isSafeAbsoluteHttpUrl,
        "Website must be an absolute credential-free HTTP(S) URL.",
      )
      .optional(),
    about: trimmedString(20, 5_000),
    values: z.array(trimmedString(2, 120)).max(20),
    benefits: z.array(trimmedString(2, 160)).max(30),
    responseTargetDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export const jobPostingBasicsSchema = z
  .object({
    title: trimmedString(3, 200),
    description: trimmedString(20, 20_000),
    categoryId: uuidSchema,
    jobType: z.enum(JobType),
  })
  .strict();

export const jobPostingContentSchema = z
  .object({
    tasks: z.array(normalizedContentItemSchema).max(30),
    requirements: z.array(normalizedContentItemSchema).max(30),
    benefits: z
      .array(
        z
          .object({
            benefitCode: z.enum(JobBenefitCode),
            description: normalizedContentItemSchema,
          })
          .strict(),
      )
      .max(20),
    inclusionStatement: z
      .string()
      .transform((value) => value.trim().replace(/\s+/gu, " "))
      .refine((value) => Array.from(value).length >= 30)
      .refine((value) => Array.from(value).length <= 500)
      .optional(),
  })
  .strict();

export const jobPostingConditionsSchema = z
  .object({
    workloadMin: percentageSchema,
    workloadMax: percentageSchema,
    salaryMin: wholeChfSchema.optional(),
    salaryMax: wholeChfSchema.optional(),
    salaryPeriod: z.enum(SalaryPeriod).optional(),
    startDate: z.coerce.date().optional(),
    startByArrangement: z.boolean(),
    validThrough: z.coerce.date(),
    responseTargetDays: z.number().int().min(1).max(30),
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
      value.salaryMin,
      value.salaryMax,
      "salaryMax",
    );
    const salaryParts = [value.salaryMin, value.salaryMax, value.salaryPeriod];
    if (
      salaryParts.some((part) => part !== undefined) &&
      salaryParts.some((part) => part === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryPeriod"],
        message:
          "Salary minimum, maximum and period must be supplied together.",
      });
    }
    if ((value.startDate !== undefined) === value.startByArrangement) {
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Select exactly one start date or start by arrangement.",
      });
    }
  });

export const jobPostingLocationSchema = z
  .object({
    remoteType: z.enum(RemoteType),
    cantonId: uuidSchema.optional(),
    cityId: uuidSchema.optional(),
    remoteCountryCode: z.literal("CH").optional(),
    locationLabel: trimmedString(2, 200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.remoteType === "REMOTE") {
      if (value.remoteCountryCode !== "CH") {
        context.addIssue({
          code: "custom",
          path: ["remoteCountryCode"],
          message: "Remote jobs must explicitly target CH.",
        });
      }
      if (value.cantonId !== undefined || value.cityId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["cantonId"],
          message: "Remote jobs cannot carry canton or city scope.",
        });
      }
    } else {
      if (value.cantonId === undefined || value.cityId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["cityId"],
          message: "Onsite and hybrid jobs need canton and city.",
        });
      }
      if (value.remoteCountryCode !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["remoteCountryCode"],
          message:
            "Onsite and hybrid jobs cannot carry a remote country scope.",
        });
      }
    }
  });

const p0RequiredDocumentSchema = z.enum([
  "NONE",
  "CV",
  "COVER_LETTER",
] satisfies readonly RequiredDocumentKind[]);

export const jobPostingApplicationSchema = z
  .object({
    applicationEffort: z.enum(ApplicationEffort),
    applicationProcessSteps: z
      .array(normalizedContentItemSchema)
      .min(1)
      .max(12),
    requiredDocumentKinds: z.array(p0RequiredDocumentSchema).min(1).max(3),
    applicationContactKind: z.enum(ApplicationContactKind),
    applicationContactValue: trimmedString(3, 512),
  })
  .strict()
  .superRefine((value, context) => {
    const documents = new Set(value.requiredDocumentKinds);
    if (documents.has("NONE") && documents.size > 1) {
      context.addIssue({
        code: "custom",
        path: ["requiredDocumentKinds"],
        message: "NONE cannot be combined with another document.",
      });
    }

    const validContact =
      value.applicationContactKind === "EMAIL"
        ? normalizedEmailSchema.safeParse(value.applicationContactValue).success
        : value.applicationContactKind === "PHONE"
          ? swissPhoneSchema.safeParse(value.applicationContactValue).success
          : isSafeAbsoluteHttpUrl(value.applicationContactValue);
    if (!validContact) {
      context.addIssue({
        code: "custom",
        path: ["applicationContactValue"],
        message: "Contact value does not match its declared kind.",
      });
    }
  });

const finalJobPostingObject = z.object({
  ...jobPostingBasicsSchema.shape,
  ...jobPostingContentSchema.shape,
  workloadMin: percentageSchema,
  workloadMax: percentageSchema,
  salaryMin: wholeChfSchema.optional(),
  salaryMax: wholeChfSchema.optional(),
  salaryPeriod: z.enum(SalaryPeriod).optional(),
  startDate: z.coerce.date().optional(),
  startByArrangement: z.boolean(),
  validThrough: z.coerce.date(),
  responseTargetDays: z.number().int().min(1).max(30),
  remoteType: z.enum(RemoteType),
  cantonId: uuidSchema.optional(),
  cityId: uuidSchema.optional(),
  remoteCountryCode: z.literal("CH").optional(),
  locationLabel: trimmedString(2, 200).optional(),
  applicationEffort: z.enum(ApplicationEffort),
  applicationProcessSteps: z.array(normalizedContentItemSchema).min(1).max(12),
  requiredDocumentKinds: z.array(p0RequiredDocumentSchema).min(1).max(3),
  applicationContactKind: z.enum(ApplicationContactKind),
  applicationContactValue: trimmedString(3, 512),
});

export const jobPostingFinalSchema = finalJobPostingObject
  .strict()
  .superRefine((value, context) => {
    const conditionResult = jobPostingConditionsSchema.safeParse({
      workloadMin: value.workloadMin,
      workloadMax: value.workloadMax,
      salaryMin: value.salaryMin,
      salaryMax: value.salaryMax,
      salaryPeriod: value.salaryPeriod,
      startDate: value.startDate,
      startByArrangement: value.startByArrangement,
      validThrough: value.validThrough,
      responseTargetDays: value.responseTargetDays,
    });
    const locationResult = jobPostingLocationSchema.safeParse({
      remoteType: value.remoteType,
      cantonId: value.cantonId,
      cityId: value.cityId,
      remoteCountryCode: value.remoteCountryCode,
      locationLabel: value.locationLabel,
    });
    const applicationResult = jobPostingApplicationSchema.safeParse({
      applicationEffort: value.applicationEffort,
      applicationProcessSteps: value.applicationProcessSteps,
      requiredDocumentKinds: value.requiredDocumentKinds,
      applicationContactKind: value.applicationContactKind,
      applicationContactValue: value.applicationContactValue,
    });
    for (const result of [conditionResult, locationResult, applicationResult]) {
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            code: "custom",
            path: issue.path,
            message: issue.message,
          });
        }
      }
    }
  });

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type JobPostingBasicsInput = z.infer<typeof jobPostingBasicsSchema>;
export type JobPostingContentInput = z.infer<typeof jobPostingContentSchema>;
export type JobPostingConditionsInput = z.infer<
  typeof jobPostingConditionsSchema
>;
export type JobPostingLocationInput = z.infer<typeof jobPostingLocationSchema>;
export type JobPostingApplicationInput = z.infer<
  typeof jobPostingApplicationSchema
>;
export type JobPostingInput = z.infer<typeof jobPostingFinalSchema>;
