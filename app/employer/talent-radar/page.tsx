import { createHmac, randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock3Icon, RadarIcon, ShieldCheckIcon } from "lucide-react";

import { CandidateCard } from "@/components/employer/TalentRadar/CandidateCard";
import { FilterBar } from "@/components/employer/TalentRadar/FilterBar";
import { LockedPreview } from "@/components/employer/TalentRadar/LockedPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import { getAuthRequestContext } from "@/lib/auth/request-context";
import { createPostgresRadarDistinctFilterBudget } from "@/lib/auth/rate-limit";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { buildCatalogUpgradePrompt } from "@/lib/billing/upgrade-prompt";
import { getServerEnvironment } from "@/lib/config/env";
import type { KeyringEntry, ServerEnvironment } from "@/lib/config/env-schema";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import type { RadarOpaqueKey } from "@/lib/privacy/radar-opaque";
import { toRadarEligibilityEnvironment } from "@/lib/talentradar/eligibility";
import {
  createPrismaRadarCandidateListRepository,
  listRadarCandidates,
  type RadarListCandidatesResult,
} from "@/lib/talentradar/list-candidates";
import type { RadarPrivacyHmacKeyV1 } from "@/lib/talentradar/privacy-policy-v1";
import { signRadarContactSearchSessionProof } from "@/lib/talentradar/request-contact";

export const metadata: Metadata = {
  title: "Talent Radar",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RadarQuery = Readonly<Record<string, string | string[] | undefined>>;

export default async function EmployerTalentRadarPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RadarQuery> }>) {
  const [context, employerContext, query, request] = await Promise.all([
    requireEmployerCompanyContext(),
    getEmployerContext(),
    searchParams,
    getAuthRequestContext(),
  ]);
  if (employerContext === null || employerContext.current === null) notFound();

  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();

  // This gate intentionally completes before listRadarCandidates or any other
  // Candidate/Radar query is reachable.
  const gate = await loadRadarGate({
    companyId: context.companyId,
    membershipRole: context.membershipRole,
    database,
    now,
  });
  if (!gate.allowed) {
    const upgradePrompt = gate.reason === "TALENT_RADAR_NOT_INCLUDED"
      ? await buildCatalogUpgradePrompt(
          {
            reason: "TALENT_RADAR_NOT_INCLUDED",
            suggestedPlanSlug: "pro",
            actorRole: context.membershipRole,
          },
          { database, now },
        )
      : undefined;
    return <LockedPreview reason={gate.reason} upgradePrompt={upgradePrompt} />;
  }

  const filters = filterPayload(query);
  const [result, skills] = await Promise.all([
    listRadarCandidates(
      {
        actorUserId: employerContext.user.id,
        companyId: context.companyId,
        filters,
        cursor: singleValue(query.cursor),
        now,
        environment: toRadarEligibilityEnvironment(environment.APP_ENV),
      },
      {
        repository: createPrismaRadarCandidateListRepository(database),
        membershipRateLimit: {
          async consume({ membershipId, now: consumedAt }) {
            const decision = await consumeRequestRateLimit(
              "RADAR_LIST",
              { membershipId, membershipActive: true },
              request,
              consumedAt,
              { database, environment },
            );
            return decision.allowed
              ? Object.freeze({ allowed: true as const })
              : Object.freeze({
                  allowed: false as const,
                  retryAfterSeconds: decision.retryAfterSeconds,
                });
          },
        },
        distinctFilterBudget: createPostgresRadarDistinctFilterBudget(database),
        samplingKey: deriveRadarPrivacyKey(environment, "daily-sample"),
        cursorKeyring: Object.freeze([
          deriveRadarPrivacyKey(environment, "cursor"),
        ]),
        opaqueLookupKeyring: materializeOpaqueKeyring(
          environment.secrets.keyrings.RADAR_OPAQUE_LOOKUP_KEYS,
        ),
        opaqueEncryptionKeyring: materializeOpaqueKeyring(
          environment.secrets.keyrings.RADAR_OPAQUE_ENCRYPTION_KEYS,
        ),
      },
    ),
    database.skill.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 250,
      select: { id: true, name: true },
    }),
  ]);

  if (result.status === "LOCKED") {
    const reason = result.reason === "TALENT_RADAR_NOT_INCLUDED"
      ? "TALENT_RADAR_NOT_INCLUDED"
      : result.reason === "COMPANY_UNVERIFIED"
        ? "COMPANY_UNVERIFIED"
        : result.reason === "COMPANY_INACTIVE"
          ? "COMPANY_INACTIVE"
          : "ROLE";
    return <LockedPreview reason={reason} />;
  }

  const signedSearchSession = result.status === "AVAILABLE"
    ? signRadarContactSearchSessionProof(
        {
          searchSessionId: result.searchSessionId,
          actorUserId: employerContext.user.id,
          companyId: context.companyId,
          membershipId: context.membershipId,
          filterHash: result.filterHash,
          sessionExpiresAt: result.searchSessionExpiresAt,
          now,
        },
        environment.secrets.session,
      )
    : null;

  return (
    <section aria-labelledby="talent-radar-title" className="grid gap-7">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Datenschutzfreundliche Talentsuche</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 id="talent-radar-title" className="text-3xl font-semibold tracking-tight">
              Talent Radar
            </h1>
            <Badge variant="outline">
              <ShieldCheckIcon aria-hidden="true" /> Anonym geschützt
            </Badge>
          </div>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Identitäten der Kandidat:innen bleiben anonym, bis sie freigegeben
            werden. Die Trefferzahl wird nur als grobe Kohorte angezeigt.
          </p>
        </div>
        <Link
          href="/employer/talent-radar/requests"
          className={buttonVariants({ variant: "outline" })}
        >
          Kontaktanfragen ansehen
        </Link>
      </header>

      <FilterBar values={filterValues(query)} skills={skills} />
      <RadarResult
        result={result}
        query={query}
        signedSearchSession={signedSearchSession}
      />

      <Alert>
        <RadarIcon aria-hidden="true" />
        <AlertTitle>Identität bleibt anonym bis zur Freigabe</AlertTitle>
        <AlertDescription>
          Eine angenommene Kontaktanfrage gibt noch keine Identität frei. Nur
          die Kandidatin oder der Kandidat kann später einzelne Felder separat
          und protokolliert freigeben.
        </AlertDescription>
      </Alert>
    </section>
  );
}

