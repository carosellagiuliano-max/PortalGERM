-- Phase 09 keeps the publication timestamp as history when Radar is withdrawn.

BEGIN;

ALTER TABLE "RadarProfile"
  DROP CONSTRAINT "radar_profile_ranges_check";

ALTER TABLE "RadarProfile"
  ADD CONSTRAINT "radar_profile_ranges_check"
  CHECK (
    (("workloadMin" IS NULL AND "workloadMax" IS NULL)
      OR ("workloadMin" IS NOT NULL AND "workloadMax" IS NOT NULL
        AND "workloadMin" BETWEEN 1 AND 100
        AND "workloadMin" <= "workloadMax"
        AND "workloadMax" <= 100))
    AND (("salaryYearlyMinChf" IS NULL AND "salaryYearlyMaxChf" IS NULL)
      OR ("salaryYearlyMinChf" IS NOT NULL AND "salaryYearlyMaxChf" IS NOT NULL
        AND "salaryYearlyMinChf" >= 0
        AND "salaryYearlyMinChf" <= "salaryYearlyMaxChf"))
    AND ("withdrawnAt" IS NULL OR "publishedAt" IS NULL OR "withdrawnAt" >= "publishedAt")
  );

COMMIT;
