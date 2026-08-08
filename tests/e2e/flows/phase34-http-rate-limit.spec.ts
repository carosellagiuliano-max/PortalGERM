import { createHash, randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import {
  buildRateLimitChecks,
  RATE_LIMIT_PRESETS_V1,
  type RateLimitCheck,
} from "@/lib/auth/rate-limit";
import type { VersionedHashKey } from "@/lib/utils/hash";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const DOCUMENT_RATE_NAMESPACES = Object.freeze([
  "v1:DOCUMENT_UPLOAD_INTENT:USER",
  "v1:DOCUMENT_UPLOAD_INTENT:IP",
] as const);
const SECURITY_AUDIT_NAMESPACE = "v1:SECURITY_DENIAL_AUDIT:ACTOR_OR_IP_TARGET";

test.describe.configure({ mode: "serial" });

test("[E2E-34-17] @phase34 authenticated HTTP upload intents hit the real USER limit without an IP bypass or blocked-request business writes", async ({
  page,
}, testInfo) => {
  const database = phase17Database();
  const suffix = `${projectSlug(testInfo.project.name)}-${randomUUID().slice(0, 8)}`;
  const sourceIps = projectSourceIps(testInfo.project.name);
  const hashKey = auditHashWriterKey();
  let cleanupChecks: readonly RateLimitCheck[] = [];

  try {
    const candidate = await createCandidate(database, suffix);
    const initialDocumentChecks = buildRateLimitChecks(
      "DOCUMENT_UPLOAD_INTENT",
      { userId: candidate.userId, sourceIp: sourceIps.initial },
      hashKey,
    );
    const changedIpDocumentChecks = buildRateLimitChecks(
      "DOCUMENT_UPLOAD_INTENT",
      { userId: candidate.userId, sourceIp: sourceIps.changed },
      hashKey,
    );
    const securityAuditChecks = buildRateLimitChecks(
      "SECURITY_DENIAL_AUDIT",
      {
        actorId: candidate.userId,
        sourceIp: sourceIps.initial,
        targetId: "DOCUMENT_UPLOAD_INTENT:USER",
      },
      hashKey,
    );
    expect(initialDocumentChecks.map(({ namespace }) => namespace)).toEqual(
      DOCUMENT_RATE_NAMESPACES,
    );
    expect(securityAuditChecks.map(({ namespace }) => namespace)).toEqual([
      SECURITY_AUDIT_NAMESPACE,
    ]);
    cleanupChecks = Object.freeze([
      ...initialDocumentChecks,
      ...changedIpDocumentChecks,
      ...securityAuditChecks,
    ]);

    // The setup removes only this unique actor/IP pair's upload-intent
    // namespace. No application limit or unrelated rate namespace is changed.
    await deleteRateBuckets(database, [
      ...initialDocumentChecks,
      ...changedIpDocumentChecks,
    ]);

    await page.setExtraHTTPHeaders({
      "x-forwarded-for": sourceIps.initial,
    });
    await login(page, candidate.email, DEMO_PASSWORD);
    const origin = new URL(page.url()).origin;
    const request = page.context().request;

    const firstBytes = Buffer.from(
      `%PDF-1.4\nphase34-http-rate-first-${suffix}\n%%EOF`,
      "utf8",
    );
    const firstPayload = uploadIntentPayload(
      `phase34-rate-first-${suffix}.pdf`,
      firstBytes,
    );
    const firstResponse = await postUploadIntent(
      request,
      origin,
      sourceIps.initial,
      firstPayload,
    );
    expect(firstResponse.status()).toBe(201);
    const firstIntent = requireUploadIntentResponse(await firstResponse.json());
    expect(firstIntent).toMatchObject({
      duplicate: false,
      status: "CREATED",
    });

    const firstEffect = await documentFingerprint(
      database,
      candidate.profileId,
    );
    expect(firstEffect.documents).toHaveLength(1);
    expect(firstEffect.versions).toEqual([
      expect.objectContaining({
        id: firstIntent.documentVersionId,
        sequence: 1,
        status: "UPLOADING",
      }),
    ]);
    expect(firstEffect.intents).toEqual([
      expect.objectContaining({
        id: firstIntent.intentId,
        documentVersionId: firstIntent.documentVersionId,
        idempotencyKey: firstPayload.idempotencyKey,
        status: "CREATED",
      }),
    ]);

    // Complete the first genuine sandbox upload over HTTP so a second unique
    // CV intent is a valid business request rather than an active-intent clash.
    await uploadAndFinalize(
      request,
      origin,
      sourceIps.initial,
      firstIntent,
      firstBytes,
    );

    const userCheck = requiredScope(initialDocumentChecks, "USER");
    const ipCheck = requiredScope(initialDocumentChecks, "IP");
    const userBuckets = await database.rateLimitBucket.findMany({
      where: {
        namespace: userCheck.namespace,
        keyHash: userCheck.keyHash,
      },
      select: { id: true, count: true },
    });
    expect(userBuckets).toHaveLength(1);
    expect(userBuckets[0]?.count).toBe(1);

    // Seed only the already identified USER bucket to one below the real
    // production preset. The preset itself remains untouched.
    const userLimit = documentUploadUserLimit();
    await database.rateLimitBucket.update({
      where: { id: userBuckets[0]!.id },
      data: { count: userLimit - 1 },
    });

    const secondBytes = Buffer.from(
      `%PDF-1.4\nphase34-http-rate-second-${suffix}\n%%EOF`,
      "utf8",
    );
    const secondPayload = uploadIntentPayload(
      `phase34-rate-second-${suffix}.pdf`,
      secondBytes,
    );
    const secondResponse = await postUploadIntent(
      request,
      origin,
      sourceIps.initial,
      secondPayload,
    );
    expect(secondResponse.status()).toBe(201);
    const secondIntent = requireUploadIntentResponse(
      await secondResponse.json(),
    );
    expect(secondIntent).toMatchObject({
      duplicate: false,
      status: "CREATED",
    });
    expect(secondIntent.intentId).not.toBe(firstIntent.intentId);
    expect(secondIntent.documentVersionId).not.toBe(
      firstIntent.documentVersionId,
    );

    const stateAtLimit = await documentFingerprint(
      database,
      candidate.profileId,
    );
    expect(stateAtLimit.documents).toHaveLength(1);
    expect(stateAtLimit.versions).toHaveLength(2);
    expect(stateAtLimit.intents).toHaveLength(2);
    expect(
      await rateCount(database, userCheck.namespace, userCheck.keyHash),
    ).toBe(userLimit);
    expect(await rateCount(database, ipCheck.namespace, ipCheck.keyHash)).toBe(
      2,
    );
    const documentRateStateAtLimit = await rateFingerprint(
      database,
      initialDocumentChecks,
    );

    const auditWhere = {
      actorUserId: candidate.userId,
      action: "RATE_LIMITED" as const,
      capability: "CANDIDATE_DOCUMENT_UPLOAD",
      targetType: "USER" as const,
      targetId: candidate.userId,
    };
    expect(await database.auditLog.count({ where: auditWhere })).toBe(0);

    const blockedBytes = Buffer.from(
      `%PDF-1.4\nphase34-http-rate-blocked-${suffix}\n%%EOF`,
      "utf8",
    );
    const blockedPayload = uploadIntentPayload(
      `phase34-rate-blocked-${suffix}.pdf`,
      blockedBytes,
    );
    const blockedResponse = await postUploadIntent(
      request,
      origin,
      sourceIps.initial,
      blockedPayload,
    );
    await expectRateLimited(blockedResponse);
    expect(await documentFingerprint(database, candidate.profileId)).toEqual(
      stateAtLimit,
    );
    expect(await rateFingerprint(database, initialDocumentChecks)).toEqual(
      documentRateStateAtLimit,
    );

    const firstDenials = await database.auditLog.findMany({
      where: auditWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        metadata: true,
        reasonCode: true,
        result: true,
      },
    });
    expect(firstDenials).toEqual([
      expect.objectContaining({
        metadata: {
          preset: "DOCUMENT_UPLOAD_INTENT",
          scope: "USER",
        },
        reasonCode: "RATE_LIMITED",
        result: "DENIED",
      }),
    ]);

    // Reuse the same authenticated browser session and exact request while
    // changing only the single-valued forwarded address. USER scope must win.
    const changedIpResponse = await postUploadIntent(
      request,
      origin,
      sourceIps.changed,
      blockedPayload,
    );
    await expectRateLimited(changedIpResponse);
    expect(await documentFingerprint(database, candidate.profileId)).toEqual(
      stateAtLimit,
    );
    expect(await rateFingerprint(database, initialDocumentChecks)).toEqual(
      documentRateStateAtLimit,
    );
    expect(
      await rateCount(
        database,
        requiredScope(changedIpDocumentChecks, "IP").namespace,
        requiredScope(changedIpDocumentChecks, "IP").keyHash,
      ),
    ).toBe(0);

    // SECURITY_DENIAL_AUDIT deliberately permits one durable audit for the
    // actor/target pair. The repeated denial is gated, so the exact total stays
    // one rather than growing with attacker-controlled source IP values.
    expect(await database.auditLog.count({ where: auditWhere })).toBe(1);
    expect(
      await rateCount(
        database,
        requiredScope(securityAuditChecks, "ACTOR_OR_IP_TARGET").namespace,
        requiredScope(securityAuditChecks, "ACTOR_OR_IP_TARGET").keyHash,
      ),
    ).toBe(1);
  } finally {
    if (cleanupChecks.length > 0) {
      await deleteRateBuckets(database, cleanupChecks);
    }
    await database.$disconnect();
  }
});

