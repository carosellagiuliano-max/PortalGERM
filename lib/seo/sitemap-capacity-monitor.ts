import "server-only";

import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "@/lib/db/factory";
import { buildPublicSitemap } from "@/lib/seo/public-sitemap";
import {
  SITEMAP_CAPACITY_POLICY_V1,
  evaluateSitemapCapacityV1,
} from "@/lib/seo/sitemap-capacity";

const DAY_MS = 86_400_000;

export async function measureAndPersistSitemapCapacity(
  input: Readonly<{
    database: DatabaseClient;
    origin: string;
    now?: Date;
    buildSitemap?: typeof buildPublicSitemap;
  }>,
) {
  const now = input.now ?? new Date();
  const started = performance.now();
  let sitemap: Awaited<ReturnType<typeof buildPublicSitemap>>;
  try {
    sitemap = await (input.buildSitemap ?? buildPublicSitemap)({
      database: input.database,
      origin: input.origin,
      now,
    });
  } catch (error) {
    await persistFailedObservation(
      input.database,
      now,
      Math.max(0, Math.round(performance.now() - started)),
    );
    throw error;
  }
  const runtimeMs = Math.max(0, Math.round(performance.now() - started));
  const estimatedBytes = Buffer.byteLength(
    sitemap
      .map(
        (entry) =>
          `<url><loc>${entry.url}</loc><lastmod>${
            entry.lastModified instanceof Date
              ? entry.lastModified.toISOString()
              : (entry.lastModified ?? "")
          }</lastmod></url>`,
      )
      .join(""),
    "utf8",
  );
  const [previous7, previous30] = await Promise.all([
    observationAtOrBefore(input.database, new Date(now.getTime() - 7 * DAY_MS)),
    observationAtOrBefore(
      input.database,
      new Date(now.getTime() - 30 * DAY_MS),
    ),
  ]);
  const decision = evaluateSitemapCapacityV1({
    urlCount: sitemap.length,
    estimatedBytes,
    count30DaysAgo: previous30?.urlCount ?? sitemap.length,
    bytes30DaysAgo: Number(
      previous30?.estimatedBytes ?? BigInt(estimatedBytes),
    ),
    successful: true,
  });
  const growth7dBps = growthBps(sitemap.length, previous7?.urlCount);
  const growth30dBps = growthBps(sitemap.length, previous30?.urlCount);
  const observation = await input.database.sitemapCapacityObservation.create({
    data: {
      id: randomUUID(),
      resourceKey: "public-sitemap",
      observedAt: now,
      urlCount: sitemap.length,
      estimatedBytes,
      runtimeMs,
      growth7dBps,
      growth30dBps,
      forecast90dCount: decision.forecast90dCount,
      capacityLevel: decision.level,
      owner: SITEMAP_CAPACITY_POLICY_V1.owner,
      successful: true,
      createdAt: now,
    },
  });
  return Object.freeze({
    observationId: observation.id,
    urlCount: sitemap.length,
    estimatedBytes,
    runtimeMs,
    growth7dBps,
    growth30dBps,
    ...decision,
  });
}

async function persistFailedObservation(
  database: DatabaseClient,
  now: Date,
  runtimeMs: number,
) {
  const previous = await database.sitemapCapacityObservation.findFirst({
    where: { resourceKey: "public-sitemap", successful: true },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
  });
  const urlCount = previous?.urlCount ?? 0;
  const estimatedBytes = Number(previous?.estimatedBytes ?? 0n);
  const decision = evaluateSitemapCapacityV1({
    urlCount,
    estimatedBytes,
    count30DaysAgo: urlCount,
    bytes30DaysAgo: estimatedBytes,
    successful: false,
  });
  await database.sitemapCapacityObservation.create({
    data: {
      id: randomUUID(),
      resourceKey: "public-sitemap",
      observedAt: now,
      urlCount,
      estimatedBytes,
      runtimeMs,
      growth7dBps: 0,
      growth30dBps: 0,
      forecast90dCount: decision.forecast90dCount,
      capacityLevel: decision.level,
      owner: SITEMAP_CAPACITY_POLICY_V1.owner,
      successful: false,
      createdAt: now,
    },
  });
}

async function observationAtOrBefore(
  database: DatabaseClient,
  observedAt: Date,
) {
  return database.sitemapCapacityObservation.findFirst({
    where: { resourceKey: "public-sitemap", observedAt: { lte: observedAt } },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
  });
}

function growthBps(current: number, previous: number | undefined): number {
  if (previous === undefined || previous <= 0) return 0;
  return Math.floor(((current - previous) * 10_000) / previous);
}
