import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_SEPARATOR = String.fromCharCode(0);

/**
 * Stable, non-reversible subject key for candidate-funnel joins. Raw User ids
 * never enter AnalyticsEvent subject columns.
 */
export function candidateAnalyticsSubjectV1(userId: string): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new TypeError("Candidate analytics requires a valid User id.");
  }
  const digest = createHash("sha256")
    .update("candidate-analytics-subject-v1", "utf8")
    .update(HASH_SEPARATOR, "utf8")
    .update(userId.toLocaleLowerCase("en-US"), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `candidate-v1-${digest}`;
}
