# Scoring rules

These policies are frozen product hypotheses. Existing versions are immutable:
formula changes require a new version, canonical fixtures, and a new fixture
hash. Both scorers are deterministic, receive plain values, and have no
database, React, commercial-plan, or paid-boost dependency.

Published scoring fixture hash (SHA-256):
`979ca264a9c5e124ae0a8ad650c0de84dccde674846fc295f66d8b4a0abb6d39`.

## Fair-Job-Score v2

The score rates advert transparency, not the employer. Factors are evaluated
in this fixed order:

1. Salary: 25 points for positive whole-CHF `min <= max` plus a valid period.
2. Tasks and requirements: 0/8/15 for `MISSING`/`PARTIAL`/`CLEAR`.
3. Workload, contract, and start: 15 points.
4. Location and remote policy: 10 points.
5. Application process: 10 points.
6. Response target: 10 points for an integer from 1 through 30 days.
7. Benefits: 5 points for at least two unique, allowlisted concrete benefits.
8. Inclusion and public contact: 5 points.
9. Freshness: 5 points when `now < validThrough <= now + 120 days`.

Structured text is trimmed and internal whitespace is collapsed. A structured
item is valid at 20–500 Unicode code points. `CLEAR` needs at least three valid
tasks and three valid requirements; `PARTIAL` needs at least one of each.
Inclusion text uses 30–500 code points. Process documents are restricted in P0
to `NONE`, `CV`, and `COVER_LETTER`, with `NONE` mutually exclusive. Onsite and
hybrid work need canton and city; remote work needs country `CH`. The clock is
always injected. Missing or invalid evidence scores zero, and the direct point
sum is returned without normalization or hidden rounding.

`buildFairJobInputV2({ revision, job })` is the sole production builder. Its
plain revision input mirrors persisted evidence and verifies that the revision
belongs to the supplied job. Company verification, plan, product, payment, and
boost are deliberately absent from `FairJobInput`.

`buildFairJobScoreSnapshotV2` serializes the complete Revision/Job builder
input, the derived input and the injected scoring clock into the mandatory
`JobScoreSnapshot.inputSnapshot`. The same insert stores the ordered evidence,
factor points and a canonical SHA-256 evidence hash. Recalculation therefore
uses the frozen v2 input even if a later draft or builder version changes.

## Candidate Match v1

Factors and fixed weights are Skills 30, Languages 15, Region 15, Workload 15,
Salary 10, Job type 5, Remote 5, and Availability 5. Codes are trimmed,
lowercased, and de-duplicated. Unknown factors have `null` score and their
weight is excluded from both numerator and denominator.

- Skills: candidate/unique-required intersection ratio.
- Languages: mean over unique requirements using
  `A1 < A2 < B1 < B2 < C1 < C2 < NATIVE`; met is 1, exactly one level below
  is 0.5, otherwise 0.
- Region: 1 when the job canton occurs in the explicit acceptable list, else 0.
- Workload: inclusive overlap
  `max(0,min(max)-max(min)+1)/(jobMax-jobMin+1)`.
- Salary: same explicit period only; overlap is 1, nearest gap no greater than
  10% of `max(1, desiredSalaryMin)` is 0.5, otherwise 0.
- Job type: 1 when the job type occurs in the explicit candidate list, else 0.
- Remote: `ANY` or exact is 1, hybrid versus either endpoint is 0.5, other
  mismatches are 0.
- Availability: on/before start is 1, 1–30 calendar days after is 0.5, later is
  0.

For non-negative values, half-up is exactly `Math.floor(x + 0.5)`.
`confidence = roundHalfUp(knownWeight)` and
`score = roundHalfUp(weightedSum / knownWeight * 100)`. With no known factor,
the score is `null` and confidence is 0. Reason codes follow factor order and
use `<FACTOR>_MATCH|PARTIAL|MISMATCH|MISSING`.

The input excludes name, age, gender, origin, health, family, photo, and other
protected or proxy-sensitive fields. Match v1 is candidate-facing and must not
drive employer ranking or an automated application transition.