function RadarResult({
  result,
  query,
  signedSearchSession,
}: Readonly<{
  result: Exclude<RadarListCandidatesResult, { status: "LOCKED" }>;
  query: RadarQuery;
  signedSearchSession: string | null;
}>) {
  if (result.status === "INVALID_FILTER" || result.status === "INVALID_CURSOR") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Suche nicht gültig</AlertTitle>
        <AlertDescription>
          Die Filter oder der Seitenlink konnten nicht sicher bestätigt werden.
          Setze die Suche zurück und versuche es erneut.
        </AlertDescription>
      </Alert>
    );
  }
  if (result.status === "LIMIT") {
    return (
      <Alert>
        <Clock3Icon aria-hidden="true" />
        <AlertTitle>Suchlimit erreicht</AlertTitle>
        <AlertDescription>
          Bitte warte etwa {result.retryAfterSeconds} Sekunden. Es werden keine
          Angaben zur Grösse oder Existenz einer seltenen Kohorte offengelegt.
        </AlertDescription>
      </Alert>
    );
  }
  if (result.status === "INSUFFICIENT_COHORT") {
    return (
      <Alert>
        <ShieldCheckIcon aria-hidden="true" />
        <AlertTitle>Keine ausreichend grosse anonyme Kohorte</AlertTitle>
        <AlertDescription>
          Für diese Filterkombination werden aus Datenschutzgründen keine Karten
          angezeigt. Entferne einzelne Filter, um breiter zu suchen.
        </AlertDescription>
      </Alert>
    );
  }
  if (signedSearchSession === null) return null;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Kohortengrösse: <strong className="text-foreground">{result.countLabel}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Maximal 20 täglich stabil ausgewählte Profile
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {result.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.opaqueId}
            candidate={candidate}
            signedSearchSession={signedSearchSession}
            idempotencyKey={randomUUID()}
          />
        ))}
      </div>
      {result.nextCursor === null ? null : (
        <Link
          href={nextPageHref(query, result.nextCursor)}
          className={buttonVariants({ variant: "outline", className: "mx-auto" })}
        >
          Weitere anonyme Profile
        </Link>
      )}
    </div>
  );
}

