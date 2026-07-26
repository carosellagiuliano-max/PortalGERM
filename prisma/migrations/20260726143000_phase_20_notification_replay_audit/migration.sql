-- Phase 20 sandbox replay is explicit and auditable. Production replay stays
-- fail-closed until the Phase 25 step-up grant exists.
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_DELIVERY_REPLAYED';
