import type { Metadata } from "next";

import { TalentRadarLockedPreview } from "@/components/employer/talent-radar-locked-preview";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";

export const metadata: Metadata = { title: "Talent Radar Vorschau" };
export const dynamic = "force-dynamic";

export default async function EmployerTalentRadarPage() {
  const context = await requireEmployerCompanyContext();
  // Deliberately entitlement-only: Phase 10 must execute zero Candidate/Radar queries.
  const result = await getPrismaEffectiveEntitlements(context.companyId, new Date(), getDatabase());
  const entitlements = result.ok ? result.value : null;
  return (
    <TalentRadarLockedPreview
      entitled={entitlements?.rights.TALENT_RADAR_ACCESS ?? false}
      allowance={entitlements?.rights.TALENT_CONTACT_ALLOWANCE ?? 0}
    />
  );
}
