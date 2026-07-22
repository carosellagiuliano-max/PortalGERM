import { slugify } from "@/lib/utils/slug";

export const JOB_SLUG_MAX_LENGTH = 220;
export const JOB_COMPANY_SHORT_REF_LENGTH = 24;
export const JOB_SHORT_ID_SEGMENT_LENGTH = 12;

export type JobSlugInput = Readonly<{
  title: string;
  companyShortRef: string;
  jobId: string;
}>;

/**
 * Builds the immutable public slug assigned when a Job row is created.
 * Callers persist the result once; later title or company-name edits must not
 * recalculate it.
 */
export function createJobSlug(input: JobSlugInput): string {
  const title = slugify(input.title);
  const companyShortRef = truncateSegment(
    slugify(input.companyShortRef),
    JOB_COMPANY_SHORT_REF_LENGTH,
  );
  const shortId = input.jobId
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, JOB_SHORT_ID_SEGMENT_LENGTH);

  if (title.length === 0) {
    throw new TypeError("A Job slug requires a title containing a letter or digit.");
  }
  if (companyShortRef.length === 0) {
    throw new TypeError("A Job slug requires a company short reference.");
  }
  if (shortId.length !== JOB_SHORT_ID_SEGMENT_LENGTH) {
    throw new TypeError("A Job slug requires a sufficiently long stable Job id.");
  }

  const suffix = `-${companyShortRef}-${shortId}`;
  const titleSegment = truncateSegment(
    title,
    JOB_SLUG_MAX_LENGTH - suffix.length,
  );
  if (titleSegment.length === 0) {
    throw new TypeError("A Job slug title cannot fit within the maximum length.");
  }

  return `${titleSegment}${suffix}`;
}

function truncateSegment(value: string, maximumLength: number): string {
  return value.slice(0, maximumLength).replace(/-+$/gu, "");
}