async function loadRadarGate({
  companyId,
  membershipRole,
  database,
  now,
}: Readonly<{
  companyId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  database: ReturnType<typeof getDatabase>;
  now: Date;
}>): Promise<
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason:
        | "ROLE"
        | "COMPANY_INACTIVE"
        | "COMPANY_UNVERIFIED"
        | "TALENT_RADAR_NOT_INCLUDED";
    }>
> {
  if (membershipRole === "VIEWER") {
    return Object.freeze({ allowed: false, reason: "ROLE" });
  }
  const [company, entitlements] = await Promise.all([
    database.company.findUnique({
      where: { id: companyId },
      select: {
        status: true,
        verificationRequests: {
          where: { status: "VERIFIED", supersededBy: null },
          take: 2,
          select: { id: true },
        },
      },
    }),
    getPrismaEffectiveEntitlements(companyId, now, database),
  ]);
  if (company?.status !== "ACTIVE") {
    return Object.freeze({ allowed: false, reason: "COMPANY_INACTIVE" });
  }
  if (company.verificationRequests.length !== 1) {
    return Object.freeze({ allowed: false, reason: "COMPANY_UNVERIFIED" });
  }
  if (!entitlements.ok || !entitlements.value.rights.TALENT_RADAR_ACCESS) {
    return Object.freeze({
      allowed: false,
      reason: "TALENT_RADAR_NOT_INCLUDED",
    });
  }
  return Object.freeze({ allowed: true });
}

function filterPayload(query: RadarQuery) {
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => key !== "cursor"),
  );
}

function filterValues(query: RadarQuery) {
  return Object.freeze({
    skillId: singleValue(query.skillId),
    cantonCode: singleValue(query.cantonCode),
    salaryBudgetCeilingChf: singleValue(query.salaryBudgetCeilingChf),
    workloadMinimumPercent: singleValue(query.workloadMinimumPercent),
    languageCode: singleValue(query.languageCode),
    languageMinimumLevel: singleValue(query.languageMinimumLevel),
    remotePreference: singleValue(query.remotePreference),
  });
}

function nextPageHref(query: RadarQuery, cursor: string) {
  const params = new URLSearchParams();
  for (const key of [
    "skillId",
    "cantonCode",
    "salaryBudgetCeilingChf",
    "workloadMinimumPercent",
    "languageCode",
    "languageMinimumLevel",
    "remotePreference",
  ]) {
    const value = singleValue(query[key]);
    if (value !== undefined && value.length > 0) params.set(key, value);
  }
  params.set("cursor", cursor);
  return `/employer/talent-radar?${params.toString()}`;
}

function singleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function materializeOpaqueKeyring(
  entries: readonly KeyringEntry<
    "RADAR_OPAQUE_LOOKUP_KEYS" | "RADAR_OPAQUE_ENCRYPTION_KEYS"
  >[],
): readonly RadarOpaqueKey[] {
  return Object.freeze(entries.map((entry) =>
    entry.key.withValue((secret) => Object.freeze({
      version: entry.version,
      secret,
    })),
  ));
}

function deriveRadarPrivacyKey(
  environment: ServerEnvironment,
  purpose: "daily-sample" | "cursor",
): RadarPrivacyHmacKeyV1 {
  return environment.secrets.session.withValue((secret) => Object.freeze({
    version: "phase14-v1",
    secret: createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`swisstalenthub:talent-radar:${purpose}:v1`, "utf8")
      .digest("base64"),
  }));
}
