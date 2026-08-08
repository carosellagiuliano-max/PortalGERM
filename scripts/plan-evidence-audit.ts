import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, relative as relativePath, resolve } from "node:path";
import { inspectPlanDocumentIntegrity } from "../lib/governance/plan-document-integrity";

const repository = process.cwd();
const planDirectory = resolve(repository, "codex-plan");
const masterPlanPath = resolve(planDirectory, "00-PLAN.md");
const phase34PlanPath = resolve(
  planDirectory,
  "34-verified-findings-production-hardening.md",
);
const phase34MigrationBaselinePath = resolve(
  planDirectory,
  "evidence",
  "phase34-migration-baseline.json",
);
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
const checkedChecklistPattern = /^\s*[-*]\s+\[[xX]\]\s+/gmu;
const evidenceLinkPattern =
  /!?\[[^\]]*\]\((?<target>[^)#]*evidence\/[^)#]+\.md)(?:#[^)]*)?\)/giu;

const failures: string[] = [];
let checkedLinks = 0;
let checkedPhases = 0;
let checkedChecklistFiles = 0;
let checkedChecklistItems = 0;
let checkedMigrationBaselineFiles = 0;

for (const path of markdownFiles(planDirectory)) {
  const source = readFileSync(path, "utf8");
  for (const finding of inspectPlanDocumentIntegrity(source)) {
    failures.push(
      `${relative(path)}:${finding.line} ${finding.message} [${finding.code}].`,
    );
  }
  const checkedItems = [...source.matchAll(checkedChecklistPattern)].length;
  if (checkedItems > 0) {
    checkedChecklistFiles += 1;
    checkedChecklistItems += checkedItems;
    const evidenceTargets = [...source.matchAll(evidenceLinkPattern)]
      .map((match) => match.groups?.target)
      .filter((target): target is string => target !== undefined);
    if (evidenceTargets.length === 0) {
      failures.push(
        `${relative(path)} contains ${checkedItems} checked checklist item(s) without a linked evidence record.`,
      );
    } else if (
      !evidenceTargets.some((target) => {
        const resolved = resolve(dirname(path), decodeURIComponent(target));
        return existsSync(resolved) && statSync(resolved).isFile();
      })
    ) {
      failures.push(
        `${relative(path)} contains checked checklist items, but none of its evidence links resolves to a file.`,
      );
    }
  }
  for (const match of source.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1]?.trim();
    if (
      rawTarget === undefined ||
      rawTarget === "" ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)
    ) {
      continue;
    }
    const encodedTarget = rawTarget.split("#", 1)[0] as string;
    let targetWithoutAnchor: string;
    try {
      targetWithoutAnchor = decodeURIComponent(encodedTarget);
    } catch {
      failures.push(
        `${relative(path)} contains an invalid percent-encoded link target.`,
      );
      continue;
    }
    if (targetWithoutAnchor === "") continue;
    checkedLinks += 1;
    const target = resolve(dirname(path), targetWithoutAnchor);
    if (!existsSync(target)) {
      failures.push(
        `${relative(path)} links to missing ${targetWithoutAnchor}.`,
      );
    }
  }
}

const masterPlan = readFileSync(masterPlanPath, "utf8");
const phasePattern =
  /^### \[x\] (?<phase>\d{2})[^\n]*\n\n(?<body>[\s\S]*?)(?=^### |^## )/gmu;
for (const match of masterPlan.matchAll(phasePattern)) {
  const phase = match.groups?.phase;
  const body = match.groups?.body ?? "";
  if (phase === undefined) continue;
  checkedPhases += 1;

  const detailMatch = body.match(/\]\(\.\/(?<path>\d{2}-[^)]+\.md)\)/u);
  if (detailMatch?.groups?.path === undefined) {
    failures.push(`Checked phase ${phase} has no detail-plan link.`);
    continue;
  }
  const detailPath = resolve(planDirectory, detailMatch.groups.path);
  if (!existsSync(detailPath)) {
    failures.push(`Checked phase ${phase} detail plan is missing.`);
    continue;
  }
  const detail = readFileSync(detailPath, "utf8");
  const evidencePattern = new RegExp(
    String.raw`\.\/evidence\/[^)\s]*phase-${phase}(?:[^)\s]*)?\.md`,
    "iu",
  );
  const evidenceMatch = detail.match(evidencePattern);
  if (evidenceMatch === null) {
    failures.push(`Checked phase ${phase} has no linked evidence record.`);
    continue;
  }
  const evidencePath = resolve(planDirectory, evidenceMatch[0]);
  if (!existsSync(evidencePath) || !statSync(evidencePath).isFile()) {
    failures.push(`Checked phase ${phase} evidence record is missing.`);
  }
}