type Database = ReturnType<typeof phase17Database>;

type UploadIntentPayload = Readonly<{
  declaredMimeType: "application/pdf";
  expectedSha256: string;
  expectedSizeBytes: number;
  filename: string;
  idempotencyKey: string;
}>;

type UploadIntentResponse = Readonly<{
  documentVersionId: string;
  duplicate: boolean;
  intentId: string;
  status: string;
}>;

async function createCandidate(database: Database, suffix: string) {
  const credential = await database.credential.findFirstOrThrow({
    where: { user: { emailNormalized: DEMO_ACCOUNTS.candidate } },
    select: {
      algorithm: true,
      algorithmVersion: true,
      passwordChangedAt: true,
      passwordHash: true,
    },
  });
  const email = `phase34-rate-${suffix}@example.test`;
  const userId = randomUUID();
  const profileId = randomUUID();
  await database.user.create({
    data: {
      id: userId,
      email,
      emailNormalized: email,
      role: "CANDIDATE",
      name: `Phase 34 Rate ${suffix}`,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: new Date(),
      credential: {
        create: {
          id: randomUUID(),
          ...credential,
        },
      },
      candidateProfile: {
        create: {
          id: profileId,
          firstName: "Rate",
          lastName: `Candidate ${suffix}`,
          publicDisplayName: `Rate Candidate ${suffix}`,
        },
      },
    },
  });
  return Object.freeze({ email, profileId, userId });
}

