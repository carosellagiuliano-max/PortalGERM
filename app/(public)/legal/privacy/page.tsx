import type { Metadata } from "next";

import { PublishedLegalPage } from "@/components/legal/published-legal-page";

export const metadata: Metadata = { title: "Datenschutz" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivacyLegalPage() {
  return <PublishedLegalPage slug="privacy" expectedTitle="Datenschutz" />;
}
