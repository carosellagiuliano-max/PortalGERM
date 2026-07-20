import { createSeededRandom, type SeededRandom } from "@/lib/utils/random";
import { SEED_DATASET_VERSION } from "@/prisma/seed/contract";

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

/** Returns an independent deterministic stream for one semantic seed block. */
export function createSeedRandom(scope: string): SeededRandom {
  if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) {
    throw new TypeError(
      "A seed random scope must be a stable lowercase semantic label.",
    );
  }
  return createSeededRandom(`${SEED_DATASET_VERSION}:${scope}`);
}

/** Fisher-Yates over a copy; the caller's fixture array is never mutated. */
export function deterministicShuffle<T>(
  values: readonly T[],
  random: SeededRandom,
): readonly T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random.integer(0, index);
    const current = shuffled[index] as T;
    shuffled[index] = shuffled[swapIndex] as T;
    shuffled[swapIndex] = current;
  }
  return Object.freeze(shuffled);
}

export function deterministicSample<T>(
  values: readonly T[],
  count: number,
  random: SeededRandom,
): readonly T[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > values.length) {
    throw new RangeError(
      "A deterministic sample count must be between zero and the input length.",
    );
  }
  return Object.freeze(deterministicShuffle(values, random).slice(0, count));
}

export function exactRange(count: number): readonly number[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
    throw new RangeError(
      "A seed range count must be a safe integer between 0 and 100000.",
    );
  }
  return Object.freeze(Array.from({ length: count }, (_, index) => index));
}

/**
 * Expands an exact integer distribution into a deterministic label sequence.
 * Useful for count-sensitive fixtures such as job statuses and languages.
 */
export function expandExactDistribution<T extends string>(
  distribution: Readonly<Record<T, number>>,
): readonly T[] {
  const entries = Object.entries(distribution) as Array<[T, number]>;
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const result: T[] = [];
  for (const [label, count] of entries) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
      throw new RangeError(
        `Seed distribution ${label} must be a safe integer between 0 and 100000.`,
      );
    }
    for (let index = 0; index < count; index += 1) {
      result.push(label);
    }
  }

  return Object.freeze(result);
}
