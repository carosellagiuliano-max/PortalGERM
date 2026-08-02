import "server-only";

import { CLUSTER_EVALUATION_BATCH_SIZE } from "@/lib/admin/cluster-evaluation-policy";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { SITEMAP_CAPACITY_POLICY_V1 } from "@/lib/seo/sitemap-capacity";
import { measureAndPersistSitemapCapacity } from "@/lib/seo/sitemap-capacity-monitor";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const environment = parseEnvironment(process.env);
const database = environment.secrets.database.withValue(createDatabaseClient);

try {
  const candidateJobCount = await database.job.count();
  const result = await measureAndPersistSitemapCapacity({
    database,
    origin: environment.APP_URL,
  });
  const headroomBasisPoints = Math.max(0, 10_000 - result.utilizationBps);
  const firstClusterBatchUtilizationBasisPoints = Math.floor(
    (candidateJobCount * 10_000) / CLUSTER_EVALUATION_BATCH_SIZE,
  );

  if (
    result.level !== "HEALTHY" ||
    result.shardImplementationTriggered ||
    result.reasons.length > 0 ||
    result.forecast90dCount >= SITEMAP_CAPACITY_POLICY_V1.maximumUrls ||
    result.forecast90dBytes >=
      SITEMAP_CAPACITY_POLICY_V1.maximumUncompressedBytes
  ) {
    throw new Error("PHASE33_SCALE_READINESS_BLOCKED");
  }

  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-scale-readiness",
      status: "PASS",
      observationId: result.observationId,
      owner: SITEMAP_CAPACITY_POLICY_V1.owner,
      current: {
        candidateJobCount,
        urlCount: result.urlCount,
        estimatedBytes: result.estimatedBytes,
        runtimeMilliseconds: result.runtimeMs,
      },
      forecast90Days: {
        urlCount: result.forecast90dCount,
        estimatedBytes: result.forecast90dBytes,
        growth7dBasisPoints: result.growth7dBps,
        growth30dBasisPoints: result.growth30dBps,
      },
      capacity: {
        maximumUrls: SITEMAP_CAPACITY_POLICY_V1.maximumUrls,
        maximumUncompressedBytes:
          SITEMAP_CAPACITY_POLICY_V1.maximumUncompressedBytes,
        utilizationBasisPoints: result.utilizationBps,
        headroomBasisPoints,
      },
      responseThresholds: {
        planAtBasisPoints: SITEMAP_CAPACITY_POLICY_V1.planAtBps,
        deployAtBasisPoints: SITEMAP_CAPACITY_POLICY_V1.deployAtBps,
        blockExpansionAtBasisPoints:
          SITEMAP_CAPACITY_POLICY_V1.blockExpansionAtBps,
      },
      clusterEvaluation: {
        batchSize: CLUSTER_EVALUATION_BATCH_SIZE,
        firstBatchUtilizationBasisPoints:
          firstClusterBatchUtilizationBasisPoints,
        paginatesBeyondFirstBatch: true,
        substringIndexCutoverClaimed: false,
      },
      decision: result.level,
      forecastBasis:
        result.growth30dBps === 0
          ? "CURRENT_CANDIDATE_WITH_NO_POSITIVE_30_DAY_GROWTH"
          : "APPEND_ONLY_30_DAY_OBSERVATION",
      targetEnvironmentMeasurementRequiredBeforeActivation: true,
    })}\n`,
  );
} finally {
  await database.$disconnect();
}
