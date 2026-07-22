import {
  assertSeedIdentityIntegrity,
  createSeedIdentity,
} from "@/prisma/seed/ids";
import { sha256CanonicalJson } from "@/prisma/seed/canonical-json";

export const CANDIDATE_COUNT = 30 as const;
export const APPLICATION_COUNT = 80 as const;
export const SAVED_JOB_COUNT = 41 as const;
export const JOB_ALERT_COUNT = 15 as const;
export const CONTACT_REQUEST_COUNT = 8 as const;
export const RADAR_PROFILE_COUNT = 10 as const;
export const PHASE_14_ELIGIBLE_RADAR_CANDIDATE_COUNT = 10 as const;
export const RADAR_CONVERSATION_COUNT = 2 as const;
export const APPLICATION_CONVERSATION_COUNT = 80 as const;
export const PRIVACY_REQUEST_COUNT = 3 as const;

export const RADAR_COMPANY_SLOTS = [
  "novarigi-digital",
  "carevia-quartiergesundheit",
] as const;

const CANTON_CODES = [
  "AG",
  "AR",
  "AI",
  "BL",
  "BS",
  "BE",
  "FR",
  "GE",
  "GL",
  "GR",
  "JU",
  "LU",
  "NE",
  "NW",
  "OW",
  "SH",
  "SZ",
  "SO",
  "SG",
  "TG",
  "TI",
  "UR",
  "VS",
  "VD",
  "ZG",
  "ZH",
] as const;

const CATEGORY_SLUGS = [
  "informatik",
  "gesundheit-pflege",
  "bau-handwerk",
  "kv-administration",
  "verkauf",
  "gastronomie-hotellerie",
  "bildung-soziales",
  "finanzen-treuhand-recht",
  "logistik-transport",
  "engineering-technik",
  "marketing-kommunikation",
  "reinigung-facility",
  "management-kader",
  "lehrstellen",
  "temporaerarbeit",
  "produktion-industrie",
  "hr-recruiting",
  "kundendienst-callcenter",
] as const;

const SKILL_SLUGS = [
  "typescript",
  "react",
  "sql",
  "cloud-infrastruktur",
  "pflegefachfrau-hf",
  "patientenbetreuung",
  "medikamentenmanagement",
  "pflegedokumentation",
  "schreiner-efz",
  "maurer-efz",
  "elektroinstallation",
  "bauplanlesen",
  "ms-office",
  "sap",
  "korrespondenz",
  "terminorganisation",
  "beratungskompetenz",
  "verkaufsgespraech",
  "warenpraesentation",
  "franzoesisch-im-verkauf",
  "servicekompetenz",
  "gaestebetreuung",
  "hygienestandards",
  "kuechenorganisation",
  "sozialpaedagogik",
  "unterrichtsplanung",
  "fallfuehrung",
  "inklusionsarbeit",
  "buchhaltung",
  "treuhandwesen",
  "schweizer-steuerpraxis",
  "vertragspruefung",
  "lagerbewirtschaftung",
  "tourenplanung",
  "staplerbedienung",
  "zollabwicklung",
  "cad-konstruktion",
  "sps-programmierung",
  "qualitaetspruefung",
  "technische-dokumentation",
  "content-marketing",
  "kampagnenplanung",
  "seo-grundlagen",
  "medienarbeit",
  "gebaeudereinigung",
  "facility-management",
  "arbeitssicherheit",
  "reinigungsmaschinen",
  "personalfuehrung",
  "budgetverantwortung",
  "strategieumsetzung",
  "stakeholder-management",
  "lernbereitschaft",
  "zuverlaessigkeit",
  "teamarbeit",
  "handwerkliches-geschick",
  "flexible-einsatzplanung",
  "schnelle-einarbeitung",
  "schichtbereitschaft",
  "branchenwechselkompetenz",
  "maschinenbedienung",
  "lean-production",
  "montagearbeit",
  "produktionskontrolle",
  "talent-acquisition",
  "interviewfuehrung",
  "arbeitszeugnisse",
  "lohnadministration",
  "telefonischer-kundendienst",
  "beschwerdemanagement",
  "crm-systeme",
  "italienisch-im-kundendienst",
] as const;

