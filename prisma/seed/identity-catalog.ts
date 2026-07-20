import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import { assertSeedIdentityIntegrity } from "@/prisma/seed/ids";

/**
 * A cross-domain identity (for example candidate@demo.ch) may be referenced by
 * more than one pure fixture block. Exact duplicates collapse into one contract
 * identity; any semantic or UUID disagreement still fails closed.
 */
export function mergeSeedIdentitySets(
  ...sets: readonly (readonly SeedIdentityRecord[])[]
): readonly SeedIdentityRecord[] {
  const unique = new Map<string, SeedIdentityRecord>();

  for (const set of sets) {
    for (const record of assertSeedIdentityIntegrity(set)) {
      const semanticKey = `${record.entity}\u0000${record.naturalKey}`;
      const existing = unique.get(semanticKey);
      if (existing !== undefined) {
        if (existing.id !== record.id) {
          // Let the central integrity checker produce the stable drift error.
          return assertSeedIdentityIntegrity([...unique.values(), record]);
        }
        continue;
      }
      unique.set(semanticKey, record);
    }
  }

  return assertSeedIdentityIntegrity([...unique.values()]);
}
