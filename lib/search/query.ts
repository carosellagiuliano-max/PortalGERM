import "server-only";

import { listPublicJobs } from "@/lib/jobs/public-read-model";
import type { PublicJobSearchInput } from "@/lib/public/query-params";
import type { PublicJobSearchPage } from "@/lib/public/types";

/**
 * Single production entry point for the public Job search. Parsing and
 * canonical URL validation live in `lib/public/query-params`; this server-only
 * boundary delegates to the one database-backed search read model.
 */
export async function searchJobs(
  input: PublicJobSearchInput,
  options: Readonly<{ pageSize?: number; now?: Date }> = {},
): Promise<PublicJobSearchPage> {
  return listPublicJobs(input, options);
}
