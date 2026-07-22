import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { SPONSORED_RANKING_POLICY_VERSION } from "@/lib/search/placement-config";
import type { JobSearchSort, OrganicCursorTuple } from "@/lib/search/types";

const cursorTailSchema = {
  publishedAt: z.iso.datetime({ offset: true }),
  id: z.string().min(1),
} as const;

const fairScoreSchema = z.number().int().min(0).max(100).nullable();
const organicTupleSchema = z.discriminatedUnion("sort", [
  z.object({
    sort: z.literal("relevance"),
    relevanceTier: z.number().int().nonnegative(),
    relevanceScore: z.number().int().nonnegative(),
    fairScore: fairScoreSchema,
    ...cursorTailSchema,
  }).strict(),
  z.object({
    sort: z.literal("newest"),
    ...cursorTailSchema,
  }).strict(),
  z.object({
    sort: z.literal("fair-score"),
    fairScore: fairScoreSchema,
    ...cursorTailSchema,
  }).strict(),
  z.object({
    sort: z.literal("salary"),
    salaryMinChf: z.number().int().positive().nullable(),
    salaryMaxChf: z.number().int().positive().nullable(),
    ...cursorTailSchema,
  }).strict(),
  z.object({
    sort: z.literal("response"),
    responseEvidenceKnown: z.boolean(),
    onTimeRateBps: z.number().int().min(0).max(10_000).nullable(),
    medianFirstResponseMinutes: z.number().int().nonnegative().nullable(),
    ...cursorTailSchema,
  }).strict(),
]).superRefine((tuple, context) => {
  if (tuple.sort !== "response") return;
  if (tuple.responseEvidenceKnown && tuple.onTimeRateBps === null) {
    context.addIssue({
      code: "custom",
      path: ["onTimeRateBps"],
      message: "Known response evidence requires an on-time rate.",
    });
  }
  if (!tuple.responseEvidenceKnown && tuple.onTimeRateBps !== null) {
    context.addIssue({
      code: "custom",
      path: ["onTimeRateBps"],
      message: "Unknown response evidence cannot carry an on-time rate.",
    });
  }
});

const cursorPayloadSchema = z.object({
  policyVersion: z.literal(SPONSORED_RANKING_POLICY_VERSION),
  configVersion: z.literal("v1"),
  queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  rankingAsOf: z.iso.datetime({ offset: true }),
  responseProjectionFingerprint: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  sponsoredIds: z.array(z.string().min(1)).max(3),
  organicTuple: organicTupleSchema.nullable(),
}).strict().superRefine((payload, context) => {
  if (new Set(payload.sponsoredIds).size !== payload.sponsoredIds.length) {
    context.addIssue({
      code: "custom",
      path: ["sponsoredIds"],
      message: "Sponsored cursor IDs must be unique.",
    });
  }
});

export type SearchCursorPayload = Readonly<{
  policyVersion: "v1";
  configVersion: "v1";
  queryHash: string;
  rankingAsOf: string;
  responseProjectionFingerprint?: string;
  sponsoredIds: readonly string[];
  organicTuple: OrganicCursorTuple | null;
}>;

function signature(encoded: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`search-cursor-v1\0${encoded}`).digest();
}

export function encodeSearchCursor(payload: SearchCursorPayload, secret: string): string {
  if (secret.length < 32) {
    throw new TypeError("Cursor signing key must contain at least 32 characters.");
  }
  const parsed = cursorPayloadSchema.parse(payload);
  const encoded = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function decodeSearchCursor(
  cursor: string,
  expected: Readonly<{
    queryHash: string;
    sort: JobSearchSort;
    secret: string;
  }>,
): SearchCursorPayload | null {
  if (expected.secret.length < 32) return null;
  const [encoded, encodedSignature, extra] = cursor.split(".");
  if (!encoded || !encodedSignature || extra !== undefined) return null;
  try {
    const supplied = Buffer.from(encodedSignature, "base64url");
    const correct = signature(encoded, expected.secret);
    if (supplied.length !== correct.length || !timingSafeEqual(supplied, correct)) {
      return null;
    }
    const result = cursorPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (!result.success || result.data.queryHash !== expected.queryHash) return null;
    if (result.data.organicTuple !== null &&
        result.data.organicTuple.sort !== expected.sort) {
      return null;
    }
    return Object.freeze({
      ...result.data,
      sponsoredIds: Object.freeze([...result.data.sponsoredIds]),
      organicTuple: result.data.organicTuple === null
        ? null
        : Object.freeze(result.data.organicTuple),
    });
  } catch {
    return null;
  }
}
