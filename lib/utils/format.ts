const CHF_FORMATTER = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Zurich",
});

const INTEGER_FORMATTER = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 0,
});

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

export function formatChf(amountChf: number): string {
  assertFinite(amountChf, "amountChf");
  return CHF_FORMATTER.format(amountChf);
}

export function formatWorkload(minPercent: number, maxPercent: number): string {
  if (
    !Number.isInteger(minPercent) ||
    !Number.isInteger(maxPercent) ||
    minPercent < 0 ||
    minPercent > maxPercent ||
    maxPercent > 100
  ) {
    throw new RangeError("Workload must be an ordered integer range from 0 to 100.");
  }

  return minPercent === maxPercent
    ? `${minPercent}%`
    : `${minPercent}%–${maxPercent}%`;
}

export function formatSalaryRange(
  minChf: number,
  maxChf: number,
  periodLabel?: string,
): string {
  if (
    !Number.isInteger(minChf) ||
    !Number.isInteger(maxChf) ||
    minChf <= 0 ||
    minChf > maxChf
  ) {
    throw new RangeError("Salary must be a positive ordered whole-CHF range.");
  }

  const range =
    minChf === maxChf
      ? `CHF ${INTEGER_FORMATTER.format(minChf)}`
      : `CHF ${INTEGER_FORMATTER.format(minChf)}–${INTEGER_FORMATTER.format(maxChf)}`;
  const normalizedPeriod = periodLabel?.trim();
  return normalizedPeriod ? `${range} / ${normalizedPeriod}` : range;
}

export function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Date must be valid.");
  }
  return DATE_FORMATTER.format(value);
}
