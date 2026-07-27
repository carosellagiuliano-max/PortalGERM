import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/route-guards";

export default async function AdminSecurityIndexPage() {
  await requireAdminPage();
  redirect("/admin/security/authenticators");
}
