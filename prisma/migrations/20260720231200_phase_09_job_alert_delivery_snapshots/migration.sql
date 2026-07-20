BEGIN;

-- A failed local mailbox capture keeps its durable digest for retry. Freeze the
-- non-secret delivery identity on that digest so later Alert/profile edits
-- cannot change the EmailLog identity or rendered content during recovery.
ALTER TABLE "JobAlertDigest"
  ADD COLUMN "alertNameSnapshot" varchar(80),
  ADD COLUMN "recipientEmailSnapshot" varchar(320);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recover the original provider operation even when the Candidate changed the
-- Alert name or account email after a failed capture. MockEmailProvider derives
-- its UUID from length-prefixed recipient/template/operation values; matching
-- that UUID lets this migration reuse the already redacted EmailLog envelope.
WITH pending_digests AS (
  SELECT digest_row.*
  FROM "JobAlertDigest" AS digest_row
  JOIN "JobAlert" AS alert
    ON alert."id" = digest_row."jobAlertId"
  WHERE digest_row."windowStart" = COALESCE(
      alert."lastSuccessfulCutoffAt",
      alert."createdAt"
    )
    AND digest_row."windowEnd" > COALESCE(
      alert."lastSuccessfulCutoffAt",
      alert."createdAt"
    )
), operation_candidates AS (
  SELECT
    digest_row."id" AS "digestId",
    email_log."id" AS "emailLogId",
    email_log."recipient",
    (regexp_match(
      email_log."payload" ->> 'body',
      'Für «(.{1,80})» wurden [0-9]+ neue Stellen vorgemerkt[.]'
    ))[1] AS "alertName",
    encode(
      digest(
        int4send(octet_length('mock-email-operation-v2'::text))
          || convert_to('mock-email-operation-v2', 'UTF8')
          || int4send(octet_length(email_log."recipient"))
          || convert_to(email_log."recipient", 'UTF8')
          || int4send(octet_length('job_alert_digest_mock'::text))
          || convert_to('job_alert_digest_mock', 'UTF8')
          || int4send(0)
          || int4send(octet_length(
            'job-alert-digest:' || digest_row."id"::text
          ))
          || convert_to(
            'job-alert-digest:' || digest_row."id"::text,
            'UTF8'
          ),
        'sha256'
      ),
      'hex'
    ) AS "operationHex"
  FROM pending_digests AS digest_row
  CROSS JOIN "EmailLog" AS email_log
  WHERE email_log."purpose" = 'job_alert_digest_mock'
    AND email_log."templateKey" = 'job_alert_digest_mock'
), operation_ids AS (
  SELECT
    candidate.*,
    substring(candidate."operationHex", 1, 12)
      || '4'
      || substring(candidate."operationHex", 14, 3)
      || 'a'
      || substring(candidate."operationHex", 18, 15) AS "operationUuidHex"
  FROM operation_candidates AS candidate
), original_delivery_snapshots AS (
  SELECT
    operation."digestId",
    operation."recipient",
    operation."alertName",
    count(*) OVER (PARTITION BY operation."digestId") AS "matchCount"
  FROM operation_ids AS operation
  WHERE operation."emailLogId" = (
    substring(operation."operationUuidHex", 1, 8)
      || '-'
      || substring(operation."operationUuidHex", 9, 4)
      || '-'
      || substring(operation."operationUuidHex", 13, 4)
      || '-'
      || substring(operation."operationUuidHex", 17, 4)
      || '-'
      || substring(operation."operationUuidHex", 21, 12)
  )::uuid
    AND operation."alertName" IS NOT NULL
)
UPDATE "JobAlertDigest" AS digest_row
SET
  "alertNameSnapshot" = snapshot."alertName",
  "recipientEmailSnapshot" = snapshot."recipient"
FROM original_delivery_snapshots AS snapshot
WHERE digest_row."id" = snapshot."digestId"
  AND snapshot."matchCount" = 1;

-- Remaining digests are already completed or have no deterministic provider
-- log to recover; backfill them from the owning Alert and normalized account.
UPDATE "JobAlertDigest" AS digest
SET
  "alertNameSnapshot" = CASE
    WHEN jsonb_typeof(alert."query" -> 'keyword') = 'string'
      AND char_length(btrim(alert."query" ->> 'keyword')) BETWEEN 1 AND 80
      THEN btrim(alert."query" ->> 'keyword')
    ELSE 'Dein Jobabo'
  END,
  "recipientEmailSnapshot" = candidate_user."emailNormalized"
FROM "JobAlert" AS alert
JOIN "CandidateProfile" AS candidate
  ON candidate."id" = alert."candidateProfileId"
JOIN "User" AS candidate_user
  ON candidate_user."id" = candidate."userId"
WHERE digest."jobAlertId" = alert."id"
  AND digest."alertNameSnapshot" IS NULL
  AND digest."recipientEmailSnapshot" IS NULL;

ALTER TABLE "JobAlertDigest"
  ALTER COLUMN "alertNameSnapshot" SET NOT NULL,
  ALTER COLUMN "recipientEmailSnapshot" SET NOT NULL,
  ADD CONSTRAINT "job_alert_digest_delivery_snapshot_check"
    CHECK (
      char_length("alertNameSnapshot") BETWEEN 1 AND 80
      AND "alertNameSnapshot" = btrim("alertNameSnapshot")
      AND char_length("recipientEmailSnapshot") BETWEEN 3 AND 320
      AND "recipientEmailSnapshot" = btrim("recipientEmailSnapshot")
    );

COMMIT;