if (existsSync(phase34PlanPath)) {
  if (!existsSync(phase34MigrationBaselinePath)) {
    failures.push(
      "Phase 34 declares an immutable migration baseline, but codex-plan/evidence/phase34-migration-baseline.json is missing.",
    );
  } else {
    try {
      checkedMigrationBaselineFiles = verifyPhase34MigrationBaseline(
        phase34MigrationBaselinePath,
      );
    } catch (error) {
      failures.push(
        `Phase 34 migration baseline verification failed: ${safeError(error)}.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Plan/evidence audit failed with ${failures.length} finding(s):\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.info(
    `Plan/evidence audit passed: ${checkedPhases} checked phases and ${checkedChecklistItems} checked items across ${checkedChecklistFiles} files have linked records; ${checkedLinks} local Markdown links resolve; ${checkedMigrationBaselineFiles} Phase-34 baseline migration files are byte-identical.`,
  );
}

type Phase34MigrationBaseline = Readonly<{
  schema: "phase34-migration-baseline-v1";
  capturedAt: string;
  baselineCommit: string;
  baselineTree: string;
  historicalCount: number;
  totalCount: number;
  migrations: Readonly<Record<string, string>>;
}>;

function verifyPhase34MigrationBaseline(path: string) {
  const baseline = parsePhase34MigrationBaseline(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  const commitTree = git(
    "rev-parse",
    `${baseline.baselineCommit}^{tree}`,
  ).trim();
  if (commitTree !== baseline.baselineTree) {
    throw new Error("BASELINE_TREE_DOES_NOT_MATCH_COMMIT");
  }

  const prefix = "prisma/migrations/";
  const anchoredPaths = git(
    "ls-tree",
    "-r",
    "--name-only",
    baseline.baselineCommit,
    "--",
    "prisma/migrations",
  )
    .split(/\r?\n/u)
    .filter((entry) =>
      /^prisma\/migrations\/[^/]+\/migration\.sql$/u.test(entry),
    )
    .map((entry) => entry.slice(prefix.length))
    .sort((left, right) => left.localeCompare(right, "en"));
  const declaredPaths = Object.keys(baseline.migrations).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (
    baseline.totalCount !== declaredPaths.length ||
    baseline.historicalCount > baseline.totalCount ||
    JSON.stringify(anchoredPaths) !== JSON.stringify(declaredPaths)
  ) {
    throw new Error("BASELINE_INVENTORY_DOES_NOT_MATCH_GIT");
  }

  for (const migrationPath of declaredPaths) {
    const declaredDigest = baseline.migrations[migrationPath];
    const anchoredDigest = digest(
      gitBuffer("show", `${baseline.baselineCommit}:${prefix}${migrationPath}`),
    );
    if (declaredDigest !== anchoredDigest) {
      throw new Error(`BASELINE_DIGEST_DOES_NOT_MATCH_GIT:${migrationPath}`);
    }
    const currentPath = resolve(repository, prefix, migrationPath);
    if (
      !existsSync(currentPath) ||
      digest(readFileSync(currentPath)) !== anchoredDigest
    ) {
      throw new Error(`HISTORICAL_MIGRATION_CHANGED:${migrationPath}`);
    }
  }
  return declaredPaths.length;
}

function parsePhase34MigrationBaseline(
  value: unknown,
): Phase34MigrationBaseline {
  if (typeof value !== "object" || value === null) {
    throw new Error("BASELINE_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schema !== "phase34-migration-baseline-v1" ||
    typeof candidate.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.capturedAt)) ||
    typeof candidate.baselineCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(candidate.baselineCommit) ||
    typeof candidate.baselineTree !== "string" ||
    !/^[a-f0-9]{40}$/u.test(candidate.baselineTree) ||
    !Number.isInteger(candidate.historicalCount) ||
    (candidate.historicalCount as number) < 0 ||
    !Number.isInteger(candidate.totalCount) ||
    (candidate.totalCount as number) < 1 ||
    typeof candidate.migrations !== "object" ||
    candidate.migrations === null ||
    !Object.entries(candidate.migrations).every(
      ([migrationPath, migrationDigest]) =>
        /^[^/]+\/migration\.sql$/u.test(migrationPath) &&
        typeof migrationDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(migrationDigest),
    )
  ) {
    throw new Error("BASELINE_INVALID");
  }
  return candidate as Phase34MigrationBaseline;
}

function git(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function gitBuffer(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

function digest(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && extname(entry.name).toLowerCase() === ".md"
      ? [path]
      : [];
  });
}

function relative(path: string) {
  return relativePath(repository, path).replaceAll("\\", "/");
}
