import { z } from "zod";

export const PHASE32_FINDING_IDS = Object.freeze(
  Array.from(
    { length: 37 },
    (_, index) => `STH-${String(index + 1).padStart(3, "0")}`,
  ),
) as readonly string[];

export const PHASE32_FINDING_STATUSES = Object.freeze([
  "CLOSED",
  "DISABLED",
  "EXTERNAL",
  "DEFERRED_MONITORED",
] as const);

const LC1_PRIORITY_BY_FINDING = Object.freeze({
  "STH-001": "P2",
  "STH-002": "P2",
  "STH-003": "P2",
  "STH-004": "P3",
  "STH-005": "P4",
  "STH-006": "P3",
  "STH-007": "P3",
  "STH-008": "P3",
  "STH-009": "P3",
  "STH-010": "P3",
  "STH-011": "P3",
  "STH-012": "P4",
  "STH-013": "P3",
  "STH-014": "P3",
  "STH-015": "P4",
  "STH-016": "P4",
  "STH-017": "P3",
  "STH-018": "P4",
  "STH-019": "P2",
  "STH-020": "P4",
  "STH-021": "P4",
  "STH-022": "P4",
  "STH-023": "P2",
  "STH-024": "P1",
  "STH-025": "P3",
  "STH-026": "P3",
  "STH-027": "P4",
  "STH-028": "P0",
  "STH-029": "P0",
  "STH-030": "P2",
  "STH-031": "P2",
  "STH-032": "P3",
  "STH-033": "P3",
  "STH-034": "P3",
  "STH-035": "P2",
  "STH-036": "P2",
  "STH-037": "P3",
} as const);

const LC1_STATUS_BY_FINDING = Object.freeze({
  "STH-001": "CLOSED",
  "STH-002": "CLOSED",
  "STH-003": "CLOSED",
  "STH-004": "EXTERNAL",
  "STH-005": "DISABLED",
  "STH-006": "CLOSED",
  "STH-007": "EXTERNAL",
  "STH-008": "EXTERNAL",
  "STH-009": "DISABLED",
  "STH-010": "CLOSED",
  "STH-011": "DISABLED",
  "STH-012": "DISABLED",
  "STH-013": "DISABLED",
  "STH-014": "DISABLED",
  "STH-015": "DISABLED",
  "STH-016": "DISABLED",
  "STH-017": "DISABLED",
  "STH-018": "EXTERNAL",
  "STH-019": "CLOSED",
  "STH-020": "DEFERRED_MONITORED",
  "STH-021": "CLOSED",
  "STH-022": "DISABLED",
  "STH-023": "EXTERNAL",
  "STH-024": "CLOSED",
  "STH-025": "CLOSED",
  "STH-026": "CLOSED",
  "STH-027": "DEFERRED_MONITORED",
  "STH-028": "CLOSED",
  "STH-029": "CLOSED",
  "STH-030": "DISABLED",
  "STH-031": "CLOSED",
  "STH-032": "CLOSED",
  "STH-033": "EXTERNAL",
  "STH-034": "EXTERNAL",
  "STH-035": "DISABLED",
  "STH-036": "DISABLED",
  "STH-037": "EXTERNAL",
} as const);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "must be a real ISO calendar date",
  });

const boundedTextSchema = z.string().trim().min(3).max(500);
const ownerRoleSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,79}$/u, "must be a stable role identifier");
const evidenceAliasSchema = z
  .string()
  .regex(
    /^phase32\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u,
    "must be a Phase-32 evidence alias",
  );
const sourceEvidenceSchema = z
  .string()
  .regex(
    /^(?:codex-plan|lib|tests|app|components|scripts|prisma)\/[A-Za-z0-9_.@/()[\]-]+$/u,
    "must be a repository-relative evidence path",
  );

const baseFindingShape = {
  id: z.enum(PHASE32_FINDING_IDS as [string, ...string[]]),
  ownerRole: ownerRoleSchema,
  priority: z.enum(["P0", "P1", "P2", "P3", "P4"]),
  scope: boundedTextSchema,
  sourceEvidence: z.array(sourceEvidenceSchema).min(1).max(12),
};

