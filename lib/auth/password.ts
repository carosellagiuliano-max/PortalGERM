import { compare, hash } from "bcryptjs";

/**
 * Benchmarked on the pinned Node 24 Windows implementation environment:
 * cost 10 ~=135ms, 11 ~=256ms, 12 ~=499ms (2026-07-19). Cost 12 is the
 * frozen v1 choice; revisit through a new policy version when hardware or the
 * implementation changes.
 */
export const PASSWORD_HASH_POLICY_V1 = Object.freeze({
  algorithm: "bcryptjs",
  algorithmVersion: 1,
  cost: 12,
  benchmarkTargetMilliseconds: Object.freeze({ minimum: 250, maximum: 1_500 }),
});

export interface PasswordHasher {
  hash(plainTextPassword: string): Promise<string>;
  verify(plainTextPassword: string, passwordHash: string): Promise<boolean>;
}

export function createBcryptPasswordHasher(
  cost: number = PASSWORD_HASH_POLICY_V1.cost,
): PasswordHasher {
  if (!Number.isInteger(cost) || cost < 10 || cost > 15) {
    throw new RangeError("bcrypt cost must be an integer from 10 to 15.");
  }

  return Object.freeze({
    hash: (plainTextPassword: string) => hash(plainTextPassword, cost),
    verify: async (plainTextPassword: string, passwordHash: string) => {
      if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
        return false;
      }
      return compare(plainTextPassword, passwordHash);
    },
  });
}

const defaultPasswordHasher = createBcryptPasswordHasher();

export function hashPassword(
  plainTextPassword: string,
  hasher: PasswordHasher = defaultPasswordHasher,
): Promise<string> {
  if (plainTextPassword.length === 0) {
    throw new TypeError("Password must not be empty.");
  }
  return hasher.hash(plainTextPassword);
}

export function verifyPassword(
  plainTextPassword: string,
  passwordHash: string,
  hasher: PasswordHasher = defaultPasswordHasher,
): Promise<boolean> {
  return hasher.verify(plainTextPassword, passwordHash);
}
