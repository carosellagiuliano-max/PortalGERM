"use server";

import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { emptyPublicJobSearchInput, listPublicJobs } from "@/lib/jobs/public-read-model";
import { parsePublicSalaryRadarQuery, loadPublicSalaryRadar } from "@/lib/salary/public-radar";
import type { PublicSalaryRadarActionState } from "@/lib/salary/public-radar-state";

export async function calculatePublicSalaryRadarAction(
  _previous: PublicSalaryRadarActionState,
  formData: FormData,
): Promise<PublicSalaryRadarActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ status: "error", message: "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu." });
  }
  const query = parsePublicSalaryRadarQuery(formData);
  if (query === null) {
    return Object.freeze({ status: "error", message: "Bitte prüfe die ausgewählten Angaben." });
  }
  const result = await loadPublicSalaryRadar(query);
  if (result.status === "NO_RESULT") {
    return Object.freeze({ status: "result", result, jobs: Object.freeze([]) });
  }
  const candidates = await listPublicJobs(
    Object.freeze({
      ...emptyPublicJobSearchInput(),
      categorySlugs: Object.freeze([query.categorySlug]),
      cantonSlugs: Object.freeze([query.cantonSlug]),
      salaryMin: Math.max(1, result.adjustedP25Chf),
      sort: "salary" as const,
    }),
    { pageSize: 20 },
  );
  const jobs = candidates.jobs.filter((job) =>
    job.salaryMin !== null && job.salaryMax !== null &&
    job.salaryMax >= result.adjustedP25Chf &&
    job.salaryMin <= result.adjustedP75Chf,
  ).slice(0, 4);
  return Object.freeze({ status: "result", result, jobs: Object.freeze(jobs) });
}