const FIRST_NAMES = [
  "Mira",
  "Noah",
  "Elin",
  "Lio",
  "Sina",
  "Nino",
  "Lina",
  "Elia",
  "Nora",
  "Levin",
  "Aline",
  "Gian",
  "Sara",
  "Luca",
  "Mila",
  "Janis",
  "Lea",
  "Reto",
  "Alina",
  "Tim",
  "Giulia",
  "Dario",
  "Zoé",
  "Maël",
  "Ana",
  "Yann",
  "Tessa",
  "Silvan",
  "Ilaria",
  "Flurin",
] as const;

const LAST_NAMES = [
  "Amsler",
  "Bieri",
  "Caminada",
  "Delley",
  "Egger",
  "Frei",
  "Gisler",
  "Hunziker",
  "Imhof",
  "Jost",
  "Keller",
  "Lüthi",
  "Moser",
  "Nussbaumer",
  "Odermatt",
  "Perren",
  "Quaglia",
  "Rochat",
  "Sutter",
  "Tschudi",
  "Ulrich",
  "Vitali",
  "Wyss",
  "Zufferey",
  "Bühler",
  "Caruso",
  "Droz",
  "Eugster",
  "Fontana",
  "Gasser",
] as const;

const LANGUAGE_ROTATION = ["de", "fr", "it", "en"] as const;
const LANGUAGE_LEVELS = ["B2", "C1", "NATIVE"] as const;
const JOB_TYPE_ROTATION = [
  "PERMANENT",
  "TEMPORARY",
  "FREELANCE",
  "INTERNSHIP",
  "APPRENTICESHIP",
] as const;
const REMOTE_PREFERENCES = ["ANY", "HYBRID", "ONSITE", "REMOTE"] as const;
const SENIORITIES = ["JUNIOR", "MID", "SENIOR", "LEAD"] as const;

export type CandidateFixture = Readonly<{
  key: string;
  email: string;
  cantonCode: string;
  firstName: string | null;
  lastName: string;
  publicDisplayName: string;
  postalCode: string;
  cityLabel: string;
  summary: string;
  userStatus: "ACTIVE" | "SUSPENDED";
  finalOnboardingStatus: "COMPLETE" | "DRAFT";
  onboardingHistory: readonly ("DRAFT_CREATED" | "COMPLETED" | "REOPENED")[];
  skillSlugs: readonly string[];
  languages: readonly Readonly<{ code: string; level: string }>[];
  categorySlug: string;
  desiredTitles: readonly string[];
  desiredJobTypes: readonly string[];
  salaryMinChf: number;
  salaryMaxChf: number;
  workloadMin: number;
  workloadMax: number;
  remotePreference: string;
  mobilityRadiusKm: number;
  seniority: string;
  radarConsent: "GRANTED" | "DENIED" | null;
  radarPublished: boolean;
}>;

