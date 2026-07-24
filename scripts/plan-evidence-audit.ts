import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  dirname,
  extname,
  relative as relativePath,
  resolve,
} from "node:path";

const repository = process.cwd();
const planDirectory = resolve(repository, "codex-plan");
const masterPlanPath = resolve(planDirectory, "00-PLAN.md");
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;

const failures: string[] = [];
let checkedLinks = 0;
let checkedPhases = 0;

for (const path of markdownFiles(planDirectory)) {
  const source = readFileSync(path, "utf8");
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

if (failures.length > 0) {
  console.error(
    `Plan/evidence audit failed with ${failures.length} finding(s):\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.info(
    `Plan/evidence audit passed: ${checkedPhases} checked phases have linked records; ${checkedLinks} local Markdown links resolve.`,
  );
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
