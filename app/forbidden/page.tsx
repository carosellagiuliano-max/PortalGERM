import type { Metadata } from "next";

import { ForbiddenView } from "@/components/auth/forbidden-view";

export const metadata: Metadata = {
  title: "Zugriff nicht erlaubt",
  robots: { index: false, follow: false, noarchive: true },
};

export default function ForbiddenPage() {
  return <ForbiddenView />;
}