export const CANDIDATE_FIXTURES: readonly CandidateFixture[] = Object.freeze(
  Array.from({ length: CANDIDATE_COUNT }, (_, index) => {
    const key = `candidate-${String(index + 1).padStart(2, "0")}`;
    const skillCount = 3 + (index % 6);
    const skillStart = (index * 7) % SKILL_SLUGS.length;
    const skillSlugs = Array.from(
      { length: skillCount },
      (_, skillIndex) =>
        SKILL_SLUGS[(skillStart + skillIndex) % SKILL_SLUGS.length] as string,
    );
    const languageCount = index % 2 === 0 ? 2 : 3;
    const languages = Array.from(
      { length: languageCount },
      (_, languageIndex) => ({
        code: LANGUAGE_ROTATION[
          (index + languageIndex) % LANGUAGE_ROTATION.length
        ] as string,
        level: LANGUAGE_LEVELS[
          (index + languageIndex) % LANGUAGE_LEVELS.length
        ] as string,
      }),
    );
    const reopened = index >= 28;
    const finalOnboardingStatus =
      index === 10 || index === 26 || index === 27 || reopened
        ? "DRAFT"
        : "COMPLETE";
    const onboardingHistory: CandidateFixture["onboardingHistory"] = reopened
      ? ["DRAFT_CREATED", "COMPLETED", "REOPENED"]
      : finalOnboardingStatus === "COMPLETE"
        ? ["DRAFT_CREATED", "COMPLETED"]
        : ["DRAFT_CREATED"];

    return Object.freeze({
      key,
      email:
        index === 0
          ? "candidate@demo.ch"
          : `${key}@demo.swisstalenthub.invalid`,
      cantonCode: CANTON_CODES[index % CANTON_CODES.length] as string,
      firstName: index === 10 ? null : (FIRST_NAMES[index] as string),
      lastName: LAST_NAMES[index] as string,
      publicDisplayName: `Talent ${String((index % 5) + 1).padStart(2, "0")}`,
      postalCode: String(1000 + index * 97).slice(0, 4),
      cityLabel: `Demo-Ort ${String((index % 9) + 1).padStart(2, "0")}`,
      summary:
        "Fiktives Demo-Profil mit nachvollziehbaren Präferenzen und ohne reale personenbezogene Daten.",
      userStatus: index === 27 ? "SUSPENDED" : "ACTIVE",
      finalOnboardingStatus,
      onboardingHistory: Object.freeze(onboardingHistory),
      skillSlugs: Object.freeze(skillSlugs),
      languages: Object.freeze(
        languages.map((language) => Object.freeze(language)),
      ),
      categorySlug: CATEGORY_SLUGS[index % CATEGORY_SLUGS.length] as string,
      desiredTitles: Object.freeze([
        `Fachperson ${String((index % 8) + 1).padStart(2, "0")}`,
      ]),
      desiredJobTypes: Object.freeze([
        JOB_TYPE_ROTATION[index % JOB_TYPE_ROTATION.length] as string,
      ]),
      salaryMinChf: 62_000 + (index % 8) * 4_000,
      salaryMaxChf: 82_000 + (index % 8) * 5_000,
      workloadMin: 60 + (index % 3) * 10,
      workloadMax: 80 + (index % 3) * 10,
      remotePreference: REMOTE_PREFERENCES[
        index % REMOTE_PREFERENCES.length
      ] as string,
      mobilityRadiusKm: 15 + (index % 6) * 10,
      seniority: SENIORITIES[index % SENIORITIES.length] as string,
      radarConsent: index <= 10 ? "GRANTED" : index === 11 ? "DENIED" : null,
      radarPublished: index < RADAR_PROFILE_COUNT,
    });
  }),
);

const FIRST_TWENTY_APPLICATION_STATUSES = [
  "IN_REVIEW",
  "IN_REVIEW",
  "IN_REVIEW",
  "SHORTLISTED",
  "SHORTLISTED",
  "SHORTLISTED",
  "INTERVIEW",
  "INTERVIEW",
  "INTERVIEW",
  "OFFER",
  "OFFER",
  "OFFER",
  "HIRED",
  "HIRED",
  "REJECTED",
  "REJECTED",
  "REJECTED",
  "WITHDRAWN",
  "WITHDRAWN",
  "WITHDRAWN",
] as const;

const REMAINING_APPLICATION_STATUSES = [
  ...Array.from({ length: 20 }, () => "SUBMITTED" as const),
  ...Array.from({ length: 11 }, () => "IN_REVIEW" as const),
  ...Array.from({ length: 9 }, () => "SHORTLISTED" as const),
  ...Array.from({ length: 7 }, () => "INTERVIEW" as const),
  ...Array.from({ length: 5 }, () => "OFFER" as const),
  ...Array.from({ length: 2 }, () => "HIRED" as const),
  ...Array.from({ length: 5 }, () => "REJECTED" as const),
  "WITHDRAWN" as const,
] as const;

