import { createHmac } from "node:crypto";

import type { DatabaseClient } from "@/lib/db/factory";
import { normalizeIpAddress, type VersionedHashKey } from "@/lib/utils/hash";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMIT_PRESET_NAMES_V1 = [
  "LOGIN",
  "REGISTER",
  "FORGOT_PASSWORD",
  "APPLICATION_SUBMIT",
  "APPLICATION_CANDIDATE_MUTATION",
  "CANDIDATE_PROFILE_MUTATION",
  "JOB_ALERT_MUTATION",
  "MESSAGE_SEND",
  "PRIVACY_REQUEST",
  "PRIVACY_IDENTITY_CHALLENGE",
  "LEAD",
  "LEAD_DENIAL_AUDIT",
  "SECURITY_DENIAL_AUDIT",
  "ABUSE_INTAKE_PRECHECK",
  "ABUSE_INTAKE",
  "CONTACT_REQUEST",
  "RADAR_LIST",
] as const;

export type RateLimitPresetName = (typeof RATE_LIMIT_PRESET_NAMES_V1)[number];

export const RATE_LIMIT_SCOPES_V1 = [
  "IP_EMAIL",
  "IP",
  "USER",
  "ACTOR_OR_IP",
  "ACTOR_OR_IP_TARGET",
  "COMPANY",
  "CANDIDATE",
  "MEMBERSHIP",
] as const;

export type RateLimitScope = (typeof RATE_LIMIT_SCOPES_V1)[number];

export const RATE_LIMIT_PRESETS_V1 = Object.freeze({
  LOGIN: {
    buckets: [
      { scope: "IP_EMAIL", limit: 10, windowMs: 15 * MINUTE },
      { scope: "IP", limit: 30, windowMs: HOUR },
    ],
  },
  REGISTER: { buckets: [{ scope: "IP", limit: 10, windowMs: HOUR }] },
  FORGOT_PASSWORD: {
    buckets: [{ scope: "IP_EMAIL", limit: 5, windowMs: HOUR }],
  },
  APPLICATION_SUBMIT: {
    buckets: [
      { scope: "USER", limit: 30, windowMs: HOUR },
      { scope: "IP", limit: 100, windowMs: HOUR },
    ],
  },
  APPLICATION_CANDIDATE_MUTATION: {
    buckets: [
      { scope: "USER", limit: 60, windowMs: HOUR },
      { scope: "IP", limit: 120, windowMs: HOUR },
    ],
  },
  CANDIDATE_PROFILE_MUTATION: {
    buckets: [
      { scope: "USER", limit: 30, windowMs: HOUR },
      { scope: "IP", limit: 100, windowMs: HOUR },
    ],
  },
  JOB_ALERT_MUTATION: {
    buckets: [
      { scope: "USER", limit: 60, windowMs: HOUR },
      { scope: "IP", limit: 120, windowMs: HOUR },
    ],
  },
  MESSAGE_SEND: {
    buckets: [
      { scope: "USER", limit: 60, windowMs: HOUR },
      { scope: "IP", limit: 120, windowMs: HOUR },
    ],
  },
  PRIVACY_REQUEST: {
    buckets: [{ scope: "USER", limit: 5, windowMs: 30 * DAY }],
  },
  PRIVACY_IDENTITY_CHALLENGE: {
    buckets: [
      { scope: "USER", limit: 5, windowMs: 15 * MINUTE },
      { scope: "IP", limit: 20, windowMs: HOUR },
    ],
  },
  LEAD: { buckets: [{ scope: "IP", limit: 10, windowMs: HOUR }] },
  LEAD_DENIAL_AUDIT: {
    buckets: [{ scope: "IP", limit: 1, windowMs: HOUR }],
  },
  SECURITY_DENIAL_AUDIT: {
    buckets: [{ scope: "ACTOR_OR_IP", limit: 1, windowMs: HOUR }],
  },
  ABUSE_INTAKE_PRECHECK: {
    buckets: [
      { scope: "ACTOR_OR_IP", limit: 10, windowMs: DAY },
      { scope: "IP", limit: 20, windowMs: DAY },
    ],
  },
  ABUSE_INTAKE: {
    buckets: [{ scope: "ACTOR_OR_IP_TARGET", limit: 3, windowMs: DAY }],
  },
  CONTACT_REQUEST: {
    buckets: [
      { scope: "COMPANY", limit: 20, windowMs: HOUR },
      { scope: "USER", limit: 30, windowMs: HOUR },
      { scope: "CANDIDATE", limit: 3, windowMs: 30 * DAY },
    ],
  },
  RADAR_LIST: {
    buckets: [{ scope: "MEMBERSHIP", limit: 10, windowMs: MINUTE }],
  },
} as const satisfies Record<
  RateLimitPresetName,
  { buckets: readonly RateLimitBucketPreset[] }
>);

