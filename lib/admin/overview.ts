import "server-only";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import { requireCapability, type AdminDependencies } from "@/lib/admin/common";

export async function getAdminOverview(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_OVERVIEW_READ")) return null;
  const now = dependencies.now ?? new Date();
  const ageingJobBoundary = new Date(now.getTime() - 48 * 3_600_000);
  const leadBoundary = new Date(now.getTime() - 24 * 3_600_000);
  const [pendingJobs, ageingJobs, verificationCases, activeSupply, openReports, importFailures, supportBreaches, newLeads, recentAudit] = await Promise.all([
    dependencies.database.job.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    dependencies.database.job.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] }, updatedAt: { lte: ageingJobBoundary } } }),
    dependencies.database.companyVerificationRequest.count({ where: { status: { in: ["PENDING", "CHANGES_REQUESTED"] }, supersededBy: null } }),
    dependencies.database.job.count({ where: { status: "PUBLISHED", publishedAt: { lte: now }, expiresAt: { gt: now } } }),
    dependencies.database.abuseReport.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    dependencies.database.importRun.count({ where: { status: "FAILED" } }),
    dependencies.database.supportCase.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, dueAt: { lte: now } } }),
    dependencies.database.salesLead.count({ where: { status: "NEW", OR: [{ dueAt: { lte: now } }, { dueAt: null, createdAt: { lte: leadBoundary } }] } }),
    dependencies.database.auditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, actorUserId: true, action: true, targetType: true, targetId: true, result: true, reasonCode: true, createdAt: true } }),
  ]);
  return Object.freeze({ metrics: { pendingJobs, ageingJobs, verificationCases, activeSupply, openReports, importFailures, supportBreaches, newLeads }, recentAudit });
}

export async function searchAdmin(dependencies: AdminDependencies, rawQuery: string) {
  if (!requireCapability(dependencies, "ADMIN_GLOBAL_SEARCH")) return null;
  const query = rawQuery.trim().slice(0, 160);
  if (query.length < 2) return Object.freeze({ jobs: [], companies: [], users: [] });
  const isUuid = z.uuid().safeParse(query).success;
  const jobFilters = [
    { slug: { contains: query, mode: "insensitive" as const } },
    { currentRevision: { is: { title: { contains: query, mode: "insensitive" as const } } } },
    ...(isUuid ? [{ id: query }] : []),
  ];
  const companyFilters = [
    { slug: { contains: query, mode: "insensitive" as const } },
    { name: { contains: query, mode: "insensitive" as const } },
    ...(isUuid ? [{ id: query }] : []),
  ];
  const userFilters = [
    { emailNormalized: { contains: query.toLowerCase() } },
    { name: { contains: query, mode: "insensitive" as const } },
    ...(isUuid ? [{ id: query }] : []),
  ];
  const [jobs, companies, users] = await Promise.all([
    dependencies.database.job.findMany({ where: { OR: jobFilters }, take: 8, select: { id: true, slug: true, status: true, currentRevision: { select: { title: true } } } }),
    dependencies.database.company.findMany({ where: { OR: companyFilters }, take: 8, select: { id: true, name: true, slug: true, status: true } }),
    dependencies.database.user.findMany({ where: { OR: userFilters }, take: 8, select: { id: true, email: true, name: true, role: true, status: true } }),
  ]);
  return Object.freeze({ jobs, companies, users });
}

export async function getOperationalQueueCounts(database: DatabaseClient, now: Date) {
  const [jobs, verification, reports, imports, support, leads] = await Promise.all([
    database.job.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    database.companyVerificationRequest.count({ where: { status: { in: ["PENDING", "CHANGES_REQUESTED"] }, supersededBy: null } }),
    database.abuseReport.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    database.importRun.count({ where: { status: "FAILED" } }),
    database.supportCase.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, dueAt: { lte: now } } }),
    database.salesLead.count({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } } }),
  ]);
  return Object.freeze({ jobs, verification, reports, imports, support, leads });
}
