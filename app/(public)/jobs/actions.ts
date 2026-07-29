"use server";

import { createHash, randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  createPrismaAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
import {
  getProductAnalyticsRuntimeProvenanceV1,
  isProductAnalyticsEnabledV1,
} from "@/lib/analytics/runtime-policy";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/request-context";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  buildJobIntentNextPath,
  JOB_INTENT_ACTIONS_V1,
  signJobIntent,
} from "@/lib/auth/signed-intent";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { publicApplicationHref } from "@/lib/jobs/job-json-ld";
import { getPublicJobBySlug } from "@/lib/jobs/public-read-model";
import { resolveSearchConceptKeysV2 } from "@/lib/search/concepts-v2";
import { recordSearchLearningObservation } from "@/lib/search/learning";
import {
  EXTERNAL_APPLICATION_RESUME_POLICY_V1,
  signExternalApplicationResumeIntent,
} from "@/lib/recruiting/external-application-intent";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";

const startIntentSchema = z.strictObject({
  action: z.enum(JOB_INTENT_ACTIONS_V1),
  jobSlug: z
    .string()
    .min(1)
    .max(220)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  analyticsSessionId: z.string().uuid().optional(),
});

const publicProductAnalyticsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SEARCH_RESULTS_VIEWED"),
    eventId: z.string().uuid(),
    analyticsSessionId: z.string().uuid(),
    resultCountBucket: z.enum(["0", "1-9", "10-24", "25-49", "50+"]),
    sort: z.enum(["relevance", "newest", "fair-score", "salary", "response"]),
    cantonCode: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .optional(),
    categorySlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .optional(),
    searchQuery: z.string().trim().min(1).max(160).optional(),
    searchFilters: z
      .strictObject({
        canton: safeLearningTokenList().optional(),
        city: safeLearningTokenList().optional(),
        radius: z.number().int().min(1).max(200).optional(),
        category: safeLearningTokenList().optional(),
        workloadMin: z.number().int().min(0).max(100).optional(),
        workloadMax: z.number().int().min(0).max(100).optional(),
        jobType: safeLearningTokenList().optional(),
        remoteType: safeLearningTokenList().optional(),
        language: safeLearningTokenList().optional(),
        applicationEffort: safeLearningTokenList().optional(),
        salaryPeriod: safeLearningTokenList().optional(),
        salaryDisclosed: z.boolean().optional(),
        evidence: safeLearningTokenList().optional(),
        companyVerified: z.boolean().optional(),
        sort: safeLearningTokenList().optional(),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("JOB_DETAIL_VIEWED"),
    eventId: z.string().uuid(),
    analyticsSessionId: z.string().uuid(),
    jobSlug: z
      .string()
      .min(1)
      .max(220)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  }),
]);