function uploadIntentPayload(
  filename: string,
  bytes: Buffer,
): UploadIntentPayload {
  return Object.freeze({
    filename,
    declaredMimeType: "application/pdf",
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    idempotencyKey: randomUUID(),
  });
}

async function postUploadIntent(
  request: APIRequestContext,
  origin: string,
  sourceIp: string,
  payload: UploadIntentPayload,
) {
  return request.post(`${origin}/api/documents/upload-intents`, {
    data: payload,
    failOnStatusCode: false,
    headers: mutationHeaders(origin, sourceIp, "application/json"),
  });
}

async function uploadAndFinalize(
  request: APIRequestContext,
  origin: string,
  sourceIp: string,
  intent: UploadIntentResponse,
  bytes: Buffer,
) {
  const uploaded = await request.post(
    `${origin}/api/documents/upload-intents/${intent.intentId}/body`,
    {
      data: bytes,
      failOnStatusCode: false,
      headers: {
        ...mutationHeaders(origin, sourceIp, "application/pdf"),
        "content-length": String(bytes.byteLength),
      },
    },
  );
  expect(uploaded.status()).toBe(200);
  expect(await uploaded.json()).toMatchObject({
    documentVersionId: intent.documentVersionId,
    duplicate: false,
    status: "QUARANTINED",
  });

  const finalized = await request.post(
    `${origin}/api/documents/upload-intents/${intent.intentId}/finalize`,
    {
      failOnStatusCode: false,
      headers: mutationHeaders(origin, sourceIp),
    },
  );
  expect(finalized.status()).toBe(200);
  expect(await finalized.json()).toMatchObject({
    documentVersionId: intent.documentVersionId,
    duplicate: false,
  });
}

function mutationHeaders(
  origin: string,
  sourceIp: string,
  contentType?: string,
) {
  return {
    origin,
    referer: `${origin}/candidate/jobpass`,
    "x-forwarded-for": sourceIp,
    ...(contentType === undefined ? {} : { "content-type": contentType }),
  };
}

function requireUploadIntentResponse(value: unknown): UploadIntentResponse {
  if (
    !isRecord(value) ||
    typeof value.intentId !== "string" ||
    typeof value.documentVersionId !== "string" ||
    typeof value.duplicate !== "boolean" ||
    typeof value.status !== "string"
  ) {
    throw new Error("Upload-intent response did not match the HTTP contract.");
  }
  return Object.freeze({
    intentId: value.intentId,
    documentVersionId: value.documentVersionId,
    duplicate: value.duplicate,
    status: value.status,
  });
}

async function expectRateLimited(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
) {
  expect(response.status()).toBe(429);
  const retryAfter = response.headers()["retry-after"];
  expect(retryAfter).toMatch(/^[1-9]\d*$/u);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ code: "RATE_LIMITED" });
  if (!isRecord(body) || typeof body.retryAfterSeconds !== "number") {
    throw new Error("Rate-limit response omitted retryAfterSeconds.");
  }
  expect(body.retryAfterSeconds).toBe(Number(retryAfter));
}

