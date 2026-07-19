export const INVOICE_NUMBER_ADVISORY_LOCK_NAMESPACE = 1_398_032_386;
export const INVOICE_NUMBER_TIME_ZONE = "Europe/Zurich";

export type InvoiceNumberTransaction = Readonly<{
  /** Must execute pg_advisory_xact_lock(namespace, year). */
  acquireInvoiceYearAdvisoryLock(namespace: number, year: number): Promise<void>;
  /** Reads the largest already inserted/reserved sequence for the locked year. */
  findHighestInvoiceSequence(year: number): Promise<number | null>;
}>;

export type InvoiceNumberPort = Readonly<{
  transaction<TResult>(
    callback: (transaction: InvoiceNumberTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}>;

export type AllocatedInvoiceNumber<TResult> = Readonly<{
  number: string;
  value: TResult;
}>;

/**
 * Allocates and inserts/reserves an invoice number in one transaction callback.
 * The callback must persist the invoice or a unique reservation using the same
 * transaction object. Returning a number before that callback would make a
 * concurrent duplicate possible and is deliberately not supported.
 */
export async function allocateInvoiceNumber<TResult>(
  issuedAt: Date,
  port: InvoiceNumberPort,
  insertOrReserve: (
    transaction: InvoiceNumberTransaction,
    invoiceNumber: string,
  ) => Promise<TResult>,
): Promise<AllocatedInvoiceNumber<TResult>> {
  const year = getZurichYear(issuedAt);

  return port.transaction(async (transaction) => {
    await transaction.acquireInvoiceYearAdvisoryLock(
      INVOICE_NUMBER_ADVISORY_LOCK_NAMESPACE,
      year,
    );
    const previousSequence = await transaction.findHighestInvoiceSequence(year);
    if (
      previousSequence !== null &&
      (!Number.isSafeInteger(previousSequence) || previousSequence < 1)
    ) {
      throw new TypeError("The stored invoice sequence is invalid.");
    }

    const nextSequence = (previousSequence ?? 0) + 1;
    if (!Number.isSafeInteger(nextSequence)) {
      throw new RangeError("The invoice sequence exceeds the safe integer range.");
    }
    const invoiceNumber = formatInvoiceNumber(year, nextSequence);
    const value = await insertOrReserve(transaction, invoiceNumber);
    return { number: invoiceNumber, value };
  });
}

export function formatInvoiceNumber(year: number, sequence: number): string {
  if (
    !Number.isInteger(year) ||
    year < 1_000 ||
    year > 9_999 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    throw new TypeError("Invoice year and sequence are invalid.");
  }
  return `STH-${year}-${String(sequence).padStart(5, "0")}`;
}

export function parseInvoiceNumber(
  value: string,
): Readonly<{ year: number; sequence: number }> | null {
  const match = /^STH-([0-9]{4})-([0-9]{5,})$/u.exec(value);
  if (match === null) {
    return null;
  }
  const yearText = match[1];
  const sequenceText = match[2];
  if (yearText === undefined || sequenceText === undefined) {
    return null;
  }
  const year = Number(yearText);
  const sequence = Number(sequenceText);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    return null;
  }
  return formatInvoiceNumber(year, sequence) === value
    ? { year, sequence }
    : null;
}

export function getZurichYear(instant: Date): number {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new TypeError("A valid invoice instant is required.");
  }
  const year = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: INVOICE_NUMBER_TIME_ZONE,
      year: "numeric",
    }).format(instant),
  );
  if (!Number.isInteger(year) || year < 1_000 || year > 9_999) {
    throw new RangeError("The Zurich invoice year is outside YYYY range.");
  }
  return year;
}
