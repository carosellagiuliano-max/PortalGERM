/**
 * Rows installed by schema migrations are control-plane reference data, not
 * demo/domain seed data. Keep this contract exact so that a catalog change
 * requires an intentional release-gate update.
 */
export const MIGRATION_OWNED_DOMAIN_ROW_COUNTS = Object.freeze({
  AdminRole: 10,
  AdminRoleCapability: 58,
} as const);

export function assertFreshMigrationBaseline(
  counts: Readonly<Record<string, number>>,
): void {
  const mismatches: string[] = [];

  for (const [tableName, count] of Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const expected =
      MIGRATION_OWNED_DOMAIN_ROW_COUNTS[
        tableName as keyof typeof MIGRATION_OWNED_DOMAIN_ROW_COUNTS
      ] ?? 0;
    if (count !== expected) {
      mismatches.push(`${tableName}=${count} (expected ${expected})`);
    }
  }

  for (const [tableName, expected] of Object.entries(
    MIGRATION_OWNED_DOMAIN_ROW_COUNTS,
  )) {
    if (!(tableName in counts)) {
      mismatches.push(`${tableName}=missing (expected ${expected})`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Fresh Production-guard database differs from the migration-owned ` +
        `baseline: ${mismatches.join(", ")}.`,
    );
  }
}