async function documentFingerprint(database: Database, profileId: string) {
  const [documents, versions, intents] = await Promise.all([
    database.document.findMany({
      where: { candidateProfileId: profileId },
      orderBy: { id: "asc" },
      select: { id: true, currentVersionId: true },
    }),
    database.documentVersion.findMany({
      where: { candidateProfileId: profileId },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
      select: {
        id: true,
        documentId: true,
        sequence: true,
        status: true,
        safeFilename: true,
        declaredMimeType: true,
        sizeBytes: true,
        sha256: true,
      },
    }),
    database.documentUploadIntent.findMany({
      where: { candidateProfileId: profileId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        documentVersionId: true,
        idempotencyKey: true,
        status: true,
        expectedSizeBytes: true,
        expectedSha256: true,
        safeFilename: true,
      },
    }),
  ]);
  return Object.freeze({
    documents: Object.freeze(documents),
    versions: Object.freeze(versions),
    intents: Object.freeze(intents),
  });
}

async function rateFingerprint(
  database: Database,
  checks: readonly RateLimitCheck[],
) {
  const identities = uniqueChecks(checks);
  const rows = await database.rateLimitBucket.findMany({
    where: {
      OR: identities.map(({ namespace, keyHash }) => ({
        namespace,
        keyHash,
      })),
    },
    orderBy: [{ namespace: "asc" }, { windowStart: "asc" }, { id: "asc" }],
    select: {
      id: true,
      namespace: true,
      keyHash: true,
      windowStart: true,
      windowEnd: true,
      count: true,
    },
  });
  return Object.freeze(rows);
}

async function rateCount(
  database: Database,
  namespace: string,
  keyHash: string,
) {
  const aggregate = await database.rateLimitBucket.aggregate({
    where: { namespace, keyHash },
    _sum: { count: true },
  });
  return aggregate._sum.count ?? 0;
}

async function deleteRateBuckets(
  database: Database,
  checks: readonly RateLimitCheck[],
) {
  const identities = uniqueChecks(checks);
  if (identities.length === 0) return;
  await database.rateLimitBucket.deleteMany({
    where: {
      OR: identities.map(({ namespace, keyHash }) => ({
        namespace,
        keyHash,
      })),
    },
  });
}

function uniqueChecks(checks: readonly RateLimitCheck[]) {
  const unique = new Map<
    string,
    Pick<RateLimitCheck, "keyHash" | "namespace">
  >();
  for (const check of checks) {
    unique.set(`${check.namespace}:${check.keyHash}`, {
      namespace: check.namespace,
      keyHash: check.keyHash,
    });
  }
  return [...unique.values()];
}

function requiredScope(
  checks: readonly RateLimitCheck[],
  scope: RateLimitCheck["scope"],
) {
  const check = checks.find((candidate) => candidate.scope === scope);
  if (check === undefined) {
    throw new Error(`Missing ${scope} rate-limit check.`);
  }
  return check;
}

function documentUploadUserLimit() {
  const bucket = RATE_LIMIT_PRESETS_V1.DOCUMENT_UPLOAD_INTENT.buckets.find(
    ({ scope }) => scope === "USER",
  );
  if (bucket === undefined || bucket.limit < 2) {
    throw new Error("DOCUMENT_UPLOAD_INTENT USER limit is unavailable.");
  }
  return bucket.limit;
}

function auditHashWriterKey(): VersionedHashKey {
  const raw = requiredEnvironment("AUDIT_IP_HASH_KEYS").split(",")[0];
  const separator = raw?.indexOf(":") ?? -1;
  if (raw === undefined || separator <= 0 || separator === raw.length - 1) {
    throw new Error("AUDIT_IP_HASH_KEYS has no usable writer.");
  }
  return Object.freeze({
    version: raw.slice(0, separator),
    secret: raw.slice(separator + 1),
  });
}

function projectSourceIps(projectName: string) {
  switch (projectName) {
    case "chromium-phase34":
      return Object.freeze({
        initial: "198.51.100.101",
        changed: "203.0.113.101",
      });
    case "firefox-phase34":
      return Object.freeze({
        initial: "198.51.100.102",
        changed: "203.0.113.102",
      });
    case "webkit-phase34":
      return Object.freeze({
        initial: "198.51.100.103",
        changed: "203.0.113.103",
      });
    default:
      throw new Error(`Unsupported Phase-34 browser project: ${projectName}`);
  }
}

function projectSlug(projectName: string) {
  const slug = projectName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
  if (slug.length === 0) throw new Error("Browser project name is empty.");
  return slug.slice(0, 32);
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for Phase-34 rate-limit E2E.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
