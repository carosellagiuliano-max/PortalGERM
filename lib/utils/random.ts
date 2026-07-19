export interface SeededRandom {
  next(): number;
  integer(minInclusive: number, maxInclusive: number): number;
  pick<T>(values: readonly T[]): T;
}

function seedToUint32(seed: string | number): number {
  if (typeof seed === "number") {
    if (!Number.isSafeInteger(seed)) {
      throw new TypeError("A numeric random seed must be a safe integer.");
    }
    return seed >>> 0;
  }

  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG for fixtures/seeds; never use it for secrets. */
export function createSeededRandom(seed: string | number): SeededRandom {
  let state = seedToUint32(seed);

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return Object.freeze({
    next,
    integer(minInclusive: number, maxInclusive: number) {
      if (
        !Number.isSafeInteger(minInclusive) ||
        !Number.isSafeInteger(maxInclusive) ||
        minInclusive > maxInclusive
      ) {
        throw new RangeError("Random integer bounds must be ordered safe integers.");
      }
      return Math.floor(next() * (maxInclusive - minInclusive + 1)) + minInclusive;
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) {
        throw new RangeError("Cannot pick from an empty collection.");
      }
      return values[Math.floor(next() * values.length)] as T;
    },
  });
}
