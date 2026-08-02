import "server-only";

import {
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";

export async function getAdminLegalControlPlane(
  dependencies: AdminDependencies,
) {
  if (!(await requireCapability(dependencies, "ADMIN_LEGAL_READ"))) {
    return null;
  }
  const [documents, approvals, inventory] = await Promise.all([
    dependencies.database.legalDocument.findMany({
      orderBy: [{ type: "asc" }, { locale: "asc" }],
      include: {
        revisions: { orderBy: { revisionNumber: "desc" } },
        publications: { orderBy: { createdAt: "desc" } },
      },
    }),
    dependencies.database.processingApproval.findMany({
      orderBy: [
        { scope: "asc" },
        { processorKey: "asc" },
        { createdAt: "desc" },
      ],
      take: 100,
    }),
    dependencies.database.privacyDataInventoryVersion.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { entries: true } } },
    }),
  ]);
  return Object.freeze({ documents, approvals, inventory });
}