const closedFindingSchema = z.strictObject({
  ...baseFindingShape,
  status: z.literal("CLOSED"),
  candidateEvidenceAliases: z.array(evidenceAliasSchema).min(1).max(12),
});

const serverGateSchema = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
  expectedValue: z.string().trim().min(1).max(80),
});

const disabledFindingSchema = z.strictObject({
  ...baseFindingShape,
  status: z.literal("DISABLED"),
  disablement: z.strictObject({
    serverGates: z.array(serverGateSchema).min(1).max(16),
    negativeEvidenceAlias: evidenceAliasSchema,
  }),
});

const externalFindingSchema = z.strictObject({
  ...baseFindingShape,
  status: z.literal("EXTERNAL"),
  externalGate: z.strictObject({
    ownerRole: ownerRoleSchema,
    scope: boundedTextSchema,
    reviewAt: isoDateSchema,
    sourceDocument: sourceEvidenceSchema,
    safeDeactivationEvidenceAlias: evidenceAliasSchema,
  }),
});

const metricValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().trim().min(1).max(120),
]);

const monitoredFindingSchema = z.strictObject({
  ...baseFindingShape,
  status: z.literal("DEFERRED_MONITORED"),
  monitoring: z.strictObject({
    currentMetrics: z
      .array(
        z.strictObject({
          name: z.string().regex(/^[a-z][A-Za-z0-9]{2,79}$/u),
          value: metricValueSchema,
          unit: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/u),
          measuredAt: isoDateSchema,
        }),
      )
      .min(1)
      .max(12),
    trigger: boundedTextSchema,
    alertOwnerRole: ownerRoleSchema,
    reviewAt: isoDateSchema,
    monitoringEvidenceAlias: evidenceAliasSchema,
  }),
});

export const phase32FindingRecordSchema = z.discriminatedUnion("status", [
  closedFindingSchema,
  disabledFindingSchema,
  externalFindingSchema,
  monitoredFindingSchema,
]);

const statusCounts = Object.freeze({
  CLOSED: 14,
  DISABLED: 13,
  EXTERNAL: 8,
  DEFERRED_MONITORED: 2,
} satisfies Record<(typeof PHASE32_FINDING_STATUSES)[number], number>);

