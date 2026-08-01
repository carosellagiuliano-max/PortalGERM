import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";

const REQUIRED_REGISTRATION_DOCUMENTS = Object.freeze([
  Object.freeze({ slug: "terms", type: "TERMS" as const }),
  Object.freeze({ slug: "privacy", type: "PRIVACY" as const }),
]);

export type RegistrationLegalBindingV1 = Readonly<{
  policyVersion: "registration-publication-v1";
  terms: RegistrationLegalPublicationReference;
  privacy: RegistrationLegalPublicationReference;
}>;

type RegistrationLegalPublicationReference = Readonly<{
  publicationId: string;
  publicationHash: string;
  versionLabel: string;
}>;

export type RegistrationLegalGateDecisionV1 =
  | Readonly<{
      allowed: true;
      mode: "LOCAL_SYNTHETIC";
      binding: null;
    }>
  | Readonly<{
      allowed: true;
      mode: "PUBLISHED_LEGAL";
      binding: RegistrationLegalBindingV1;
    }>
  | Readonly<{
      allowed: false;
      mode: "PUBLISHED_LEGAL";
      code: "PUBLICATION_UNAVAILABLE";
    }>;

/**
 * Public registration may only record acceptance when the exact German Terms
 * and Privacy publications are both enabled, current and internally
 * consistent. Local/CI remains an explicitly synthetic demo contract.
 */
export async function resolveRegistrationLegalGate(
  environment: ServerEnvironment,
  database: DatabaseClient,
  now = new Date(),
): Promise<RegistrationLegalGateDecisionV1> {
  if (environment.APP_ENV === "local" || environment.APP_ENV === "ci") {
    return Object.freeze({
      allowed: true,
      mode: "LOCAL_SYNTHETIC",
      binding: null,
    });
  }

  if (
    !environment.LEGAL_PUBLICATION_TERMS ||
    !environment.LEGAL_PUBLICATION_PRIVACY ||
    !Number.isFinite(now.getTime())
  ) {
    return denied();
  }

  try {
    const publications = await database.legalPublication.findMany({
      where: {
        status: "CURRENT",
        effectiveAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        legalDocument: {
          locale: "de-CH",
          slug: { in: REQUIRED_REGISTRATION_DOCUMENTS.map(({ slug }) => slug) },
        },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        publicationHash: true,
        legalDocument: {
          select: { type: true, locale: true, slug: true },
        },
        legalRevision: {
          select: { versionLabel: true, contentHash: true },
        },
      },
    });

    if (publications.length !== REQUIRED_REGISTRATION_DOCUMENTS.length) {
      return denied();
    }

    const bySlug = new Map(publications.map((publication) => [
      publication.legalDocument.slug,
      publication,
    ]));
    for (const required of REQUIRED_REGISTRATION_DOCUMENTS) {
      const publication = bySlug.get(required.slug);
      if (
        publication === undefined ||
        publication.legalDocument.type !== required.type ||
        publication.legalDocument.locale !== "de-CH" ||
        publication.publicationHash !== publication.legalRevision.contentHash
      ) {
        return denied();
      }
    }

    const terms = bySlug.get("terms");
    const privacy = bySlug.get("privacy");
    if (terms === undefined || privacy === undefined) return denied();

    return Object.freeze({
      allowed: true,
      mode: "PUBLISHED_LEGAL",
      binding: Object.freeze({
        policyVersion: "registration-publication-v1",
        terms: reference(terms),
        privacy: reference(privacy),
      }),
    });
  } catch {
    return denied();
  }
}

function reference(
  publication: Readonly<{
    id: string;
    publicationHash: string;
    legalRevision: Readonly<{ versionLabel: string }>;
  }>,
): RegistrationLegalPublicationReference {
  return Object.freeze({
    publicationId: publication.id,
    publicationHash: publication.publicationHash,
    versionLabel: publication.legalRevision.versionLabel,
  });
}

function denied(): RegistrationLegalGateDecisionV1 {
  return Object.freeze({
    allowed: false,
    mode: "PUBLISHED_LEGAL",
    code: "PUBLICATION_UNAVAILABLE",
  });
}