export async function startPublicJobIntentAction(
  formData: FormData,
): Promise<void> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) redirect("/jobs");
  const parsed = startIntentSchema.safeParse({
    action: formData.get("action"),
    jobSlug: formData.get("jobSlug"),
    analyticsSessionId: optionalFormString(formData.get("analyticsSessionId")),
  });
  if (!parsed.success) redirect("/jobs");
  const now = new Date();
  const job = await getPublicJobBySlug(parsed.data.jobSlug, { now });
  if (job === null) redirect("/jobs");
  const environment = getServerEnvironment();
  const productAnalyticsEnabled = isProductAnalyticsEnabledV1(
    environment.APP_ENV,
  );
  const analyticsSessionId = productAnalyticsEnabled
    ? parsed.data.analyticsSessionId
    : undefined;

  if (
    parsed.data.action === "APPLY" &&
    job.applicationContactKind === "APPLY_URL"
  ) {
    const href = publicApplicationHref(job);
    if (
      href === null ||
      (!href.startsWith("https://") && !href.startsWith("http://"))
    ) {
      redirect(`/jobs/${job.slug}`);
    }
    await recordExternalApplyClick(
      job.id,
      job.company.id,
      analyticsSessionId,
      productAnalyticsEnabled,
      now,
    );
    if (
      isRecruitingFeatureAvailableV1(
        environment,
        "external_application_tracker",
      )
    ) {
      const source = await getDatabase().job.findUnique({
        where: { id: job.id },
        select: { publishedRevisionId: true },
      });
      if (
        source?.publishedRevisionId !== null &&
        source?.publishedRevisionId !== undefined
      ) {
        const token = signExternalApplicationResumeIntent(
          {
            jobId: job.id,
            jobRevisionId: source.publishedRevisionId,
            jobSlug: job.slug,
            now,
          },
          environment.secrets.session,
        );
        const cookieStore = await cookies();
        cookieStore.set(
          EXTERNAL_APPLICATION_RESUME_POLICY_V1.cookieName,
          token,
          {
            httpOnly: true,
            sameSite: "lax",
            secure: shouldUseSecureAuthCookies(environment.APP_ENV),
            path: "/",
            maxAge: Math.floor(
              EXTERNAL_APPLICATION_RESUME_POLICY_V1.ttlMilliseconds / 1_000,
            ),
          },
        );
      }
    }
    redirect(href);
  }

  const signedIntent = signJobIntent(
    {
      action: parsed.data.action,
      jobSlug: job.slug,
      analyticsSessionId,
      now,
    },
    environment.secrets.session,
  );
  const next = buildJobIntentNextPath(job.slug, signedIntent);
  if (parsed.data.action === "APPLY") {
    await recordApplyIntent(
      job.id,
      job.company.id,
      analyticsSessionId,
      productAnalyticsEnabled,
      signedIntent,
      now,
    );
  }
  const currentUser = await getCurrentUser();
  if (currentUser === null) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (currentUser.role !== "CANDIDATE") {
    redirect(`/jobs/${job.slug}?candidateRequired=1`);
  }
  redirect(next);
}

export async function recordPublicJobAnalyticsAction(
  rawInput: unknown,
): Promise<void> {
  const parsed = publicProductAnalyticsSchema.safeParse(rawInput);
  if (!parsed.success) return;
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return;
  const environment = getServerEnvironment();
  const runtimeProvenance = getProductAnalyticsRuntimeProvenanceV1(
    environment.APP_ENV,
  );
  const now = new Date();
  if (parsed.data.kind === "SEARCH_RESULTS_VIEWED") {
    const searchEvent = parsed.data;
    if (
      environment.SEARCH_LEARNING_COLLECTION &&
      searchEvent.searchQuery !== undefined &&
      (searchEvent.resultCountBucket === "0" ||
        resolveSearchConceptKeysV2(searchEvent.searchQuery).length === 0)
    ) {
      const searchLearningHash = environment.secrets.searchLearningHash;
      if (searchLearningHash !== undefined) {
        const database = getDatabase();
        const rate = await consumeRequestRateLimit(
          "SEARCH_LEARNING",
          {},
          request,
          now,
          { database, environment },
        );
        if (rate.allowed) {
          await searchLearningHash.withValue((digestSecret) =>
            recordSearchLearningObservation(
              {
                query: searchEvent.searchQuery as string,
                // Client session IDs are not a Sybil boundary. A
                // request-source pseudonym means one source contributes at
                // most once to the same k-anonymous aggregate.
                contributorId: searchLearningContributorId(request.sourceIp),
                locale: "de-CH",
                resultBucket: searchEvent.resultCountBucket,
                filters: searchEvent.searchFilters ?? {},
              },
              {
                database,
                digestSecret,
                now,
              },
            ),
          );
        }
      }
    }
    if (runtimeProvenance === null) return;
    await trackAnalyticsEventV1(
      {
        schemaVersion: "1",
        producerEventId: `SEARCH_RESULTS_VIEWED:${parsed.data.eventId}`,
        occurredAt: now,
        kind: "SEARCH_RESULTS_VIEWED",
        pseudonymousSessionId: parsed.data.analyticsSessionId,
        properties: {
          surface: "JOB_SEARCH",
          locale: "de-CH",
          resultCountBucket: parsed.data.resultCountBucket,
          sort: parsed.data.sort,
          ...(parsed.data.cantonCode === undefined
            ? {}
            : { cantonCode: parsed.data.cantonCode }),
          ...(parsed.data.categorySlug === undefined
            ? {}
            : { categorySlug: parsed.data.categorySlug }),
        },
      },
      {
        producer: "public-job-view",
        productAnalyticsEnabled: true,
        provenance: { actor: runtimeProvenance },
      },
      createPrismaAnalyticsWriter(getDatabase()),
    );
    return;
  }
  if (runtimeProvenance === null) return;
  const job = await getPublicJobBySlug(parsed.data.jobSlug, { now });
  if (job === null) return;
  const provenance = await loadPublicJobAnalyticsProvenance(
    job.id,
    job.company.id,
  );
  if (provenance === null) return;
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `JOB_DETAIL_VIEWED:${parsed.data.eventId}`,
      occurredAt: now,
      kind: "JOB_DETAIL_VIEWED",
      pseudonymousSessionId: parsed.data.analyticsSessionId,
      companyId: job.company.id,
      jobId: job.id,
      properties: {
        surface: "JOB_DETAIL",
        locale: "de-CH",
        placement: "ORGANIC",
      },
    },
    {
      producer: "public-job-view",
      productAnalyticsEnabled: true,
      provenance,
    },
    createPrismaAnalyticsWriter(getDatabase()),
  );
}

