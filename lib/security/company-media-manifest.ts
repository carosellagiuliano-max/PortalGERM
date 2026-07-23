export const COMPANY_MEDIA_MANIFEST_V1 = Object.freeze([
  Object.freeze({
    path: "/assets/company-media/default-logo.svg",
    kind: "LOGO" as const,
    mimeType: "image/svg+xml" as const,
    label: "SwissTalentHub Standardlogo",
  }),
  Object.freeze({
    path: "/assets/company-media/default-cover.svg",
    kind: "COVER" as const,
    mimeType: "image/svg+xml" as const,
    label: "SwissTalentHub Standardcover",
  }),
  Object.freeze({
    path: "/assets/company-media/alpine-cover.svg",
    kind: "COVER" as const,
    mimeType: "image/svg+xml" as const,
    label: "SwissTalentHub Alpencover",
  }),
]);

export type CompanyMediaKind =
  (typeof COMPANY_MEDIA_MANIFEST_V1)[number]["kind"];

export function companyMediaOptions(kind: CompanyMediaKind) {
  return COMPANY_MEDIA_MANIFEST_V1.filter((asset) => asset.kind === kind);
}

export function isReviewedCompanyMediaPath(
  value: string,
  kind: CompanyMediaKind,
) {
  return COMPANY_MEDIA_MANIFEST_V1.some(
    (asset) => asset.kind === kind && asset.path === value,
  );
}
