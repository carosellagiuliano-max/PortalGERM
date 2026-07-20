-- Candidate onboarding accepts normalized ISO-style two-letter language codes

BEGIN;
-- only. Tighten the original lowercase/length check so punctuation and digits
-- cannot satisfy the persisted onboarding contract.
ALTER TABLE "CandidateLanguage"
  DROP CONSTRAINT "candidate_language_code_check";

ALTER TABLE "CandidateLanguage"
  ADD CONSTRAINT "candidate_language_code_check"
  CHECK ("code" ~ '^[a-z]{2}$') NOT VALID;

ALTER TABLE "CandidateLanguage"
  VALIDATE CONSTRAINT "candidate_language_code_check";

COMMIT;
