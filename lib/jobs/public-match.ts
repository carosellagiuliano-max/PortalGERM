import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import type { PublicJobDetailModel } from "@/lib/public/types";
import {
  calculateCandidateMatchV1,
  type MatchResult,
} from "@/lib/scoring/match-score";

/**
 * Personal fit is loaded only for the authenticated Candidate owner. The
 * returned result contains calculated factors but no profile or identity data.
 */
export async function getCurrentCandidateMatchForJob(
  job: PublicJobDetailModel,
): Promise<MatchResult | null> {
  const user = await getCurrentUser();
  if (user?.role !== "CANDIDATE") return null;

  const profile = await getDatabase().candidateProfile.findUnique({
    where: { userId: user.id },
    select: {
      cantonId: true,
      skills: { select: { skillId: true } },
      languages: { select: { code: true, level: true } },
      preference: {
        select: {
          desiredJobTypes: true,
          salaryPeriod: true,
          salaryMinChf: true,
          salaryMaxChf: true,
          workloadMin: true,
          workloadMax: true,
          remotePreference: true,
          availableFrom: true,
        },
      },
    },
  });
  if (profile === null) return null;

  const preference = profile.preference;
  return calculateCandidateMatchV1({
    candidate: {
      skills: profile.skills.map((entry) => entry.skillId),
      ...(profile.cantonId === null
        ? {}
        : { acceptableCantonIds: [profile.cantonId] }),
      ...(preference?.workloadMin === null || preference?.workloadMin === undefined
        ? {}
        : { workloadMin: preference.workloadMin }),
      ...(preference?.workloadMax === null || preference?.workloadMax === undefined
        ? {}
        : { workloadMax: preference.workloadMax }),
      ...(preference?.salaryMinChf === null || preference?.salaryMinChf === undefined
        ? {}
        : { desiredSalaryMin: preference.salaryMinChf }),
      ...(preference?.salaryMaxChf === null || preference?.salaryMaxChf === undefined
        ? {}
        : { desiredSalaryMax: preference.salaryMaxChf }),
      ...(preference?.salaryPeriod === null || preference?.salaryPeriod === undefined
        ? {}
        : { desiredSalaryPeriod: preference.salaryPeriod }),
      ...(preference?.remotePreference === null || preference?.remotePreference === undefined
        ? {}
        : { remotePreference: preference.remotePreference }),
      languages: profile.languages.map((entry) => ({
        code: entry.code,
        level: entry.level,
      })),
      ...(preference?.desiredJobTypes.length
        ? { jobTypes: preference.desiredJobTypes }
        : {}),
      ...(preference?.availableFrom === null || preference?.availableFrom === undefined
        ? {}
        : { availabilityDate: preference.availableFrom }),
    },
    job: {
      requiredSkills: job.skills.filter((skill) => skill.required).map((skill) => skill.id),
      ...(job.canton === null ? {} : { cantonId: job.canton.id }),
      workloadMin: job.workloadMin,
      workloadMax: job.workloadMax,
      ...(job.salaryMin === null ? {} : { salaryMin: job.salaryMin }),
      ...(job.salaryMax === null ? {} : { salaryMax: job.salaryMax }),
      ...(job.salaryPeriod === null ? {} : { salaryPeriod: job.salaryPeriod }),
      remoteType: job.remoteType,
      requiredLanguages: job.languages,
      jobType: job.jobType,
      ...(job.startDate === null ? {} : { startDate: job.startDate }),
    },
  });
}
