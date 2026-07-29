const LOCAL_DATE_TIME =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})$/u;

export type LocalDateTimeResolution =
  | Readonly<{ ok: true; instant: Date }>
  | Readonly<{
      ok: false;
      code: "INVALID_INPUT" | "INVALID_TIME_ZONE" | "NONEXISTENT_LOCAL_TIME" | "AMBIGUOUS_LOCAL_TIME";
    }>;

export function isIanaTimeZone(value: string): boolean {
  if (
    value.length < 3 ||
    value.length > 64 ||
    !/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/u.test(value)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a wall-clock value without trusting the server's local timezone.
 * Gaps and repeated DST hours are rejected instead of silently moving the
 * appointment or guessing which instant the user intended.
 */
export function resolveLocalDateTime(
  value: string,
  timeZone: string,
): LocalDateTimeResolution {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match?.groups === undefined) return failure("INVALID_INPUT");
  if (!isIanaTimeZone(timeZone)) return failure("INVALID_TIME_ZONE");
  const parts = {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
  };
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const canonical = new Date(naiveUtc);
  if (
    canonical.getUTCFullYear() !== parts.year ||
    canonical.getUTCMonth() + 1 !== parts.month ||
    canonical.getUTCDate() !== parts.day ||
    canonical.getUTCHours() !== parts.hour ||
    canonical.getUTCMinutes() !== parts.minute
  ) {
    return failure("INVALID_INPUT");
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matches: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(naiveUtc - offsetMinutes * 60_000);
    if (sameWallClock(formatter, candidate, parts)) matches.push(candidate);
  }
  const unique = [
    ...new Map(matches.map((candidate) => [candidate.getTime(), candidate])).values(),
  ];
  if (unique.length === 0) return failure("NONEXISTENT_LOCAL_TIME");
  if (unique.length > 1) return failure("AMBIGUOUS_LOCAL_TIME");
  return Object.freeze({ ok: true, instant: unique[0]! });
}

export function formatInTimeZone(
  instant: Date,
  timeZone: string,
  locale = "de-CH",
): string {
  if (!Number.isFinite(instant.getTime()) || !isIanaTimeZone(timeZone)) {
    throw new TypeError("A valid instant and IANA timezone are required.");
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

function sameWallClock(
  formatter: Intl.DateTimeFormat,
  candidate: Date,
  expected: Readonly<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  }>,
) {
  const values = Object.fromEntries(
    formatter
      .formatToParts(candidate)
      .filter(({ type }) =>
        ["year", "month", "day", "hour", "minute"].includes(type),
      )
      .map(({ type, value }) => [type, Number(value)]),
  );
  return (
    values.year === expected.year &&
    values.month === expected.month &&
    values.day === expected.day &&
    values.hour === expected.hour &&
    values.minute === expected.minute
  );
}

function failure(
  code: Exclude<LocalDateTimeResolution, { ok: true }>["code"],
): LocalDateTimeResolution {
  return Object.freeze({ ok: false, code });
}
