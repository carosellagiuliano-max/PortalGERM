import "server-only";

import { getDatabase } from "@/lib/db/client";

/**
 * Canonical Phase-03 Prisma singleton. The Next.js development hot-reload
 * guard lives in `client.ts`, so this entry point and legacy accessors always
 * resolve to the same connection pool.
 */
export const prisma = getDatabase();

export { getDatabase };
export type { DatabaseClient } from "@/lib/db/factory";