export const RADAR_DISTINCT_FILTER_BUDGET_V1 = Object.freeze({
  limit: 30,
  calendarTimeZone: "Europe/Zurich",
});

export type RadarDistinctFilterBudgetInput = Readonly<{
  companyId: string;
  filterHash: string;
  now: Date;
}>;

export type RadarDistinctFilterBudgetDecision =
  | Readonly<{
      allowed: true;
      status: 200;
      calendarDate: string;
      isNewFilter: boolean;
      distinctFiltersUsed: number;
      remaining: number;
    }>
  | Readonly<{
      allowed: false;
      status: 429;
      code: "RADAR_DISTINCT_FILTER_BUDGET_EXHAUSTED";
      calendarDate: string;
      distinctFiltersUsed: number;
      retryAfterSeconds: number;
      audit: Readonly<{
        action: "RATE_LIMITED";
        preset: "RADAR_LIST";
        scope: "COMPANY";
      }>;
    }>;

export interface RadarDistinctFilterBudget {
  consume(
    input: RadarDistinctFilterBudgetInput,
  ): Promise<RadarDistinctFilterBudgetDecision>;
}

export type RateLimitBucketPreset = Readonly<{
  scope: RateLimitScope;
  limit: number;
  windowMs: number;
}>;

export type ServerRateLimitIdentity = Readonly<{
  sourceIp?: string;
  normalizedEmail?: string;
  userId?: string;
  actorId?: string;
  companyId?: string;
  candidateId?: string;
  targetId?: string;
  membershipId?: string;
  samePrivacyTypeOpen?: boolean;
  membershipActive?: boolean;
}>;

export type RateLimitCheck = Readonly<{
  namespace: string;
  keyHash: string;
  scope: RateLimitScope;
  limit: number;
  windowMs: number;
}>;

export type RateLimitStoreDecision = Readonly<{
  allowed: boolean;
  blockedScope?: RateLimitScope;
  retryAfterMilliseconds?: number;
}>;

export interface RateLimitStore {
  consume(
    checks: readonly RateLimitCheck[],
    now: Date,
  ): Promise<RateLimitStoreDecision>;
}

export type RateLimitDecision =
  | Readonly<{ allowed: true; status: 200 }>
  | Readonly<{
      allowed: false;
      status: 429;
      code: "RATE_LIMITED" | "OPEN_REQUEST_EXISTS" | "INACTIVE_MEMBERSHIP";
      retryAfterSeconds: number;
      audit: Readonly<{
        action: "RATE_LIMITED";
        preset: RateLimitPresetName;
        scope: RateLimitScope | "OPEN_TYPE" | "UNKNOWN";
      }>;
    }>;

