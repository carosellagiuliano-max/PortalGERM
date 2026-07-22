import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deactivatePlanVersion,
  grantAdminCredits,
  reverseCreditConsume,
  schedulePlanVersion,
} from "@/lib/billing/admin-billing";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T12:00:00.000Z");
const ADMIN_ID = "12000000-0000-4000-8000-000000000001";
const COMPANY_ID = "12000000-0000-4000-8000-000000000002";
const PLAN_ID = "12000000-0000-4000-8000-000000000003";
const PLAN_VERSION_ID = "12000000-0000-4000-8000-000000000004";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function db() {
  if (database === undefined) throw new Error("Admin Billing test DB unavailable.");
  return database;
}

function deps(now = NOW) {
  return Object.freeze({
    actor: { userId: ADMIN_ID, email: "admin-billing@example.ch", role: "ADMIN", status: "ACTIVE" },
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_admin_billing");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await database.user.create({ data: { id: ADMIN_ID, email: "admin-billing@example.ch", emailNormalized: "admin-billing@example.ch", role: "ADMIN", status: "ACTIVE", dataProvenance: "TEST", emailVerifiedAt: NOW, createdAt: NOW, updatedAt: NOW } });
  await database.company.create({ data: { id: COMPANY_ID, name: "Admin Billing Test AG", slug: "admin-billing-test", status: "DRAFT", dataProvenance: "TEST", createdAt: NOW, updatedAt: NOW } });
  await database.plan.create({ data: { id: PLAN_ID, code: "STARTER", name: "Starter", isDefaultFree: false, createdAt: NOW, updatedAt: NOW } });
  await database.planVersion.create({ data: { id: PLAN_VERSION_ID, planId: PLAN_ID, version: 1, status: "DRAFT", priceMode: "FIXED", billingInterval: "MONTHLY", termMonths: 1, netPriceRappen: 14_900, monthlyEquivalentRappen: 14_900, currency: "CHF", isPublic: true, isSelfService: true, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: null, createdAt: NOW } });
  await database.planEntitlement.createMany({ data: [
    { id: randomUUID(), planVersionId: PLAN_VERSION_ID, key: "ACTIVE_JOB_LIMIT", valueType: "INTEGER", integerValue: 3, createdAt: NOW },
    { id: randomUUID(), planVersionId: PLAN_VERSION_ID, key: "SEAT_LIMIT", valueType: "INTEGER", integerValue: 2, createdAt: NOW },
  ] });
  await database.planVersion.update({ where: { id: PLAN_VERSION_ID }, data: { status: "ACTIVE" } });
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 Admin Billing persistence", () => {
  it("appends one typed expiring Admin grant and replays without a duplicate", async () => {
    const idempotencyKey = randomUUID();
    const input = { companyId: COMPANY_ID, creditType: "TALENT_CONTACT", amount: 10, validUntil: new Date("2027-01-01T00:00:00.000Z"), reasonCode: "CUSTOMER_SUCCESS_GRANT", idempotencyKey } as const;
    const granted = await grantAdminCredits(input, deps());
    expect(granted).toEqual({ ok: true, value: expect.objectContaining({ amount: 10, creditType: "TALENT_CONTACT" }) });
    await expect(grantAdminCredits(input, deps())).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(grantAdminCredits({ ...input, amount: 11 }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(grantAdminCredits({ ...input, reasonCode: "GRANT_REASON_CHANGED" }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(db().creditLedgerEntry.count({ where: { account: { companyId: COMPANY_ID }, kind: "GRANT", fundingSource: "ADMIN_GRANT" } })).resolves.toBe(1);
    await expect(db().auditLog.count({ where: { companyId: COMPANY_ID, action: "CREDITS_GRANTED" } })).resolves.toBe(1);
  });

  it("reverses exactly one recognized Consume append-only and denies a second key", async () => {
    const grant = await db().creditLedgerEntry.findFirstOrThrow({ where: { account: { companyId: COMPANY_ID }, kind: "GRANT", fundingSource: "ADMIN_GRANT" }, include: { account: true } });
    const consume = await db().creditLedgerEntry.create({ data: { id: randomUUID(), accountId: grant.accountId, fundingSource: grant.fundingSource, kind: "CONSUME", amount: -3, consumedGrantEntryId: grant.id, validFrom: grant.validFrom, validTo: grant.validTo, idempotencyKey: "test-consume", reasonCode: "CONTACT_REQUEST", actorUserId: ADMIN_ID, createdAt: new Date(NOW.getTime() + 1_000) } });
    const idempotencyKey = randomUUID();
    const input = { entryId: consume.id, reasonCode: "BUSINESS_STATE_RESTORED", idempotencyKey } as const;
    const reversed = await reverseCreditConsume(input, deps(new Date(NOW.getTime() + 2_000)));
    expect(reversed).toEqual({ ok: true, value: expect.objectContaining({ reversalOfEntryId: consume.id, amount: 3 }) });
    await expect(reverseCreditConsume(input, deps(new Date(NOW.getTime() + 3_000)))).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(reverseCreditConsume({ ...input, reasonCode: "REVERSAL_REASON_CHANGED" }, deps(new Date(NOW.getTime() + 3_500)))).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(reverseCreditConsume({ ...input, idempotencyKey: randomUUID() }, deps(new Date(NOW.getTime() + 4_000)))).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const expiredConsume = await db().creditLedgerEntry.create({ data: { id: randomUUID(), accountId: grant.accountId, fundingSource: grant.fundingSource, kind: "CONSUME", amount: -1, consumedGrantEntryId: grant.id, validFrom: grant.validFrom, validTo: grant.validTo, idempotencyKey: "test-consume-expired-reversal", reasonCode: "CONTACT_REQUEST", actorUserId: ADMIN_ID, createdAt: new Date(NOW.getTime() + 1_500) } });
    await expect(reverseCreditConsume({ entryId: expiredConsume.id, reasonCode: "BUSINESS_STATE_RESTORED", idempotencyKey: randomUUID() }, deps(grant.validTo))).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const missingEntryId = randomUUID();
    const missingKey = randomUUID();
    await expect(reverseCreditConsume({ entryId: missingEntryId, reasonCode: "BUSINESS_STATE_RESTORED", idempotencyKey: missingKey }, deps(new Date(NOW.getTime() + 5_000)))).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(db().auditLog.count({ where: { targetId: missingEntryId, correlationId: missingKey, action: "CREDIT_CONSUME_REVERSED", result: "DENIED", reasonCode: "REVERSAL_ENTRY_NOT_FOUND" } })).resolves.toBe(1);

    await expect(db().creditLedgerEntry.count({ where: { reversalOfEntryId: consume.id } })).resolves.toBe(1);
    await expect(db().auditLog.count({ where: { companyId: COMPANY_ID, action: "CREDIT_CONSUME_REVERSED", result: "SUCCEEDED" } })).resolves.toBe(1);
    await expect(db().auditLog.count({ where: { action: "CREDIT_CONSUME_REVERSED", result: "DENIED" } })).resolves.toBe(4);
  });

  it("keeps the active default-Free fallback impossible to deactivate directly", async () => {
    const plan = await db().plan.create({ data: { id: randomUUID(), code: "FREE_BASIC", name: "Free Basic", isDefaultFree: true, createdAt: NOW, updatedAt: NOW } });
    const version = await db().planVersion.create({ data: { id: randomUUID(), planId: plan.id, version: 1, status: "DRAFT", priceMode: "FIXED", billingInterval: "MONTHLY", termMonths: 1, netPriceRappen: 0, monthlyEquivalentRappen: 0, currency: "CHF", isPublic: false, isSelfService: false, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: null, createdAt: NOW } });
    await db().planVersion.update({ where: { id: version.id }, data: { status: "ACTIVE" } });

    await expect(deactivatePlanVersion({ versionId: version.id, reasonCode: "CATALOG_AVAILABILITY_ENDED", idempotencyKey: randomUUID() }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(db().planVersion.findUniqueOrThrow({ where: { id: version.id }, select: { status: true, validTo: true } })).resolves.toEqual({ status: "ACTIVE", validTo: null });
    await expect(db().auditLog.count({ where: { targetId: version.id, action: "CATALOG_VERSION_DEACTIVATED" } })).resolves.toBe(0);
  });

  it("closes the open active range and releases one immutable future Plan version", async () => {
    const versionId = randomUUID();
    const validFrom = new Date("2026-09-01T00:00:00.000Z");
    const input = { planId: PLAN_ID, sourceVersionId: PLAN_VERSION_ID, netPriceRappen: 15_900, validFrom, validTo: null, isPublic: true, isSelfService: true, reasonCode: "FUTURE_PRICE_SCHEDULE", idempotencyKey: versionId } as const;
    const scheduled = await schedulePlanVersion(input, deps());
    expect(scheduled).toEqual({ ok: true, value: { id: versionId, planId: PLAN_ID, version: 2, status: "SCHEDULED" } });
    await expect(schedulePlanVersion(input, deps())).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(schedulePlanVersion({ ...input, netPriceRappen: 16_900 }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(schedulePlanVersion({ ...input, sourceVersionId: randomUUID() }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(schedulePlanVersion({ ...input, reasonCode: "CHANGED_SCHEDULE_REASON" }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
    const [previous, successor] = await Promise.all([
      db().planVersion.findUniqueOrThrow({ where: { id: PLAN_VERSION_ID }, select: { status: true, validTo: true } }),
      db().planVersion.findUniqueOrThrow({ where: { id: versionId }, include: { entitlements: true } }),
    ]);
    expect(previous).toEqual({ status: "ACTIVE", validTo: validFrom });
    expect(successor).toEqual(expect.objectContaining({ status: "SCHEDULED", netPriceRappen: 15_900, monthlyEquivalentRappen: 15_900 }));
    expect(successor.entitlements).toHaveLength(2);
    await expect(db().auditLog.count({ where: { targetId: versionId, action: "CATALOG_VERSION_SCHEDULED" } })).resolves.toBe(1);
    const deactivateKey = randomUUID();
    const deactivateInput = { versionId, reasonCode: "CATALOG_AVAILABILITY_ENDED", idempotencyKey: deactivateKey } as const;
    await expect(deactivatePlanVersion(deactivateInput, deps())).resolves.toEqual({ ok: true, value: { versionId, status: "INACTIVE" } });
    await expect(deactivatePlanVersion(deactivateInput, deps())).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(deactivatePlanVersion({ ...deactivateInput, reasonCode: "DEACTIVATION_REASON_CHANGED" }, deps())).resolves.toEqual({ ok: false, code: "CONFLICT" });
  });
});
