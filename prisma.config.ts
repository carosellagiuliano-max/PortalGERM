import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

const localEnvironment = resolve(process.cwd(), ".env.local");
if (existsSync(localEnvironment)) {
  config({ path: localEnvironment, override: false, quiet: true });
}

config({ override: false, quiet: true });

// Generate/validate do not connect to PostgreSQL. Database-touching npm scripts
// run env:validate first, so this non-routable fallback can never become a
// silent local migration target.
const generateOnlyUrl =
  "postgresql://phase01:phase01@127.0.0.1:65535/phase01_generate_only";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? generateOnlyUrl,
  },
});
