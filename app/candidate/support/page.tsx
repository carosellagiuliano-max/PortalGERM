import { redirect } from "next/navigation";

import { requireCandidatePage } from "@/lib/auth/route-guards";

export default async function CandidateSupportBridgePage() {
  await requireCandidatePage();
  redirect("/support");
}