const APPLICATION_STATUSES = [
  ...FIRST_TWENTY_APPLICATION_STATUSES,
  ...REMAINING_APPLICATION_STATUSES,
] as const;

export type ApplicationFixtureStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_PATHS = Object.freeze({
  SUBMITTED: Object.freeze(["SUBMITTED"]),
  IN_REVIEW: Object.freeze(["SUBMITTED", "IN_REVIEW"]),
  SHORTLISTED: Object.freeze(["SUBMITTED", "IN_REVIEW", "SHORTLISTED"]),
  INTERVIEW: Object.freeze([
    "SUBMITTED",
    "IN_REVIEW",
    "SHORTLISTED",
    "INTERVIEW",
  ]),
  OFFER: Object.freeze([
    "SUBMITTED",
    "IN_REVIEW",
    "SHORTLISTED",
    "INTERVIEW",
    "OFFER",
  ]),
  HIRED: Object.freeze([
    "SUBMITTED",
    "IN_REVIEW",
    "SHORTLISTED",
    "INTERVIEW",
    "OFFER",
    "HIRED",
  ]),
  REJECTED: Object.freeze(["SUBMITTED", "IN_REVIEW", "REJECTED"]),
  WITHDRAWN: Object.freeze(["SUBMITTED", "WITHDRAWN"]),
} as const satisfies Readonly<
  Record<ApplicationFixtureStatus, readonly ApplicationFixtureStatus[]>
>);

const APPLICATION_CANDIDATE_INDICES = CANDIDATE_FIXTURES.flatMap(
  (candidate, index) =>
    candidate.firstName !== null && candidate.lastName.length > 0
      ? [index]
      : [],
);

export type ApplicationFixture = Readonly<{
  key: string;
  candidateIndex: number;
  jobIndex: number;
  status: ApplicationFixtureStatus;
  hasConversationMessages: boolean;
  linksCv: boolean;
}>;

export type ApplicationTransitionFixture = Readonly<{
  actor: "CANDIDATE" | "EMPLOYER";
  fromStatus: ApplicationFixtureStatus;
  naturalKey: string;
  stepIndex: number;
  stepCount: number;
  toStatus: ApplicationFixtureStatus;
}>;

export function applicationTransitionFixtures(
  application: Pick<ApplicationFixture, "key" | "status">,
): readonly ApplicationTransitionFixture[] {
  const path = APPLICATION_STATUS_PATHS[application.status];
  const transitions = path.slice(1).map((toStatus, index) => {
    const fromStatus = path[index];
    if (fromStatus === undefined) {
      throw new Error(
        `Missing application transition origin for ${application.key}.`,
      );
    }
    const stepIndex = index + 1;
    const stepCount = path.length - 1;
    return Object.freeze({
      actor: toStatus === "WITHDRAWN" ? "CANDIDATE" : "EMPLOYER",
      fromStatus,
      naturalKey: `${application.key}:status:${String(stepIndex).padStart(2, "0")}:${fromStatus.toLowerCase()}-to-${toStatus.toLowerCase()}`,
      stepIndex,
      stepCount,
      toStatus,
    });
  });
  return Object.freeze(transitions);
}

export const APPLICATION_FIXTURES: readonly ApplicationFixture[] =
  Object.freeze(
    Array.from({ length: APPLICATION_COUNT }, (_, index) => {
      const candidateIndex = APPLICATION_CANDIDATE_INDICES[
        index % APPLICATION_CANDIDATE_INDICES.length
      ] as number;
      return Object.freeze({
        key: `application-${String(index + 1).padStart(3, "0")}`,
        candidateIndex,
        jobIndex: index,
        status: APPLICATION_STATUSES[index] as ApplicationFixtureStatus,
        hasConversationMessages: index < 20,
        linksCv: candidateIndex === 0,
      });
    }),
  );

