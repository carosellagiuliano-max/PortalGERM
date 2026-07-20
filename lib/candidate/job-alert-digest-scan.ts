export type JobAlertDigestScanOptions<Candidate, Match> = Readonly<{
  pageSize: number;
  maximumMatches: number;
  loadPage: (
    afterCursor: string | undefined,
    take: number,
  ) => Promise<readonly Candidate[]>;
  cursorOf: (candidate: Candidate) => string;
  evaluatePage: (candidates: readonly Candidate[]) => Promise<readonly Match[]>;
}>;

/**
 * Exhausts the keyset candidate stream until enough canonical matches have
 * been found. There is deliberately no pre-eligibility row cap: returning a
 * partial scan would advance the alert cutoff and permanently hide later
 * eligible jobs. Safety failures reject the run so its surrounding
 * transaction can roll back instead.
 */
export async function scanJobAlertDigestMatches<Candidate, Match>(
  options: JobAlertDigestScanOptions<Candidate, Match>,
): Promise<readonly Match[]> {
  assertPositiveInteger(options.pageSize, "pageSize");
  assertPositiveInteger(options.maximumMatches, "maximumMatches");

  const matches: Match[] = [];
  const visitedCursors = new Set<string>();
  let afterCursor: string | undefined;

  while (matches.length < options.maximumMatches) {
    const candidates = await options.loadPage(afterCursor, options.pageSize);
    if (candidates.length === 0) break;
    if (candidates.length > options.pageSize) {
      throw new RangeError("A job-alert scan page exceeded its safety bound.");
    }

    let nextCursor: string | undefined;
    if (candidates.length === options.pageSize) {
      const terminalCandidate = candidates.at(-1);
      if (terminalCandidate === undefined) {
        throw new Error("A non-empty job-alert scan page had no terminal row.");
      }
      nextCursor = options.cursorOf(terminalCandidate);
      if (nextCursor === "" || visitedCursors.has(nextCursor)) {
        throw new Error("Job-alert keyset scan did not advance.");
      }
      visitedCursors.add(nextCursor);
    }

    const evaluated = await options.evaluatePage(candidates);
    if (evaluated.length > candidates.length) {
      throw new RangeError("A job-alert scan page returned too many matches.");
    }
    matches.push(
      ...evaluated.slice(0, options.maximumMatches - matches.length),
    );
    if (
      matches.length === options.maximumMatches ||
      candidates.length < options.pageSize
    ) {
      break;
    }
    afterCursor = nextCursor;
  }

  return Object.freeze(matches);
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}
