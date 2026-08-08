import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repository = process.cwd();
const cli = resolve(repository, "node_modules", "tsx", "dist", "cli.mjs");
const auditScript = resolve(repository, "scripts", "plan-evidence-audit.ts");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("plan evidence audit CLI integrity gate", () => {
  it("passes a minimal structurally valid plan tree", () => {
    const root = fixture(
      ["# Plan", "", "| ID | Status |", "| --- | --- |", "| AC-1 | OPEN |"].join("\n"),
    );

    const result = runAudit(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Plan/evidence audit passed");
  });

  it("fails through the real CLI for truncation and table corruption", () => {
    const root = fixture(
      [
        "# Plan",
        "",
        "| ID | Status |",
        "| --- | --- |",
        "| AC-1 | …7440 tokens truncated… | unexpected |",
      ].join("\n"),
    );

    const result = runAudit(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TRUNCATION_MARKER");
    expect(result.stderr).toContain("MALFORMED_MARKDOWN_TABLE");
  });
});

function fixture(masterPlan: string) {
  const root = mkdtempSync(resolve(tmpdir(), "sth-plan-audit-"));
  temporaryRoots.push(root);
  const plan = resolve(root, "codex-plan");
  mkdirSync(plan);
  writeFileSync(resolve(plan, "00-PLAN.md"), `${masterPlan}\n`, "utf8");
  return root;
}

function runAudit(root: string) {
  return spawnSync(process.execPath, [cli, auditScript], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30_000,
  });
}
