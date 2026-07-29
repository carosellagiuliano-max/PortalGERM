/**
 * Phase-30 matrix entrypoint for the abuse/duplicate contract.
 *
 * The owning PostgreSQL suite is intentionally consolidated because its
 * duplicate, report-SLA, reconfirmation and due-boundary cases share one
 * sequential fixture: the exact-duplicate fingerprint established first is
 * subsequently reconfirmed, expired and checked against consumer eligibility.
 * Importing the suite keeps the documented command executable without
 * weakening that state-machine coverage or cloning a divergent test fixture.
 */
import "./job-freshness-postgres.test";
