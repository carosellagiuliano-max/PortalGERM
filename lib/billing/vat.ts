export type VatComputation = Readonly<{
  net: number;
  vatAmount: number;
  total: number;
}>;

const BASIS_POINT_DENOMINATOR = 10_000n;
const HALF_BASIS_POINT_DENOMINATOR = 5_000n;

export function computeVat(
  netRappen: number,
  rateBasisPoints: number,
): VatComputation {
  assertNonNegativeSafeInteger(netRappen, "netRappen");
  assertNonNegativeSafeInteger(rateBasisPoints, "rateBasisPoints");
  if (rateBasisPoints > 10_000) {
    throw new TypeError("rateBasisPoints must not exceed 10000.");
  }

  const vatAmountBigInt =
    (BigInt(netRappen) * BigInt(rateBasisPoints) +
      HALF_BASIS_POINT_DENOMINATOR) /
    BASIS_POINT_DENOMINATOR;
  const totalBigInt = BigInt(netRappen) + vatAmountBigInt;
  if (
    vatAmountBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
    totalBigInt > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError("VAT result exceeds the safe integer range.");
  }

  return {
    net: netRappen,
    vatAmount: Number(vatAmountBigInt),
    total: Number(totalBigInt),
  };
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  }
}
