import type { Metadata } from "next";

import { PublishedLegalPage } from "@/components/legal/published-legal-page";

export const metadata: Metadata = { title: "Nutzungsbedingungen" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TermsLegalPage() {
  return (
    <PublishedLegalPage
      slug="terms"
      expectedTitle="Nutzungsbedingungen"
    />
  );
}