export const SAVED_JOB_FIXTURES = Object.freeze([
  ...Array.from({ length: SAVED_JOB_COUNT - 1 }, (_, index) =>
    Object.freeze({
      key: `saved-job-${String(index + 1).padStart(2, "0")}`,
      candidateIndex: (index + 7) % CANDIDATE_COUNT,
      jobPool: "PUBLISHED" as const,
      jobIndex: (index + 40) % 100,
    }),
  ),
  Object.freeze({
    key: "saved-job-expired-01",
    candidateIndex: 0,
    jobPool: "EXPIRED" as const,
    jobIndex: 0,
  }),
]);

const ALERT_STATUSES = [
  ...Array.from({ length: 6 }, () => "ACTIVE" as const),
  ...Array.from({ length: 4 }, () => "PAUSED" as const),
  ...Array.from({ length: 3 }, () => "UNSUBSCRIBED" as const),
  ...Array.from({ length: 2 }, () => "DELETED" as const),
] as const;

export const JOB_ALERT_FIXTURES = Object.freeze(
  Array.from({ length: JOB_ALERT_COUNT }, (_, index) =>
    Object.freeze({
      key: `job-alert-${String(index + 1).padStart(2, "0")}`,
      candidateIndex: index % CANDIDATE_COUNT,
      frequency: index % 3 === 0 ? ("WEEKLY" as const) : ("DAILY" as const),
      status: ALERT_STATUSES[index] as string,
      jobIndices: Object.freeze([(index * 2) % 100, (index * 2 + 1) % 100]),
    }),
  ),
);

export const CONTACT_REQUEST_FIXTURES = Object.freeze([
  Object.freeze({
    key: "contact-accepted-a",
    companySlot: 0,
    candidateIndex: 0,
    status: "ACCEPTED",
    timing: "cooldown-a",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-accepted-b",
    companySlot: 1,
    candidateIndex: 1,
    status: "ACCEPTED",
    timing: "cooldown-b",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-pending-a",
    companySlot: 0,
    candidateIndex: 2,
    status: "PENDING",
    timing: "current",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-pending-b",
    companySlot: 1,
    candidateIndex: 3,
    status: "PENDING",
    timing: "current",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-declined-a",
    companySlot: 0,
    candidateIndex: 0,
    status: "DECLINED",
    timing: "historic-a",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-declined-b",
    companySlot: 1,
    candidateIndex: 1,
    status: "DECLINED",
    timing: "historic-b",
    fundingGrant: "BASE",
  }),
  Object.freeze({
    key: "contact-expired-a",
    companySlot: 0,
    candidateIndex: 4,
    status: "EXPIRED",
    timing: "phase14-expired",
    fundingGrant: "PHASE_14",
  }),
  Object.freeze({
    key: "contact-cancelled-a",
    companySlot: 0,
    candidateIndex: 5,
    status: "CANCELLED",
    timing: "phase14-cancelled",
    fundingGrant: "PHASE_14",
  }),
] as const);

export const PRIVACY_REQUEST_FIXTURES = Object.freeze([
  Object.freeze({
    key: "privacy-export-pending",
    candidateIndex: 0,
    type: "EXPORT",
    correctionFields: [],
  }),
  Object.freeze({
    key: "privacy-delete-pending",
    candidateIndex: 1,
    type: "DELETE",
    correctionFields: [],
  }),
  Object.freeze({
    key: "privacy-correct-pending",
    candidateIndex: 2,
    type: "CORRECT",
    correctionFields: ["PROFILE_PREFERENCES", "LOCATION"],
  }),
] as const);

