"use client";

import { createContext, useContext } from "react";

import Link from "@/components/shared/app-link";
import {
  PUBLIC_INTAKE_PRIVACY_FORM_FIELDS,
  type PublicIntakePrivacyGateDecision,
  type PublicIntakePrivacyPurpose,
} from "@/lib/privacy/public-intake-privacy-contract";

const UNAVAILABLE_DECISION: PublicIntakePrivacyGateDecision = Object.freeze({
  allowed: false,
  code: "GATE_UNAVAILABLE",
});

const PublicIntakePrivacyContext =
  createContext<PublicIntakePrivacyGateDecision>(UNAVAILABLE_DECISION);

export function PublicIntakePrivacyProvider({
  decision,
  children,
}: Readonly<{
  decision: PublicIntakePrivacyGateDecision;
  children: React.ReactNode;
}>) {
  return (
    <PublicIntakePrivacyContext value={decision}>
      {children}
    </PublicIntakePrivacyContext>
  );
}

export function usePublicIntakePrivacy(
  purpose: PublicIntakePrivacyPurpose,
): PublicIntakePrivacyGateDecision {
  const decision = useContext(PublicIntakePrivacyContext);
  return decision.allowed && decision.binding.purpose !== purpose
    ? UNAVAILABLE_DECISION
    : decision;
}

export function PublicIntakePrivacyHiddenFields({
  purpose,
}: Readonly<{ purpose: PublicIntakePrivacyPurpose }>) {
  const decision = usePublicIntakePrivacy(purpose);
  if (!decision.allowed) return null;
  const binding = decision.binding;
  return (
    <>
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.purpose}
        value={binding.purpose}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.evidenceMode}
        value={binding.evidenceMode}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.legalPublicationId}
        value={binding.legalPublicationId ?? ""}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.publicationHash}
        value={binding.publicationHash ?? ""}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.publicationVersion}
        value={binding.publicationVersion ?? ""}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.noticeVersion}
        value={binding.noticeVersion}
      />
      <input
        type="hidden"
        name={PUBLIC_INTAKE_PRIVACY_FORM_FIELDS.noticeHash}
        value={binding.noticeHash}
      />
    </>
  );
}

export function PublicIntakePrivacyDisclosure({
  purpose,
  className = "text-xs leading-5 text-muted-foreground",
}: Readonly<{
  purpose: PublicIntakePrivacyPurpose;
  className?: string;
}>) {
  const decision = usePublicIntakePrivacy(purpose);
  if (!decision.allowed) return null;
  const binding = decision.binding;
  return (
    <div className={className} data-privacy-evidence-mode={binding.evidenceMode}>
      <p>{binding.noticeText}</p>
      <p className="mt-2">
        {binding.evidenceMode === "PUBLISHED_LEGAL" ? (
          <>
            Massgebender Datenschutzhinweis: Version {binding.publicationVersion}.{" "}
            <Link className="font-medium text-foreground underline" href="/legal/privacy">
              Datenschutz öffnen
            </Link>
          </>
        ) : (
          "Lokaler synthetischer Testvertrag — keine veröffentlichte Rechtsfreigabe."
        )}
      </p>
    </div>
  );
}

export function PublicIntakePrivacyLocked({
  purpose,
}: Readonly<{ purpose: PublicIntakePrivacyPurpose }>) {
  const title =
    purpose === "EMPLOYER_DEMO"
      ? "Demo-Anfrage derzeit gesperrt"
      : "Meldung derzeit gesperrt";
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">
        Der aktuelle Datenschutzhinweis ist nicht vollständig veröffentlicht oder
        hat sich seit dem Laden dieser Seite geändert. Es wurden keine Angaben
        übermittelt. Bitte lade die Seite neu und versuche es später nochmals.
      </p>
      <Link className="mt-2 inline-block font-medium underline" href="/legal/privacy">
        Status des Datenschutzhinweises prüfen
      </Link>
    </div>
  );
}
