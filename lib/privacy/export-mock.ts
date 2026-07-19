import { createHash } from "node:crypto";

import { z } from "zod";

const EXPORT_ERROR = "Privacy export case is unavailable.";
const EXPORT_METADATA_DAYS = 7;
const CATEGORY_NAMES = [
  "account",
  "candidateProfile",
  "consentHistory",
  "applications",
  "radar",
] as const;

export const PRIVACY_EXPORT_MANIFEST_POLICY_V1 = Object.freeze({
  schemaVersion: "v1" as const,
  metadataLifetimeDays: EXPORT_METADATA_DAYS,
  categoryNames: Object.freeze(CATEGORY_NAMES),
  containsProviderBytes: false,
});

const categoryCountsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    candidateProfile: z.number().int().nonnegative(),
    consentHistory: z.number().int().nonnegative(),
    applications: z.number().int().nonnegative(),
    radar: z.number().int().nonnegative(),
  })
  .strict();

const exportCaseSchema = z
  .object({
    requestId: z.string().uuid(),
    requesterUserId: z.string().uuid(),
    type: z.literal("EXPORT"),
    status: z.enum(["IN_PROGRESS", "COMPLETED"]),
    verifiedAt: z.date(),
    version: z.number().int().nonnegative(),
    categoryCounts: categoryCountsSchema,
  })
  .strict();

export const privacyExportManifestSchema = z
  .object({
    schemaVersion: z.literal(PRIVACY_EXPORT_MANIFEST_POLICY_V1.schemaVersion),
    requestId: z.string().uuid(),
    categories: categoryCountsSchema,
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const exportResultSchema = z
  .object({
    manifest: privacyExportManifestSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.date(),
  })
  .strict();

export type PrivacyExportManifest = z.infer<typeof privacyExportManifestSchema>;
export type PrivacyExportResult = Readonly<{
  manifest: PrivacyExportManifest;
  checksum: string;
  expiresAt: Date;
}>;

export type PrivacyExportActor = Readonly<{
  userId: string;
  capabilities: readonly string[];
}>;

export interface PrivacyExportCaseTransaction {
  /** Must scope the lookup to a justified/assigned actor; null is a generic deny. */
  loadAuthorizedExportCase(
    privacyRequestId: string,
    actorUserId: string,
  ): Promise<unknown | null>;
  loadExistingManifest(
    privacyRequestId: string,
    actorUserId: string,
  ): Promise<unknown | null>;
  /** Atomically persists metadata/events/audits and moves IN_PROGRESS to COMPLETED. */
  saveManifestAndComplete(input: Readonly<{
    privacyRequestId: string;
    requesterUserId: string;
    expectedVersion: number;
    manifest: PrivacyExportManifest;
    checksum: string;
    expiresAt: Date;
    events: readonly ["MANIFEST_CREATED", "COMPLETED"];
    auditActions: readonly [
      "PRIVACY_EXPORT_MANIFEST_CREATED",
      "PRIVACY_REQUEST_STATUS_CHANGED",
    ];
  }>): Promise<void>;
}

/**
 * Creates only local manifest metadata. It never constructs or returns export
 * file bytes, raw rows, employer-private notes, callbacks or provider payloads.
 */
export async function buildExportManifestForCase(
  transaction: PrivacyExportCaseTransaction,
  privacyRequestId: string,
  actor: PrivacyExportActor,
  now: Date,
): Promise<PrivacyExportResult> {
  try {
    if (
      !z.string().uuid().safeParse(privacyRequestId).success ||
      !z.string().uuid().safeParse(actor.userId).success ||
      !actor.capabilities.includes("PRIVACY_CASE_PROCESS") ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime())
    ) {
      throw new Error("deny");
    }

    const loaded = await transaction.loadAuthorizedExportCase(
      privacyRequestId,
      actor.userId,
    );
    const parsedCase = exportCaseSchema.safeParse(loaded);
    if (
      !parsedCase.success ||
      parsedCase.data.requestId !== privacyRequestId ||
      parsedCase.data.verifiedAt.getTime() > now.getTime()
    ) {
      throw new Error("deny");
    }
    const exportCase = parsedCase.data;

    const existing = await transaction.loadExistingManifest(
      privacyRequestId,
      actor.userId,
    );
    if (existing !== null) {
      if (exportCase.status !== "COMPLETED") throw new Error("deny");
      return validateStoredResult(existing, privacyRequestId);
    }
    if (exportCase.status !== "IN_PROGRESS") throw new Error("deny");

    const categories = Object.freeze({ ...exportCase.categoryCounts });
    const manifest: PrivacyExportManifest = Object.freeze({
      schemaVersion: PRIVACY_EXPORT_MANIFEST_POLICY_V1.schemaVersion,
      requestId: privacyRequestId,
      categories,
      generatedAt: now.toISOString(),
    });
    const checksum = checksumManifest(manifest);
    const expiresAt = new Date(
      now.getTime() + PRIVACY_EXPORT_MANIFEST_POLICY_V1.metadataLifetimeDays * 24 * 60 * 60 * 1_000,
    );

    await transaction.saveManifestAndComplete({
      privacyRequestId,
      requesterUserId: exportCase.requesterUserId,
      expectedVersion: exportCase.version,
      manifest,
      checksum,
      expiresAt,
      events: Object.freeze(["MANIFEST_CREATED", "COMPLETED"]),
      auditActions: Object.freeze([
        "PRIVACY_EXPORT_MANIFEST_CREATED",
        "PRIVACY_REQUEST_STATUS_CHANGED",
      ]),
    });
    return freezeResult({ manifest, checksum, expiresAt });
  } catch {
    throw new Error(EXPORT_ERROR);
  }
}

export function checksumManifest(manifest: PrivacyExportManifest) {
  const parsed = privacyExportManifestSchema.parse(manifest);
  return createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
}

function validateStoredResult(
  input: unknown,
  privacyRequestId: string,
): PrivacyExportResult {
  const parsed = exportResultSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.manifest.requestId !== privacyRequestId ||
    checksumManifest(parsed.data.manifest) !== parsed.data.checksum
  ) {
    throw new Error("deny");
  }
  return freezeResult(parsed.data);
}

function freezeResult(result: PrivacyExportResult): PrivacyExportResult {
  return Object.freeze({
    manifest: Object.freeze({
      ...result.manifest,
      categories: Object.freeze({ ...result.manifest.categories }),
    }),
    checksum: result.checksum,
    expiresAt: new Date(result.expiresAt),
  });
}