export const phase32FindingsLedgerSchema = z
  .strictObject({
    schemaVersion: z.literal("PHASE32_LC1_FINDINGS_LEDGER_V1"),
    targetLaunchClass: z.literal("LC1"),
    auditDate: isoDateSchema,
    records: z.array(phase32FindingRecordSchema).length(37),
  })
  .superRefine((ledger, context) => {
    const ids = ledger.records.map((record) => record.id);
    const seenIds = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seenIds.has(id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate finding id: ${id}`,
          path: ["records", index, "id"],
        });
      }
      seenIds.add(id);
    }

    for (const expectedId of PHASE32_FINDING_IDS) {
      if (!seenIds.has(expectedId)) {
        context.addIssue({
          code: "custom",
          message: `missing finding id: ${expectedId}`,
          path: ["records"],
        });
      }
    }

    const observedStatusCounts = Object.fromEntries(
      PHASE32_FINDING_STATUSES.map((status) => [status, 0]),
    ) as Record<(typeof PHASE32_FINDING_STATUSES)[number], number>;
    const evidenceAliases = new Map<string, string>();

    function registerAlias(
      alias: string,
      findingId: string,
      path: PropertyKey[],
    ) {
      const firstFindingId = evidenceAliases.get(alias);
      if (firstFindingId !== undefined) {
        context.addIssue({
          code: "custom",
          message: `evidence alias ${alias} is already bound to ${firstFindingId}`,
          path,
        });
        return;
      }
      evidenceAliases.set(alias, findingId);
    }

    for (const [index, record] of ledger.records.entries()) {
      observedStatusCounts[record.status] += 1;
      const expectedPriority =
        LC1_PRIORITY_BY_FINDING[
          record.id as keyof typeof LC1_PRIORITY_BY_FINDING
        ];
      if (record.priority !== expectedPriority) {
        context.addIssue({
          code: "custom",
          message: `${record.id} must use LC1 priority ${expectedPriority}`,
          path: ["records", index, "priority"],
        });
      }

      const expectedStatus =
        LC1_STATUS_BY_FINDING[record.id as keyof typeof LC1_STATUS_BY_FINDING];
      if (record.status !== expectedStatus) {
        context.addIssue({
          code: "custom",
          message: `${record.id} must use LC1 status ${expectedStatus}`,
          path: ["records", index, "status"],
        });
      }

      if (
        new Set(record.sourceEvidence).size !== record.sourceEvidence.length
      ) {
        context.addIssue({
          code: "custom",
          message: `${record.id} sourceEvidence must be unique`,
          path: ["records", index, "sourceEvidence"],
        });
      }

      if (record.status === "CLOSED") {
        for (const [
          aliasIndex,
          alias,
        ] of record.candidateEvidenceAliases.entries())
          registerAlias(alias, record.id, [
            "records",
            index,
            "candidateEvidenceAliases",
            aliasIndex,
          ]);
      } else if (record.status === "DISABLED") {
        if (
          new Set(
            record.disablement.serverGates.map(
              (gate) => `${gate.key}=${gate.expectedValue}`,
            ),
          ).size !== record.disablement.serverGates.length
        ) {
          context.addIssue({
            code: "custom",
            message: `${record.id} server gates must be unique`,
            path: ["records", index, "disablement", "serverGates"],
          });
        }
        registerAlias(record.disablement.negativeEvidenceAlias, record.id, [
          "records",
          index,
          "disablement",
          "negativeEvidenceAlias",
        ]);
      } else if (record.status === "EXTERNAL") {
        if (record.externalGate.ownerRole !== record.ownerRole) {
          context.addIssue({
            code: "custom",
            message: `${record.id} external owner must equal the finding owner`,
            path: ["records", index, "externalGate", "ownerRole"],
          });
        }
        if (record.externalGate.reviewAt <= ledger.auditDate) {
          context.addIssue({
            code: "custom",
            message: `${record.id} external reviewAt must be after auditDate`,
            path: ["records", index, "externalGate", "reviewAt"],
          });
        }
        if (
          !record.sourceEvidence.includes(record.externalGate.sourceDocument)
        ) {
          context.addIssue({
            code: "custom",
            message: `${record.id} external sourceDocument must be listed in sourceEvidence`,
            path: ["records", index, "externalGate", "sourceDocument"],
          });
        }
        registerAlias(
          record.externalGate.safeDeactivationEvidenceAlias,
          record.id,
          ["records", index, "externalGate", "safeDeactivationEvidenceAlias"],
        );
      } else {
        if (record.monitoring.reviewAt <= ledger.auditDate) {
          context.addIssue({
            code: "custom",
            message: `${record.id} monitoring reviewAt must be after auditDate`,
            path: ["records", index, "monitoring", "reviewAt"],
          });
        }
        if (
          new Set(record.monitoring.currentMetrics.map((metric) => metric.name))
            .size !== record.monitoring.currentMetrics.length
        ) {
          context.addIssue({
            code: "custom",
            message: `${record.id} monitoring metric names must be unique`,
            path: ["records", index, "monitoring", "currentMetrics"],
          });
        }
        registerAlias(record.monitoring.monitoringEvidenceAlias, record.id, [
          "records",
          index,
          "monitoring",
          "monitoringEvidenceAlias",
        ]);
      }
    }

    for (const status of PHASE32_FINDING_STATUSES) {
      if (observedStatusCounts[status] !== statusCounts[status]) {
        context.addIssue({
          code: "custom",
          message: `${status} count must be ${statusCounts[status]}, received ${observedStatusCounts[status]}`,
          path: ["records"],
        });
      }
    }
  });

export type Phase32FindingRecord = z.infer<typeof phase32FindingRecordSchema>;
export type Phase32FindingsLedger = z.infer<typeof phase32FindingsLedgerSchema>;

export function parsePhase32FindingsLedger(
  input: unknown,
): Phase32FindingsLedger {
  return phase32FindingsLedgerSchema.parse(input);
}
