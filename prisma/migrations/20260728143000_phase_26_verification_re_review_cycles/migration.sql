-- Phase 26 adds scheduled re-review. A previously VERIFIED cycle is terminal
-- evidence history and may be superseded by a new V2 request; its trust effect
-- remains governed by the separate current projection.
CREATE OR REPLACE FUNCTION enforce_verification_supersession_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor_status "CompanyVerificationStatus";
BEGIN
  IF NEW."supersedesRequestId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT previous."status"
    INTO predecessor_status
    FROM "CompanyVerificationRequest" AS previous
   WHERE previous."id" = NEW."supersedesRequestId"
     AND previous."companyId" = NEW."companyId"
   FOR UPDATE;
  IF NOT FOUND OR predecessor_status NOT IN ('VERIFIED', 'REJECTED', 'REVOKED') THEN
    RAISE EXCEPTION 'Verification cycles may supersede only a terminal cycle in the same Company'
      USING ERRCODE = '23514',
            CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_verification_predecessor_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('VERIFIED', 'REJECTED', 'REVOKED')
    AND EXISTS (
      SELECT 1
        FROM "CompanyVerificationRequest" AS child
       WHERE child."supersedesRequestId" = NEW.id
         AND child."companyId" = NEW."companyId"
    ) THEN
    RAISE EXCEPTION 'A superseded verification cycle must remain terminal'
      USING ERRCODE = '23514',
            CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;