export const CANDIDATE_WORKFLOW_FIXTURE_CONTRACT = Object.freeze({
  candidates: CANDIDATE_FIXTURES.map((candidate) => ({
    key: candidate.key,
    cantonCode: candidate.cantonCode,
    onboardingStatus: candidate.finalOnboardingStatus,
    userStatus: candidate.userStatus,
    skillSlugs: candidate.skillSlugs,
    languages: candidate.languages,
    categorySlug: candidate.categorySlug,
    radarConsent: candidate.radarConsent,
    radarPublished: candidate.radarPublished,
  })),
  applications: APPLICATION_FIXTURES,
  savedJobs: SAVED_JOB_FIXTURES,
  alerts: JOB_ALERT_FIXTURES,
  contactRequests: CONTACT_REQUEST_FIXTURES,
  privacyRequests: PRIVACY_REQUEST_FIXTURES,
  radarCompanySlots: RADAR_COMPANY_SLOTS,
  phase14: Object.freeze({
    eligibleRadarCandidateKeys: CANDIDATE_FIXTURES.slice(
      0,
      PHASE_14_ELIGIBLE_RADAR_CANDIDATE_COUNT,
    ).map(({ key }) => key),
    contactCreditBalances: Object.freeze([
      Object.freeze({ companySlot: 0, balance: 1 }),
      Object.freeze({ companySlot: 1, balance: 0 }),
    ]),
    piiCanaryCandidateKey: CANDIDATE_FIXTURES[0]?.key ?? "missing-canary",
  }),
});

