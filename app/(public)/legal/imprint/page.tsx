import type { Metadata } from "next";

import { PublishedLegalPage } from "@/components/legal/published-legal-page";

export const metadata: Metadata = { title: "Impressum" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ImprintLegalPage() {
  return <PublishedLegalPage slug="imprint" expectedTitle="Impressum" />;
}
