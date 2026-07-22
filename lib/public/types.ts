import type {
  ApplicationContactKind,
  ApplicationEffort,
  DataProvenance,
  JobType,
  Language,
  LanguageLevel,
  RemoteType,
  RequiredDocumentKind,
  SalaryPeriod,
  Seniority,
} from "@/lib/generated/prisma/enums";

export type PublicResponseEvidence = Readonly<{
  known: boolean;
  targetDays: number | null;
  onTimeRateBps: number | null;
  sampleSizeBucket: "20–49" | "50+" | null;
}>;

export type PublicJobCardModel = Readonly<{
  id: string;
  slug: string;
  title: string;
  description: string;
  company: Readonly<{
    id: string;
    slug: string;
    name: string;
    verified: true;
  }>;
  category: Readonly<{ id: string; name: string; slug: string }>;
  canton: Readonly<{ id: string; name: string; slug: string; code: string }> | null;
  city: Readonly<{ id: string; name: string; slug: string }> | null;
  locationLabel: string | null;
  remoteType: RemoteType;
  jobType: JobType;
  workloadMin: number;
  workloadMax: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  applicationEffort: ApplicationEffort;
  contentLanguage: Language;
  fairScore: number | null;
  response: PublicResponseEvidence;
  publishedAt: Date;
  expiresAt: Date;
  dataProvenance: DataProvenance;
  activeBoost: boolean;
  sponsored: boolean;
}>;

export type PublicJobDetailModel = PublicJobCardModel & Readonly<{
  company: PublicJobCardModel["company"] & Readonly<{
    website: string | null;
    logoUrl: string | null;
  }>;
  companyIntro: string | null;
  tasks: readonly string[];
  requirements: readonly string[];
  niceToHave: readonly string[];
  offer: string | null;
  benefits: readonly Readonly<{ code: string; description: string }>[];
  skills: readonly Readonly<{ id: string; name: string; slug: string; required: boolean }>[];
  languages: readonly Readonly<{ code: string; minLevel: LanguageLevel }>[];
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: readonly RequiredDocumentKind[];
  inclusionStatement: string | null;
  startDate: Date | null;
  startByArrangement: boolean;
  remoteCountryCode: string | null;
  applicationContactKind: ApplicationContactKind;
  applicationContactValue: string;
  fairScoreVersion: string | null;
  fairBreakdown: readonly Readonly<{
    key: string;
    label: string;
    points: number;
    maxPoints: number;
  }>[];
}>;

export type PublicJobSearchPage = Readonly<{
  jobs: readonly PublicJobCardModel[];
  nextCursor: string | null;
  totalEligible: number;
  /**
   * Public search now computes this exactly across its RepeatableRead keyset
   * scan. The flag remains explicit for older API consumers.
   */
  resultCountIsExact: boolean;
  /**
   * Backwards-compatible truncation signal. Phase-15 search always returns
   * `false`; no candidate workset cap is applied before global ranking.
   */
  candidateSetTruncated: boolean;
  invalidCursor: boolean;
}>;

export type PublicCompanyCardModel = Readonly<{
  id: string;
  slug: string;
  name: string;
  industry: string | null;
  size: string | null;
  city: string | null;
  canton: string | null;
  verified: boolean;
  openJobCount: number;
  benefitsPreview: readonly string[];
  response: PublicResponseEvidence;
  dataProvenance: DataProvenance;
}>;

export type PublicCompanyDetailModel = PublicCompanyCardModel & Readonly<{
  website: string | null;
  about: string | null;
  values: readonly string[];
  benefits: readonly string[];
  enhancedProfile: boolean;
  jobs: readonly PublicJobCardModel[];
}>;

export type PublicCompanyDirectoryPage = Readonly<{
  companies: readonly PublicCompanyCardModel[];
  nextCursor: string | null;
  totalEligible: number;
  invalidCursor: boolean;
}>;

export type PublicGuideModel = Readonly<{
  id: string;
  slug: string;
  canonicalPath: string;
  title: string;
  excerpt: string;
  body: string;
  publishedAt: Date;
  dataProvenance: DataProvenance;
}>;

export type PublicCatalog = Readonly<{
  cantons: readonly Readonly<{ id: string; code: string; name: string; slug: string }>[];
  cities: readonly Readonly<{ id: string; name: string; slug: string; cantonId: string }>[];
  categories: readonly Readonly<{ id: string; name: string; slug: string }>[];
}>;

export type PublicClusterLink = Readonly<{
  kind: "canton" | "category";
  slug: string;
  label: string;
  count: number;
  launchable: boolean;
}>;

export type SalaryRadarQuery = Readonly<{
  datasetKey: string;
  categorySlug: string;
  cantonSlug: string;
  seniority: Seniority;
  workloadMin: number;
  workloadMax: number;
  jobTitle?: string;
}>;
