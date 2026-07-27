import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS_V1 } from "@/lib/domains/audit/audit-actions";

const ACTION_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function readRepositoryFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function extractPrismaAuditActions(schema: string) {
  const enumBlock = schema.match(/enum AuditAction\s*\{([\s\S]*?)\}/)?.[1];

  if (!enumBlock) {
    throw new Error("Prisma enum AuditAction was not found");
  }

  return enumBlock
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((action): action is string => ACTION_PATTERN.test(action ?? ""));
}

function extractMatrixAuditActions(plan: string) {
  const matrixBlock = plan.match(
    /### Audit-log coverage matrix([\s\S]*?)(?=\r?\n### )/,
  )?.[1];

  if (!matrixBlock) {
    throw new Error("Phase 16 audit-log coverage matrix was not found");
  }

  const actions = matrixBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => {
      const actionCell = line.split("|")[1] ?? "";

      return Array.from(
        actionCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g),
        (match) => match[1],
      );
    });

  return [...new Set(actions)];
}

function extractPhase22AuditActions(plan: string) {
  const matrixBlock = plan.match(
    /### Phase-22 Audit-log extension matrix([\s\S]*?)(?=\r?\n## )/,
  )?.[1];

  if (!matrixBlock) {
    throw new Error("Phase 22 audit-log extension matrix was not found");
  }

  return [
    ...new Set(
      matrixBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith("| `"))
        .flatMap((line) => {
          const actionCell = line.split("|")[1] ?? "";

          return Array.from(
            actionCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g),
            (match) => match[1],
          );
        }),
    ),
  ];
}

function extractPhase24AuditActions(plan: string) {
  const matrixBlock = plan.match(
    /### Phase-24 Audit-log extension matrix([\s\S]*?)(?=\r?\n## )/,
  )?.[1];

  if (!matrixBlock) {
    throw new Error("Phase 24 audit-log extension matrix was not found");
  }

  return [
    ...new Set(
      matrixBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith("| `"))
        .flatMap((line) => {
          const actionCell = line.split("|")[1] ?? "";

          return Array.from(
            actionCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g),
            (match) => match[1],
          );
        }),
    ),
  ];
}

describe("AUDIT_ACTIONS_V1 contract", () => {
  it("keeps the typed constant, Prisma enum and immutable plus remediation matrices synchronized", () => {
    const constantActions = [...AUDIT_ACTIONS_V1];
    const prismaActions = extractPrismaAuditActions(
      readRepositoryFile("prisma/schema.prisma"),
    );
    const matrixActions = [
      ...extractMatrixAuditActions(
        readRepositoryFile("codex-plan/16-security-hardening.md"),
      ),
      ...extractPhase22AuditActions(
        readRepositoryFile("codex-plan/22-privacy-legal-analytics.md"),
      ),
      ...extractPhase24AuditActions(
        readRepositoryFile("codex-plan/24-real-billing-finance.md"),
      ),
    ];

    expect(new Set(constantActions).size).toBe(constantActions.length);
    expect(new Set(prismaActions).size).toBe(prismaActions.length);
    expect(prismaActions).toEqual(constantActions);
    expect(new Set(matrixActions).size).toBe(matrixActions.length);
    expect([...matrixActions].sort()).toEqual([...constantActions].sort());
  });
});
