"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createPrismaAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
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
});

export async function startPublicJobIntentAction(
  formData: FormData,
): Promise<void> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) redirect("/jobs");
  const parsed = startIntentSchema.safeParse({
    action: formData.get("action"),
    jobSlug: formData.get("jobSlug"),
  });
  if (!parsed.success) redirect("/jobs");
  const now = new Date();
  const job = await getPublicJobBySlug(parsed.data.jobSlug, { now });
  if (job === null) redirect("/jobs");

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
    await recordExternalApplyClick(job.id, job.company.id, now);
    redirect(href);
  }

  const environment = getServerEnvironment();
  const signedIntent = signJobIntent(
    { action: parsed.data.action, jobSlug: job.slug, now },
    environment.secrets.session,
  );
  const next = buildJobIntentNextPath(job.slug, signedIntent);
  const currentUser = await getCurrentUser();
  if (currentUser === null) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (currentUser.role !== "CANDIDATE") {
    redirect(`/jobs/${job.slug}?candidateRequired=1`);
  }
  if (parsed.data.action === "APPLY") {
    await recordApplyIntent(job.id, job.company.id, now);
  }
  redirect(next);
}

async function recordApplyIntent(jobId: string, companyId: string, now: Date) {
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `APPLY_INTENT_STARTED:${randomUUID()}`,
      occurredAt: now,
      kind: "APPLY_INTENT_STARTED",
      companyId,
      jobId,
      properties: { surface: "JOB_DETAIL", intent: "APPLY" },
    },
    { producer: "public-job-action", productAnalyticsEnabled: false },
    createPrismaAnalyticsWriter(getDatabase()),
  );
}

async function recordExternalApplyClick(
  jobId: string,
  companyId: string,
  now: Date,
) {
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `EXTERNAL_APPLY_CLICKED:${randomUUID()}`,
      occurredAt: now,
      kind: "EXTERNAL_APPLY_CLICKED",
      companyId,
      jobId,
      properties: {
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
      },
    },
    { producer: "public-job-action", productAnalyticsEnabled: false },
    createPrismaAnalyticsWriter(getDatabase()),
  );
}
