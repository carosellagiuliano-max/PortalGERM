import type { DataProvenance } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  ANALYTICS_EVENT_CONTRACTS_V1,
  analyticsEventV1Schema,
  getAnalyticsRetainUntilV1,
  type AnalyticsEventInputV1,
} from "@/lib/analytics/event-contracts";

export type AnalyticsProvenanceSnapshots = Readonly<{
  actor?: DataProvenance | null;
  company?: DataProvenance | null;
  job?: DataProvenance | null;
}>;

export type AnalyticsWriteRecord = Readonly<{
  producer: string;
  dedupeKey: string;
  kind: AnalyticsEventInputV1["kind"];
  schemaVersion: "1";
  purpose: "ESSENTIAL_OPERATIONAL" | "PRODUCT_ANALYTICS";
  occurredAt: Date;
  pseudonymousActorId: string | null;
  pseudonymousSessionId: string | null;
  companyId: string | null;
  jobId: string | null;
  actorProvenanceSnapshot: DataProvenance | null;
  companyProvenanceSnapshot: DataProvenance | null;
  jobProvenanceSnapshot: DataProvenance | null;
  properties: Prisma.InputJsonObject;
  retainUntil: Date;
}>;

export interface AnalyticsWriter {
  create(record: AnalyticsWriteRecord): Promise<"CREATED" | "DUPLICATE">;
  expire(retainUntilInclusive: Date): Promise<number>;
}

export type TrackAnalyticsResult = Readonly<{
  recorded: boolean;
  duplicate: boolean;
  skippedForPrivacy: boolean;
}>;

export async function trackAnalyticsEventV1(
  input: AnalyticsEventInputV1,
  context: Readonly<{
    producer: string;
    productAnalyticsEnabled: boolean;
    provenance?: AnalyticsProvenanceSnapshots;
  }>,
  writer: AnalyticsWriter,
): Promise<TrackAnalyticsResult> {
  const event = analyticsEventV1Schema.parse(input);
  const contract = ANALYTICS_EVENT_CONTRACTS_V1[event.kind];
  if (contract.purpose === "PRODUCT_ANALYTICS" && !context.productAnalyticsEnabled) {
    return Object.freeze({ recorded: false, duplicate: false, skippedForPrivacy: true });
  }
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(context.producer)) {
    throw new TypeError("Analytics producer is invalid.");
  }
  const result = await writer.create(Object.freeze({
    producer: context.producer,
    dedupeKey: event.producerEventId,
    kind: event.kind,
    schemaVersion: "1",
    purpose: contract.purpose,
    occurredAt: new Date(event.occurredAt),
    pseudonymousActorId: event.pseudonymousActorId ?? null,
    pseudonymousSessionId: event.pseudonymousSessionId ?? null,
    companyId: event.companyId ?? null,
    jobId: event.jobId ?? null,
    actorProvenanceSnapshot: context.provenance?.actor ?? null,
    companyProvenanceSnapshot: context.provenance?.company ?? null,
    jobProvenanceSnapshot: context.provenance?.job ?? null,
    properties: Object.freeze({ ...event.properties }) as Prisma.InputJsonObject,
    retainUntil: getAnalyticsRetainUntilV1(event.kind, event.occurredAt),
  }));
  return result === "DUPLICATE"
    ? Object.freeze({ recorded: false, duplicate: true, skippedForPrivacy: false })
    : Object.freeze({ recorded: true, duplicate: false, skippedForPrivacy: false });
}

export async function expireRawAnalyticsV1(
  now: Date,
  writer: AnalyticsWriter,
): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new TypeError("Analytics expiry clock must be valid.");
  return writer.expire(now);
}

export function createPrismaAnalyticsWriter(database: DatabaseClient): AnalyticsWriter {
  return {
    async create(record) {
      try {
        await database.analyticsEvent.create({ data: record });
        return "CREATED";
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          return "DUPLICATE";
        }
        throw error;
      }
    },
    async expire(retainUntilInclusive) {
      const result = await database.analyticsEvent.deleteMany({
        where: { retainUntil: { lte: retainUntilInclusive } },
      });
      return result.count;
    },
  };
}

export function createPrismaTransactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return {
    async create(record) {
      const result = await transaction.analyticsEvent.createMany({
        data: [record],
        skipDuplicates: true,
      });
      return result.count === 0 ? "DUPLICATE" : "CREATED";
    },
    async expire(retainUntilInclusive) {
      const result = await transaction.analyticsEvent.deleteMany({
        where: { retainUntil: { lte: retainUntilInclusive } },
      });
      return result.count;
    },
  };
}
