-- Serialize both directions of the verification-supersession invariant on the
-- predecessor row. This is additive so databases that already applied the
-- earlier Phase-10 migrations receive the same race-safe contract.
CREATE OR REPLACE FUNCTION enforce_verification_supersession_terminal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  predecessor_status "CompanyVerificationStatus";
BEGIN
  IF NEW."supersedesRequestId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- A concurrent status update already owns (or waits for) this row lock.
  SELECT previous."status"
    INTO predecessor_status
  FROM "CompanyVerificationRequest" AS previous
  WHERE previous."id" = NEW."supersedesRequestId"
    AND previous."companyId" = NEW."companyId"
  FOR UPDATE;

  IF NOT FOUND OR predecessor_status NOT IN ('REJECTED', 'REVOKED') THEN
    RAISE EXCEPTION 'Verification cycles may supersede only a terminal cycle in the same Company'
      USING ERRCODE = '23514', CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_verification_predecessor_terminal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- PostgreSQL locks NEW before this BEFORE UPDATE trigger runs. The successor
  -- trigger above takes the same lock before it accepts a supersession link.
  IF NEW.status NOT IN ('REJECTED', 'REVOKED')
    AND EXISTS (
      SELECT 1
      FROM "CompanyVerificationRequest" AS child
      WHERE child."supersedesRequestId" = NEW.id
        AND child."companyId" = NEW."companyId"
    ) THEN
    RAISE EXCEPTION 'A superseded verification cycle must remain terminal'
      USING ERRCODE = '23514', CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;
