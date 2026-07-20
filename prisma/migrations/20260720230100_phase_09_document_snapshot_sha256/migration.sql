-- Standardize persisted document identifiers on SHA-256 before Phase 09 writes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "ApplicationSubmissionDocument" DISABLE TRIGGER USER;
UPDATE "ApplicationSubmissionDocument" AS submission_document
SET "storageKeyHash" = encode(digest(document."storageKey", 'sha256'), 'hex')
FROM "CandidateDocumentMetadata" AS document
WHERE document."id" = submission_document."documentMetadataId";
ALTER TABLE "ApplicationSubmissionDocument" ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION phase09_enforce_application_document_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  document_row "CandidateDocumentMetadata"%ROWTYPE;
BEGIN
  SELECT * INTO document_row
  FROM "CandidateDocumentMetadata"
  WHERE "id" = NEW."documentMetadataId";

  IF document_row."id" IS NULL
    OR NEW."safeFilenameSnapshot" IS DISTINCT FROM document_row."safeFilename"
    OR NEW."mimeTypeSnapshot" IS DISTINCT FROM document_row."mimeType"
    OR NEW."sizeBytesSnapshot" IS DISTINCT FROM document_row."sizeBytes"
    OR NEW."storageKeyHash" IS DISTINCT FROM encode(digest(document_row."storageKey", 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'Application document snapshot must match the selected metadata'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_document_snapshot_match';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
