-- Phase 34: preserve the existing accent-insensitive substring contract while
-- making selective public keyword searches indexable. These helpers are
-- immutable because every input transformation is deterministic and contains
-- no locale-, clock- or table-dependent lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION phase34_normalize_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT regexp_replace(
    normalize(lower(input), NFKD),
    '[\u0300-\u036f]',
    '',
    'g'
  );
$$;

CREATE OR REPLACE FUNCTION phase34_job_revision_search_document(
  title text,
  description text,
  tasks text[],
  requirements text[],
  offer text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT phase34_normalize_search_text(
    COALESCE(title, '') || E'\n' ||
    COALESCE(description, '') || E'\n' ||
    COALESCE(array_to_string(tasks, E'\n'), '') || E'\n' ||
    COALESCE(array_to_string(requirements, E'\n'), '') || E'\n' ||
    COALESCE(offer, '')
  );
$$;

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "searchDocument" text
  GENERATED ALWAYS AS (phase34_normalize_search_text("name")) STORED;

ALTER TABLE "JobRevision"
  ADD COLUMN IF NOT EXISTS "searchDocument" text
  GENERATED ALWAYS AS (
    phase34_job_revision_search_document(
      "title",
      "description",
      "tasks",
      "requirements",
      "offer"
    )
  ) STORED;

-- The migration is intentionally not wrapped in an explicit transaction so
-- PostgreSQL can build both indexes without blocking ordinary writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "company_phase34_search_document_trgm_idx"
  ON "Company" USING GIN ("searchDocument" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "job_revision_phase34_search_document_trgm_idx"
  ON "JobRevision" USING GIN ("searchDocument" gin_trgm_ops);