function buildIdentitySpecs() {
  const specs: Array<readonly [string, string]> = [];
  const add = (entity: string, naturalKey: string) => {
    specs.push([entity, naturalKey]);
  };

  CANDIDATE_FIXTURES.forEach((candidate, candidateIndex) => {
    // candidate@demo.ch is owned by the preceding demo-account block. This
    // block verifies and links it, but must not duplicate its manifest identity.
    if (candidateIndex !== 0) {
      add("user", candidate.email);
    }
    add("candidate-profile", candidate.email);
    add("candidate-preference", candidate.key);
    add("candidate-preference-category", candidate.key);
    candidate.skillSlugs.forEach((skillSlug) =>
      add("candidate-skill", `${candidate.key}:${skillSlug}`),
    );
    candidate.languages.forEach((language) =>
      add("candidate-language", `${candidate.key}:${language.code}`),
    );
    candidate.onboardingHistory.forEach((kind, eventIndex) =>
      add(
        "candidate-onboarding-event",
        `${candidate.key}:${String(eventIndex).padStart(2, "0")}:${kind}`,
      ),
    );
    if (candidateIndex === 0) {
      add("candidate-document", `${candidate.key}:cv`);
    }
    if (candidate.radarConsent !== null) {
      add("candidate-consent", `${candidate.key}:${candidate.radarConsent}`);
    }
    if (candidate.radarPublished) {
      add("radar-profile", candidate.key);
      RADAR_COMPANY_SLOTS.forEach((companySlug) => {
        ["previous", "current"].forEach((epoch) =>
          add(
            "radar-opaque-mapping",
            `${companySlug}:${epoch}:${candidate.key}`,
          ),
        );
        add(
          "radar-opaque-mapping",
          `phase14:${companySlug}:current:${candidate.key}`,
        );
      });
    }
  });

  APPLICATION_FIXTURES.forEach((application) => {
    add("application", application.key);
    add("application-snapshot", application.key);
    if (application.linksCv) {
      add("application-document", application.key);
    }
    add("application-event", `${application.key}:submitted`);
    applicationTransitionFixtures(application).forEach((transition) =>
      add("application-event", transition.naturalKey),
    );
    add("conversation", `${application.key}:conversation`);
    add("conversation-participant", `${application.key}:candidate`);
    add("conversation-participant", `${application.key}:company`);
    if (application.hasConversationMessages) {
      add("message", `${application.key}:candidate-message`);
      add("message", `${application.key}:employer-message`);
    }
  });

  SAVED_JOB_FIXTURES.forEach((savedJob) => add("saved-job", savedJob.key));
  JOB_ALERT_FIXTURES.forEach((alert) => {
    add("user-consent-event", `${alert.key}:delivery-granted`);
    add("job-alert", alert.key);
    add("job-alert-event", `${alert.key}:created`);
    add("job-alert-event", `${alert.key}:digest-recorded`);
    if (alert.status !== "ACTIVE") {
      add("job-alert-event", `${alert.key}:${alert.status.toLowerCase()}`);
    }
    add("job-alert-digest", alert.key);
    alert.jobIndices.forEach((_, itemIndex) =>
      add("job-alert-digest-item", `${alert.key}:${itemIndex}`),
    );
    add("job-alert-unsubscribe-token", alert.key);
    add("email-log", `${alert.key}:digest-recorded`);
  });

  RADAR_COMPANY_SLOTS.forEach((companySlug) => {
    add("credit-account", `candidate-workflows:${companySlug}:talent-contact`);
    add("credit-ledger-entry", `candidate-workflows:${companySlug}:grant`);
    ["previous", "current"].forEach((epoch) => {
      add("radar-search-budget", `${companySlug}:${epoch}`);
      add("radar-search-session", `${companySlug}:${epoch}`);
      for (let position = 0; position < 5; position += 1) {
        add(
          "radar-search-session-candidate",
          `${companySlug}:${epoch}:${position}`,
        );
      }
    });
    add("radar-search-budget", `phase14:${companySlug}:eligible-default`);
    add("radar-search-session", `phase14:${companySlug}:eligible-default`);
    for (
      let position = 0;
      position < PHASE_14_ELIGIBLE_RADAR_CANDIDATE_COUNT;
      position += 1
    ) {
      add(
        "radar-search-session-candidate",
        `phase14:${companySlug}:eligible-default:${position}`,
      );
    }
  });

  add(
    "credit-ledger-entry",
    `candidate-workflows:${RADAR_COMPANY_SLOTS[0]}:phase14-grant`,
  );

  CONTACT_REQUEST_FIXTURES.forEach((request) => {
    add("radar-search-session", `phase14-contact:${request.key}`);
    add(
      "radar-search-session-candidate",
      `phase14-contact:${request.key}`,
    );
    add("credit-ledger-entry", `candidate-workflows:${request.key}:consume`);
    add("employer-contact-request", request.key);
    add("contact-request-event", `${request.key}:created`);
    if (request.status !== "PENDING") {
      add(
        "contact-request-event",
        `${request.key}:${request.status.toLowerCase()}`,
      );
    }
    if (request.status === "ACCEPTED") {
      add("contact-request-event", `${request.key}:reveal-granted`);
      add("conversation", `${request.key}:conversation`);
      add("conversation-participant", `${request.key}:candidate`);
      add("conversation-participant", `${request.key}:company`);
      add("message", `${request.key}:employer-message`);
      add("message", `${request.key}:candidate-message`);
      add("identity-reveal-grant", request.key);
      const fields =
        request.key === "contact-accepted-a"
          ? ["DISPLAY_NAME", "EMAIL"]
          : ["DISPLAY_NAME", "EMAIL", "PHONE"];
      fields.forEach((field) =>
        add("identity-reveal-grant-field", `${request.key}:${field}`),
      );
      add("identity-reveal-confirmation", `${request.key}:initial`);
      if (request.key === "contact-accepted-b") {
        add("identity-reveal-confirmation", `${request.key}:add-fields`);
      }
    }
  });

  PRIVACY_REQUEST_FIXTURES.forEach((request) => {
    add("privacy-request", request.key);
    add("privacy-request-event", `${request.key}:created`);
    request.correctionFields.forEach((field) =>
      add("privacy-request-correction-field", `${request.key}:${field}`),
    );
  });

  return specs;
}

export const CANDIDATE_WORKFLOW_SEED_IDENTITIES = assertSeedIdentityIntegrity(
  buildIdentitySpecs().map(([entity, naturalKey]) =>
    createSeedIdentity(entity, naturalKey),
  ),
);

export const CANDIDATE_WORKFLOW_BLOCK_DIGEST = Object.freeze({
  name: "candidate-workflows",
  recordCount: CANDIDATE_WORKFLOW_SEED_IDENTITIES.length,
  digestSha256: sha256CanonicalJson(CANDIDATE_WORKFLOW_FIXTURE_CONTRACT),
});