function safeLearningTokenList() {
  return z
    .string()
    .min(1)
    .max(96)
    .regex(/^[A-Za-z0-9,._-]+$/u);
}

function searchLearningContributorId(sourceIp: string): string {
  const digest = createHash("sha256")
    .update(`search-learning-source-v1\0${sourceIp}`, "utf8")
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(
    13,
    16,
  )}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function recordApplyIntent(
  jobId: string,
  companyId: string,
  analyticsSessionId: string | undefined,
  productAnalyticsEnabled: boolean,
  signedIntent: string,
  now: Date,
) {
  if (analyticsSessionId === undefined || !productAnalyticsEnabled) {
    return;
  }
  const provenance = await loadPublicJobAnalyticsProvenance(jobId, companyId);
  if (provenance === null) return;
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `APPLY_INTENT_STARTED:${createHash("sha256")
        .update(signedIntent, "utf8")
        .digest("hex")
        .slice(0, 32)}`,
      occurredAt: now,
      kind: "APPLY_INTENT_STARTED",
      pseudonymousSessionId: analyticsSessionId,
      companyId,
      jobId,
      properties: { surface: "JOB_DETAIL", intent: "APPLY" },
    },
    {
      producer: "public-job-action",
      productAnalyticsEnabled: true,
      provenance,
    },
    createPrismaAnalyticsWriter(getDatabase()),
  );
}

async function recordExternalApplyClick(
  jobId: string,
  companyId: string,
  analyticsSessionId: string | undefined,
  productAnalyticsEnabled: boolean,
  now: Date,
) {
  if (analyticsSessionId === undefined || !productAnalyticsEnabled) return;
  const provenance = await loadPublicJobAnalyticsProvenance(jobId, companyId);
  if (provenance === null) return;
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `EXTERNAL_APPLY_CLICKED:${randomUUID()}`,
      occurredAt: now,
      kind: "EXTERNAL_APPLY_CLICKED",
      pseudonymousSessionId: analyticsSessionId,
      companyId,
      jobId,
      properties: {
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
      },
    },
    {
      producer: "public-job-action",
      productAnalyticsEnabled: true,
      provenance,
    },
    createPrismaAnalyticsWriter(getDatabase()),
  );
}

async function loadPublicJobAnalyticsProvenance(
  jobId: string,
  companyId: string,
) {
  const job = await getDatabase().job.findUnique({
    where: { id: jobId },
    select: {
      companyId: true,
      dataProvenance: true,
      company: { select: { dataProvenance: true } },
    },
  });
  if (job === null || job.companyId !== companyId) return null;
  return Object.freeze({
    company: job.company.dataProvenance,
    job: job.dataProvenance,
  });
}

function optionalFormString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