function normalizedIdentifier(
  kind: string,
  value: string,
  key: VersionedHashKey,
): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${kind} identifier is required.`);
  }
  return `${key.version}:${createHmac("sha256", key.secret)
    .update(`${kind}\0${value}`, "utf8")
    .digest("hex")}`;
}

function identityValue(
  scope: RateLimitScope,
  identity: ServerRateLimitIdentity,
): readonly [kind: string, value: string] {
  const ip =
    identity.sourceIp === undefined
      ? undefined
      : normalizeIpAddress(identity.sourceIp);
  switch (scope) {
    case "IP":
      return ["ip", ip ?? ""];
    case "IP_EMAIL": {
      const email = identity.normalizedEmail?.trim().toLowerCase();
      if (ip === undefined || !email)
        throw new TypeError("IP and normalized email are required.");
      return ["ip-email", `${ip}\0${email}`];
    }
    case "USER":
      return ["user", identity.userId ?? ""];
    case "ACTOR_OR_IP":
      return identity.actorId ? ["actor", identity.actorId] : ["ip", ip ?? ""];
    case "ACTOR_OR_IP_TARGET": {
      const target = identity.targetId?.trim();
      if (!target) throw new TypeError("Target identifier is required.");
      if (!identity.actorId && ip === undefined) {
        throw new TypeError("Actor or IP identifier is required.");
      }
      return identity.actorId
        ? ["actor-target", `${identity.actorId}\0${target}`]
        : ["ip-target", `${ip ?? ""}\0${target}`];
    }
    case "COMPANY":
      return ["company", identity.companyId ?? ""];
    case "CANDIDATE":
      return ["candidate", identity.candidateId ?? ""];
    case "MEMBERSHIP":
      return ["membership", identity.membershipId ?? ""];
  }
}

export function buildRateLimitChecks(
  presetName: RateLimitPresetName,
  identity: ServerRateLimitIdentity,
  key: VersionedHashKey,
): readonly RateLimitCheck[] {
  return RATE_LIMIT_PRESETS_V1[presetName].buckets.map((bucket) => {
    const [kind, value] = identityValue(bucket.scope, identity);
    return Object.freeze({
      namespace: `v1:${presetName}:${bucket.scope}`,
      keyHash: normalizedIdentifier(kind, value, key),
      scope: bucket.scope,
      limit: bucket.limit,
      windowMs: bucket.windowMs,
    });
  });
}

export async function consumeRateLimit(
  presetName: RateLimitPresetName,
  identity: ServerRateLimitIdentity,
  dependencies: Readonly<{
    store: RateLimitStore;
    key: VersionedHashKey;
    now: Date;
  }>,
): Promise<RateLimitDecision> {
  if (presetName === "PRIVACY_REQUEST" && identity.samePrivacyTypeOpen) {
    return Object.freeze({
      allowed: false,
      status: 429,
      code: "OPEN_REQUEST_EXISTS",
      retryAfterSeconds: 0,
      audit: Object.freeze({
        action: "RATE_LIMITED",
        preset: presetName,
        scope: "OPEN_TYPE",
      }),
    });
  }
  if (presetName === "RADAR_LIST" && identity.membershipActive !== true) {
    return Object.freeze({
      allowed: false,
      status: 429,
      code: "INACTIVE_MEMBERSHIP",
      retryAfterSeconds: 0,
      audit: Object.freeze({
        action: "RATE_LIMITED",
        preset: presetName,
        scope: "MEMBERSHIP",
      }),
    });
  }

  const checks = buildRateLimitChecks(presetName, identity, dependencies.key);
  const decision = await dependencies.store.consume(checks, dependencies.now);
  if (decision.allowed) {
    return Object.freeze({ allowed: true, status: 200 });
  }
  return Object.freeze({
    allowed: false,
    status: 429,
    code: "RATE_LIMITED",
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((decision.retryAfterMilliseconds ?? 1_000) / 1_000),
    ),
    audit: Object.freeze({
      action: "RATE_LIMITED",
      preset: presetName,
      scope: decision.blockedScope ?? "UNKNOWN",
    }),
  });
}

type MemoryHit = { at: number; count: number };

export function createMemoryRateLimitStore(
  runtime: "local" | "test",
): RateLimitStore {
  if (runtime !== "local" && runtime !== "test") {
    throw new Error("The in-memory rate-limit store is local/test only.");
  }
  const hits = new Map<string, MemoryHit[]>();
  const store: RateLimitStore = {
    async consume(checks, now) {
      const nowMs = now.getTime();
      if (Number.isNaN(nowMs))
        throw new TypeError("Rate-limit clock must be valid.");
      const prepared = checks.map((check) => {
        const id = `${check.namespace}:${check.keyHash}`;
        const current = (hits.get(id) ?? []).filter(
          (hit) => hit.at > nowMs - check.windowMs && hit.at <= nowMs,
        );
        const count = current.reduce((sum, hit) => sum + hit.count, 0);
        return { check, id, current, count };
      });
      const blocked = prepared.find(
        (entry) => entry.count >= entry.check.limit,
      );
      if (blocked) {
        const oldest = blocked.current[0]?.at ?? nowMs;
        return Object.freeze({
          allowed: false,
          blockedScope: blocked.check.scope,
          retryAfterMilliseconds: Math.max(
            1,
            oldest + blocked.check.windowMs - nowMs,
          ),
        });
      }
      for (const entry of prepared) {
        const last = entry.current.at(-1);
        if (last?.at === nowMs) last.count += 1;
        else entry.current.push({ at: nowMs, count: 1 });
        hits.set(entry.id, entry.current);
      }
      return Object.freeze({ allowed: true });
    },
  };
  return Object.freeze(store);
}

export function createPostgresRateLimitStore(
  database: DatabaseClient,
): RateLimitStore {
  const store: RateLimitStore = {
    async consume(checks, now) {
      if (checks.length === 0) return Object.freeze({ allowed: true });
      return database.$transaction(async (transaction) => {
        const sorted = [...checks].sort((a, b) =>
          `${a.namespace}:${a.keyHash}`.localeCompare(
            `${b.namespace}:${b.keyHash}`,
          ),
        );
        for (const check of sorted) {
          await transaction.$queryRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"',
            `${check.namespace}:${check.keyHash}`,
          );
        }

        for (const check of checks) {
          const cutoff = new Date(now.getTime() - check.windowMs);
          const rows = await transaction.$queryRawUnsafe<
            Array<{ count: bigint; oldest: Date | null }>
          >(
            `SELECT COALESCE(SUM("count"), 0)::bigint AS "count", MIN("windowStart") AS "oldest"
             FROM "RateLimitBucket"
             WHERE "namespace" = $1 AND "keyHash" = $2
               AND "windowStart" > $3 AND "windowStart" <= $4`,
            check.namespace,
            check.keyHash,
            cutoff,
            now,
          );
          const count = Number(rows[0]?.count ?? 0n);
          if (count >= check.limit) {
            const oldest = rows[0]?.oldest?.getTime() ?? now.getTime();
            return Object.freeze({
              allowed: false,
              blockedScope: check.scope,
              retryAfterMilliseconds: Math.max(
                1,
                oldest + check.windowMs - now.getTime(),
              ),
            });
          }
        }

        for (const check of checks) {
          const end = new Date(now.getTime() + check.windowMs);
          await transaction.$executeRawUnsafe(
            `INSERT INTO "RateLimitBucket"
               ("id","namespace","keyHash","windowStart","windowEnd","count","version","expiresAt","createdAt","updatedAt")
             VALUES (gen_random_uuid(),$1,$2,$3,$4,1,1,$4,$3,$3)
             ON CONFLICT ("namespace","keyHash","windowStart")
             DO UPDATE SET "count" = "RateLimitBucket"."count" + 1, "updatedAt" = EXCLUDED."updatedAt"`,
            check.namespace,
            check.keyHash,
            now,
            end,
          );
        }
        return Object.freeze({ allowed: true });
      });
    },
  };
  return Object.freeze(store);
}

/**
 * Persists the Company-wide Radar search budget independently of the rolling
 * RADAR_LIST membership rate limit. The transaction-level advisory lock makes
 * the count-then-insert decision safe across processes and Prisma clients.
 */
export function createPostgresRadarDistinctFilterBudget(
  database: DatabaseClient,
): RadarDistinctFilterBudget {
  return Object.freeze({
    async consume(input: RadarDistinctFilterBudgetInput) {
      assertRadarDistinctFilterBudgetInput(input);
      const calendarDate = getRadarZurichCalendarDate(input.now);
      const persistedCalendarDate = new Date(`${calendarDate}T00:00:00.000Z`);
      const lockKey = `v1:radar-distinct-filter-budget:${input.companyId}:${calendarDate}`;

      return database.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"',
          lockKey,
        );

        const existing = await transaction.radarSearchBudget.findUnique({
          where: {
            companyId_calendarDate_filterHash: {
              companyId: input.companyId,
              calendarDate: persistedCalendarDate,
              filterHash: input.filterHash,
            },
          },
          select: { id: true },
        });

        if (existing !== null) {
          await transaction.radarSearchBudget.update({
            where: { id: existing.id },
            data: { lastUsedAt: input.now },
          });
          const distinctFiltersUsed = await transaction.radarSearchBudget.count({
            where: { companyId: input.companyId, calendarDate: persistedCalendarDate },
          });
          return radarBudgetAllowed(
            calendarDate,
            false,
            distinctFiltersUsed,
          );
        }

        const distinctFiltersUsed = await transaction.radarSearchBudget.count({
          where: { companyId: input.companyId, calendarDate: persistedCalendarDate },
        });
        if (distinctFiltersUsed >= RADAR_DISTINCT_FILTER_BUDGET_V1.limit) {
          return radarBudgetDenied(calendarDate, distinctFiltersUsed, input.now);
        }

        await transaction.radarSearchBudget.create({
          data: {
            companyId: input.companyId,
            calendarDate: persistedCalendarDate,
            filterHash: input.filterHash,
            firstUsedAt: input.now,
            lastUsedAt: input.now,
          },
        });
        return radarBudgetAllowed(
          calendarDate,
          true,
          distinctFiltersUsed + 1,
        );
      });
    },
  });
}

export function getRadarZurichCalendarDate(instant: Date): string {
  assertValidRadarBudgetInstant(instant);
  const parts = getZurichDateTimeParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function radarBudgetAllowed(
  calendarDate: string,
  isNewFilter: boolean,
  distinctFiltersUsed: number,
): RadarDistinctFilterBudgetDecision {
  return Object.freeze({
    allowed: true,
    status: 200,
    calendarDate,
    isNewFilter,
    distinctFiltersUsed,
    remaining: Math.max(
      0,
      RADAR_DISTINCT_FILTER_BUDGET_V1.limit - distinctFiltersUsed,
    ),
  });
}

function radarBudgetDenied(
  calendarDate: string,
  distinctFiltersUsed: number,
  now: Date,
): RadarDistinctFilterBudgetDecision {
  return Object.freeze({
    allowed: false,
    status: 429,
    code: "RADAR_DISTINCT_FILTER_BUDGET_EXHAUSTED",
    calendarDate,
    distinctFiltersUsed,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(
        (getNextZurichDayStart(calendarDate).getTime() - now.getTime()) / 1_000,
      ),
    ),
    audit: Object.freeze({
      action: "RATE_LIMITED",
      preset: "RADAR_LIST",
      scope: "COMPANY",
    }),
  });
}

function assertRadarDistinctFilterBudgetInput(
  input: RadarDistinctFilterBudgetInput,
): void {
  if (!UUID_PATTERN.test(input.companyId)) {
    throw new TypeError("A valid Radar Company id is required.");
  }
  if (!SHA_256_HEX_PATTERN.test(input.filterHash)) {
    throw new TypeError("A canonical lowercase SHA-256 Radar filter hash is required.");
  }
  assertValidRadarBudgetInstant(input.now);
}

function assertValidRadarBudgetInstant(instant: Date): void {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new TypeError("A valid Radar budget instant is required.");
  }
}

function getNextZurichDayStart(calendarDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(calendarDate);
  if (match === null) {
    throw new TypeError("A canonical Radar calendar date is required.");
  }
  const nominalNextDay = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1),
  );
  const nextDate = [
    nominalNextDay.getUTCFullYear(),
    String(nominalNextDay.getUTCMonth() + 1).padStart(2, "0"),
    String(nominalNextDay.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return projectZurichMidnightToUtc(nextDate);
}

function projectZurichMidnightToUtc(calendarDate: string): Date {
  const [yearText, monthText, dayText] = calendarDate.split("-");
  const nominalUtc = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
  );
  let projected = nominalUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = getZurichDateTimeParts(new Date(projected));
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const next = nominalUtc - (representedAsUtc - projected);
    if (next === projected) break;
    projected = next;
  }
  const result = new Date(projected);
  const represented = getZurichDateTimeParts(result);
  if (
    `${represented.year}-${represented.month}-${represented.day}` !==
      calendarDate ||
    represented.hour !== "00" ||
    represented.minute !== "00" ||
    represented.second !== "00"
  ) {
    throw new Error("Europe/Zurich midnight could not be resolved.");
  }
  return result;
}

type ZurichDateTimeParts = Readonly<{
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}>;

function getZurichDateTimeParts(instant: Date): ZurichDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RADAR_DISTINCT_FILTER_BUDGET_V1.calendarTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const required = ["year", "month", "day", "hour", "minute", "second"] as const;
  if (required.some((part) => typeof values[part] !== "string")) {
    throw new Error("Europe/Zurich calendar parts could not be resolved.");
  }
  return Object.freeze({
    year: values.year as string,
    month: values.month as string,
    day: values.day as string,
    hour: values.hour as string,
    minute: values.minute as string,
    second: values.second as string,
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type TrustedProxyTopology = Readonly<{
  trustedProxyAddresses: readonly string[];
  forwardedHops: number;
}>;

export function resolveSourceIp(
  input: Readonly<{
    remoteAddress: string;
    forwardedForHeader?: string | null;
    topology?: TrustedProxyTopology;
  }>,
): string {
  const directPeer = normalizeIpAddress(input.remoteAddress);
  const header = input.forwardedForHeader?.trim();
  if (!header || input.topology === undefined) return directPeer;
  if (
    !Number.isInteger(input.topology.forwardedHops) ||
    input.topology.forwardedHops < 1
  ) {
    throw new TypeError("Trusted proxy hop count must be a positive integer.");
  }
  const trusted = new Set(
    input.topology.trustedProxyAddresses.map(normalizeIpAddress),
  );
  if (!trusted.has(directPeer)) return directPeer;

  const chain = header
    .split(",")
    .map((part) => normalizeIpAddress(part.trim()));
  const index = chain.length - input.topology.forwardedHops;
  if (index < 0)
    throw new TypeError(
      "Forwarded chain is shorter than the trusted topology.",
    );
  return chain[index] as string;
}
