"use server";

import { createHash, randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
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
} from "@/lib/auth/request-context";
import {
  buildJobIntentNextPath,
  JOB_INTENT_ACTIONS_V1,
  signJobIntent,
} from "@/lib/auth/signed-intent";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { publicApplicationHref } from "@/lib/jobs/job-json-ld";
import { getPublicJobBySlug } from "@/lib/jobs/public-read-model";

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
    cantonCode: z.string().regex(/^[A-Z]{2}$/u).optional(),
    categorySlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
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
    analyticsSessionId: optionalFormString(
      formData.get("analyticsSessionId"),
    ),
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
  const environment = getServerEnvironment();
  const runtimeProvenance = getProductAnalyticsRuntimeProvenanceV1(
    environment.APP_ENV,
  );
  if (runtimeProvenance === null) return;
  const now = new Date();
  if (parsed.data.kind === "SEARCH_RESULTS_VIEWED") {
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
