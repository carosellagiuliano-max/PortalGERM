import "server-only";

import { notFound } from "next/navigation";

import { requireEmployerPage } from "@/lib/auth/route-guards";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export async function requireEmployerBillingPage(ownerOnly = false) {
  const [user, context] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
  ]);
  if (
    ownerOnly
      ? context.membershipRole !== "OWNER"
      : context.membershipRole !== "OWNER" && context.membershipRole !== "ADMIN"
  ) {
    notFound();
  }
  return Object.freeze({ user, context });
}
