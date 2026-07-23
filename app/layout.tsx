import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/inter";

import { AppProviders } from "@/components/shared/app-providers";
import { getServerEnvironment } from "@/lib/config/env";
import {
  CONTENT_SECURITY_POLICY_NONCE_HEADER,
  isValidContentSecurityPolicyNonce,
} from "@/lib/security/content-security-policy";

import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getServerEnvironment().APP_URL),
    title: {
      default: "SwissTalentHub",
      template: "%s · SwissTalentHub",
    },
    description:
      "Faire Jobtransparenz, Lohnorientierung und datenschutzfreundliche Zugänge für Kandidat:innen und Arbeitgeber.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A nonce cannot safely be embedded in pre-rendered HTML. Reading the
  // request headers makes the root dynamic so Next can apply the proxy nonce
  // to its bootstrap scripts for every response.
  const requestHeaders = await headers();
  const requestNonce = requestHeaders.get(
    CONTENT_SECURITY_POLICY_NONCE_HEADER,
  );
  const nonce = isValidContentSecurityPolicyNonce(requestNonce)
    ? requestNonce
    : undefined;

  return (
    <html lang="de-CH" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        <AppProviders nonce={nonce}>{children}</AppProviders>
      </body>
    </html>
  );
}
