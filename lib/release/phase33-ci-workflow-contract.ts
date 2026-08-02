import { PHASE33_TEST_COMMAND_IDS } from "@/lib/release/phase33-test-report-contract";
import { phase33TestReportSchema } from "@/lib/release/phase33-test-report-contract";

export const PHASE33_CI_WORKFLOW_PATH =
  ".github/workflows/phase33-g4.yml" as const;

export const PHASE33_CI_PINNED_ACTIONS = Object.freeze([
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
  "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
] as const);

const REPORT_PATH = "test-results/phase33/test-report.json";
const RECOVERY_PATH = "test-results/phase33/recovery-manifest.json";
const COMMAND_LOG_GLOB = "test-results/phase33/logs/*.log";
const MANIFEST_PATHS = Object.freeze([
  "test-results/phase33/technical-manifest-lc4.json",
  "test-results/phase33/technical-manifest-lc5.json",
] as const);
const VERDICT_PATHS = Object.freeze([
  "test-results/phase33/release-verdict-lc4.json",
  "test-results/phase33/release-verdict-lc5.json",
] as const);

export function inspectPhase33CiWorkflow(source: string) {
  const issues: string[] = [];
  const requireText = (identity: string, value: string) => {
    if (!source.includes(value)) issues.push(`MISSING:${identity}`);
  };

  requireText("PUSH_MAIN", "push:\n    branches: [main]");
  requireText("PULL_REQUEST", "pull_request:");
  requireText("WORKFLOW_DISPATCH", "workflow_dispatch:");
  requireText("READ_ONLY_PERMISSIONS", "permissions:\n  contents: read");
  requireText(
    "CONCURRENCY",
    "group: phase33-g4-${{ github.workflow }}-${{ github.ref }}",
  );
  requireText("CONCURRENCY_CANCEL", "cancel-in-progress: true");
  requireText("PINNED_RUNNER", "runs-on: ubuntu-24.04");
  requireText("BOUNDED_JOB", "timeout-minutes: 360");
  requireText("NODE_PIN", "node-version: 24.18.0");
  requireText("NPM_PIN", "npm install --global npm@11.16.0");
  requireText("NPM_CACHE", "cache: npm");
  requireText("LOCKFILE_CACHE_KEY", "cache-dependency-path: package-lock.json");
  requireText("NO_PUSH_CREDENTIAL", "persist-credentials: false");
  requireText("REPRODUCIBLE_INSTALL", "run: npm ci");
  requireText("DOCKER_ENGINE", "docker version");
  requireText("DOCKER_COMPOSE", "docker compose version");
  requireText(
    "THREE_BROWSERS",
    "chromium firefox webkit",
  );
  requireText("FULL_G4", "run: npm run test:phase33");
  requireText("REPORT_REFERENCE", "phase33:ci:report-reference");
  requireText("DYNAMIC_OCI_REFERENCE", "steps.phase33-report.outputs.oci_image_reference");
  requireText("LC4_MANIFEST", "--target=LC4");
  requireText("LC5_MANIFEST", "--target=LC5");
  requireText("TECHNICAL_VERDICT", "phase33:release:technical");
  requireText("ACTIVATION_BLOCKED", "phase33:release:activation");
  requireText("ACTIVATION_EXIT_2", '"${activation_status}" -ne 2');
  requireText("FINAL_EVIDENCE_VERIFY", "phase33:ci:evidence-verify");
  requireText("BOUNDED_COMMAND_LOG_UPLOAD", COMMAND_LOG_GLOB);

  if (PHASE33_TEST_COMMAND_IDS.length !== 38) {
    issues.push("COMMAND_SET_NOT_38");
  }
  if (occurrences(source, "npm run test:phase33") !== 1) {
    issues.push("FULL_G4_COMMAND_NOT_EXACTLY_ONCE");
  }
  for (const path of [
    REPORT_PATH,
    RECOVERY_PATH,
    ...MANIFEST_PATHS,
    ...VERDICT_PATHS,
  ]) {
    if (!source.includes(path)) issues.push(`EVIDENCE_PATH_MISSING:${path}`);
  }
  for (const target of ["lc4", "lc5"] as const) {
    if (
      !source.includes(
        `--output=test-results/phase33/technical-manifest-${target}.json`,
      ) ||
      !source.includes(
        `--output=test-results/phase33/release-verdict-${target}.json`,
      )
    ) {
      issues.push(`TARGET_OUTPUT_INVALID:${target}`);
    }
  }

  const actions = [...source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map(
    (match) => match[1] ?? "",
  );
  if (
    actions.length !== PHASE33_CI_PINNED_ACTIONS.length ||
    actions.some((action) => !PHASE33_CI_PINNED_ACTIONS.includes(
      action as (typeof PHASE33_CI_PINNED_ACTIONS)[number],
    )) ||
    actions.some((action) => !/@[a-f0-9]{40}$/u.test(action))
  ) {
    issues.push("ACTION_PIN_SET_INVALID");
  }

  const gateIndex = source.indexOf("run: npm run test:phase33");
  const manifestIndex = source.indexOf("npm run phase33:manifest");
  const verdictIndex = source.indexOf("npm run phase33:release:technical");
  const verifyIndex = source.indexOf("phase33:ci:evidence-verify");
  const uploadIndex = source.indexOf("actions/upload-artifact@");
  if (
    !(
      gateIndex >= 0 &&
      manifestIndex > gateIndex &&
      verdictIndex > manifestIndex &&
      verifyIndex > verdictIndex &&
      uploadIndex > verifyIndex
    )
  ) {
    issues.push("FAIL_CLOSED_STEP_ORDER_INVALID");
  }

  if (
    /\bsecrets\s*\./u.test(source) ||
    /permissions:[\s\S]*?\b(?:write|id-token)\b/iu.test(source) ||
    /environment:\s*production/iu.test(source) ||
    /(?:vercel|supabase|kubectl|helm|terraform|aws-actions|azure\/|google-github-actions)/iu.test(
      source,
    ) ||
    /GO_LIVE|GO-LIVE/iu.test(source)
  ) {
    issues.push("PRODUCTION_AUTHORITY_OR_EFFECT_FORBIDDEN");
  }
  if (
    /if:\s*\$\{\{\s*always\(\)\s*\}\}/u.test(source) ||
    source.includes("test-results/phase33/logs/**") ||
    /^\s+test-results\/phase33\/$/mu.test(source)
  ) {
    issues.push("PREPASS_OR_UNBOUNDED_UPLOAD_FORBIDDEN");
  }

  return Object.freeze({
    issues: Object.freeze([...new Set(issues)].sort()),
    status: issues.length === 0 ? ("PASS" as const) : ("FAIL" as const),
  });
}

export function phase33CiImageReference(
  rawReport: unknown,
  candidateCommitSha: string,
) {
  const parsed = phase33TestReportSchema.safeParse(rawReport);
  if (!parsed.success) throw new Error("PHASE33_CI_TEST_REPORT_INVALID");
  if (parsed.data.candidateCommitSha !== candidateCommitSha) {
    throw new Error("PHASE33_CI_TEST_REPORT_CANDIDATE_MISMATCH");
  }
  const reference = parsed.data.artifacts.ociImage.reference;
  if (!/^[a-z0-9][a-z0-9._/-]{1,220}:[a-z0-9][a-z0-9._-]{0,63}$/u.test(reference)) {
    throw new Error("PHASE33_CI_OCI_REFERENCE_UNSAFE");
  }
  return reference;
}

function occurrences(source: string, value: string) {
  return source.split(value).length - 1;
}
