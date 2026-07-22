// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  RADAR_ISO_639_1_CODES_V1,
  RADAR_PRIVACY_POLICY_V1,
  RADAR_SALARY_CEILINGS_CHF_V1,
  gateRadarCohortV1,
  getRadarZurichCalendarDateV1,
  getRadarZurichCalendarDayWindowV1,
  normalizeRadarFiltersV1,
  parsePersistedRadarFiltersV1,
  pageRadarDailySampleV1,
  radarLanguageMeetsMinimumV1,
  selectRadarDailySampleV1,
  signRadarCursorV1,
  toRadarLanguageBucketV1,
  verifyRadarCursorV1,
  type RadarPrivacyHmacKeyV1,
} from "@/lib/talentradar/privacy-policy-v1";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const SKILL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILTER_HASH = "a".repeat(64);
const OTHER_FILTER_HASH = "b".repeat(64);
const KEY: RadarPrivacyHmacKeyV1 = Object.freeze({
  version: "2026-01",
  secret: Buffer.alloc(32, 7).toString("base64"),
});
const OLD_KEY: RadarPrivacyHmacKeyV1 = Object.freeze({
  version: "2025-12",
  secret: Buffer.alloc(32, 9).toString("base64"),
});
const CANDIDATE_IDS = Array.from(
  { length: 30 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

describe("RADAR_PRIVACY_POLICY_V1", () => {
  it("freezes the complete P0 privacy and enumeration contract", () => {
    expect(RADAR_PRIVACY_POLICY_V1).toMatchObject({
      version: "v1",
      calendarTimeZone: "Europe/Zurich",
      salary: {
        minimumCeilingChf: 40_000,
        maximumCeilingChf: 250_000,
        stepChf: 10_000,
        period: "YEARLY_FTE",
      },
      cohort: { minimumSize: 10, countLabels: ["10+", "25+", "50+", "100+"] },
      discovery: { maximumSampleSize: 20, pageSize: 10, maximumPages: 2 },
      enumeration: {
        listRequestsPerMembershipPerRollingMinute: 10,
        distinctFilterHashesPerCompanyPerZurichDay: 30,
      },
      cursor: { ttlMilliseconds: 900_000 },
      opaqueId: {
        epochLengthZurichCalendarDays: 30,
        epochAnchorZurichDate: "2026-01-01",
      },
    });
    expect(RADAR_SALARY_CEILINGS_CHF_V1).toEqual([
      40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 110_000,
      120_000, 130_000, 140_000, 150_000, 160_000, 170_000, 180_000,
      190_000, 200_000, 210_000, 220_000, 230_000, 240_000, 250_000,
    ]);
    expect(RADAR_ISO_639_1_CODES_V1).toHaveLength(184);
    expect(new Set(RADAR_ISO_639_1_CODES_V1).size).toBe(184);
    expect(Object.isFrozen(RADAR_PRIVACY_POLICY_V1)).toBe(true);
    expect(Object.isFrozen(RADAR_PRIVACY_POLICY_V1.salary)).toBe(true);
    expect(Object.isFrozen(RADAR_PRIVACY_POLICY_V1.cohort.countLabels)).toBe(true);
    expect(Object.isFrozen(RADAR_SALARY_CEILINGS_CHF_V1)).toBe(true);
  });
});

describe("closed Radar filters", () => {
  it("normalizes casing, empty defaults and salary steps into a stable golden hash", () => {
    const first = normalizeRadarFiltersV1({
      remotePreference: " hybrid ",
      languageMinimumLevel: " working ",
      salaryBudgetCeilingChf: "129999",
      skillId: ` ${SKILL_ID.toUpperCase()} `,
      workloadMinimumPercent: "80",
      cantonCode: " zh ",
      languageCode: " DE ",
    });
    const second = normalizeRadarFiltersV1({
      cantonCode: "ZH",
      skillId: SKILL_ID,
      salaryBudgetCeilingChf: 120_000,
      workloadMinimumPercent: 80,
      languageCode: "de",
      languageMinimumLevel: "WORKING",
      remotePreference: "HYBRID",
    });

    expect(first).toEqual(second);
    expect(first.filters).toEqual({
      skillId: SKILL_ID,
      cantonCode: "ZH",
      salaryBudgetCeilingChf: 120_000,
      workloadMinimumPercent: 80,
      languageCode: "de",
      languageMinimumLevel: "WORKING",
      remotePreference: "HYBRID",
    });
    expect(first.canonical).toBe(
      '{"policyVersion":"v1","filters":{"skillId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cantonCode":"ZH","salaryBudgetCeilingChf":120000,"workloadMinimumPercent":80,"languageCode":"de","languageMinimumLevel":"WORKING","remotePreference":"HYBRID"}}',
    );
    expect(first.filterHash).toBe(
      "ea3486fc03b7a97572e1f5cd4c7736f430e13fe2047b9a382eb1b67397c3e0e7",
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.filters)).toBe(true);
  });

  it("canonicalizes explicit blank form values to the same empty filter", () => {
    expect(normalizeRadarFiltersV1({
      skillId: " ",
      cantonCode: "",
      salaryBudgetCeilingChf: " ",
      workloadMinimumPercent: "",
      languageCode: "",
      languageMinimumLevel: " ",
      remotePreference: "",
    })).toEqual(normalizeRadarFiltersV1({}));
  });

  it.each([
    [{ query: "typescript" }],
    [{ unknown: "value" }],
    [{ skillId: [SKILL_ID] }],
    [{ cantonCode: ["ZH"] }],
    [{ salaryBudgetCeilingChf: [120_000] }],
    [{ workloadMinimumPercent: [80] }],
    [{ languageCode: ["de"], languageMinimumLevel: "BASIC" }],
    [{ remotePreference: ["REMOTE"] }],
  ])("rejects unknown, free-text or enumerable filter input: %j", (input) => {
    expect(() => normalizeRadarFiltersV1(input)).toThrow();
  });

  it.each([
    [{ skillId: "typescript" }],
    [{ cantonCode: "XX" }],
    [{ salaryBudgetCeilingChf: 39_999 }],
    [{ salaryBudgetCeilingChf: 250_001 }],
    [{ salaryBudgetCeilingChf: "CHF 120000" }],
    [{ workloadMinimumPercent: 70 }],
    [{ languageCode: "zz", languageMinimumLevel: "BASIC" }],
    [{ languageCode: "iw", languageMinimumLevel: "BASIC" }],
    [{ languageCode: "de" }],
    [{ languageMinimumLevel: "WORKING" }],
    [{ languageCode: "de", languageMinimumLevel: "B2" }],
    [{ remotePreference: "SOMETIMES" }],
  ])("rejects values outside the frozen taxonomy: %j", (input) => {
    expect(() => normalizeRadarFiltersV1(input)).toThrow();
  });

  it("rounds a valid salary ceiling down and keeps both range boundaries", () => {
    expect(normalizeRadarFiltersV1({ salaryBudgetCeilingChf: 40_000 })
      .filters.salaryBudgetCeilingChf).toBe(40_000);
    expect(normalizeRadarFiltersV1({ salaryBudgetCeilingChf: 49_999 })
      .filters.salaryBudgetCeilingChf).toBe(40_000);
    expect(normalizeRadarFiltersV1({ salaryBudgetCeilingChf: 250_000 })
      .filters.salaryBudgetCeilingChf).toBe(250_000);
  });

  it("strictly revalidates the canonical null-filled session snapshot", () => {
    const normalized = normalizeRadarFiltersV1({
      cantonCode: "ZH",
      salaryBudgetCeilingChf: 120_000,
    });
    expect(parsePersistedRadarFiltersV1(normalized.filters)).toEqual(normalized);
    expect(() => parsePersistedRadarFiltersV1({
      ...normalized.filters,
      query: null,
    })).toThrow();
    expect(() => parsePersistedRadarFiltersV1({
      ...normalized.filters,
      salaryBudgetCeilingChf: 125_000,
    })).toThrow();
  });
});

describe("coarse language and cohort buckets", () => {
  it.each([
    ["A1", "BASIC"],
    ["a2", "BASIC"],
    ["B1", "WORKING"],
    ["b2", "WORKING"],
    ["C1", "ADVANCED"],
    ["c2", "ADVANCED"],
    ["native", "ADVANCED"],
  ] as const)("maps %s to %s", (level, bucket) => {
    expect(toRadarLanguageBucketV1(level)).toBe(bucket);
  });

  it("compares only coarse language ranks", () => {
    expect(radarLanguageMeetsMinimumV1("A2", "BASIC")).toBe(true);
    expect(radarLanguageMeetsMinimumV1("B1", "BASIC")).toBe(true);
    expect(radarLanguageMeetsMinimumV1("B2", "WORKING")).toBe(true);
    expect(radarLanguageMeetsMinimumV1("B2", "ADVANCED")).toBe(false);
    expect(radarLanguageMeetsMinimumV1("NATIVE", "ADVANCED")).toBe(true);
    expect(() => toRadarLanguageBucketV1("FLUENT")).toThrow(/taxonomy/i);
  });

  it("returns the identical suppression state for zero and every rare cohort", () => {
    const zero = gateRadarCohortV1(0);
    expect(gateRadarCohortV1(1)).toBe(zero);
    expect(gateRadarCohortV1(9)).toBe(zero);
    expect(zero).toEqual({ status: "INSUFFICIENT_COHORT" });
    expect(JSON.stringify(zero)).not.toMatch(/count|total|size/i);
  });

  it.each([
    [10, "10+"],
    [24, "10+"],
    [25, "25+"],
    [49, "25+"],
    [50, "50+"],
    [99, "50+"],
    [100, "100+"],
    [10_000, "100+"],
  ] as const)("labels %s only as %s", (count, countLabel) => {
    expect(gateRadarCohortV1(count)).toEqual({ status: "AVAILABLE", countLabel });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid internal exact cohort count: %s",
    (count) => expect(() => gateRadarCohortV1(count)).toThrow(),
  );
});

describe("deterministic bounded daily sampling", () => {
  it("has a stable golden sample independent of input order and duplicate rows", () => {
    const input = {
      companyId: COMPANY_ID,
      filterHash: FILTER_HASH,
      calendarDate: "2026-07-22",
      candidateProfileIds: CANDIDATE_IDS,
    };
    const first = selectRadarDailySampleV1(input, KEY);
    const second = selectRadarDailySampleV1({
      ...input,
      candidateProfileIds: [...CANDIDATE_IDS].reverse().concat(CANDIDATE_IDS[0]!),
    }, KEY);

    expect(first).toEqual(second);
    expect(first).toEqual({
      sampleId: "T-lBpPiFklXtrYukP2moEw",
      candidateProfileIds: [
        "00000000-0000-4000-8000-000000000006",
        "00000000-0000-4000-8000-000000000024",
        "00000000-0000-4000-8000-000000000003",
        "00000000-0000-4000-8000-000000000027",
        "00000000-0000-4000-8000-000000000011",
        "00000000-0000-4000-8000-000000000019",
        "00000000-0000-4000-8000-000000000004",
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000023",
        "00000000-0000-4000-8000-000000000028",
        "00000000-0000-4000-8000-000000000025",
        "00000000-0000-4000-8000-000000000009",
        "00000000-0000-4000-8000-000000000021",
        "00000000-0000-4000-8000-000000000013",
        "00000000-0000-4000-8000-000000000020",
        "00000000-0000-4000-8000-000000000015",
        "00000000-0000-4000-8000-000000000007",
        "00000000-0000-4000-8000-000000000016",
        "00000000-0000-4000-8000-000000000026",
        "00000000-0000-4000-8000-000000000012",
      ],
    });
    expect(first.candidateProfileIds).toHaveLength(20);
    expect(new Set(first.candidateProfileIds).size).toBe(20);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.candidateProfileIds)).toBe(true);
  });

  it("changes the pseudorandom sample scope across Company, filter and Zurich day", () => {
    const common = {
      companyId: COMPANY_ID,
      filterHash: FILTER_HASH,
      calendarDate: "2026-07-22",
      candidateProfileIds: CANDIDATE_IDS,
    };
    const baseline = selectRadarDailySampleV1(common, KEY);
    expect(selectRadarDailySampleV1({ ...common, companyId: OTHER_COMPANY_ID }, KEY))
      .not.toEqual(baseline);
    expect(selectRadarDailySampleV1({ ...common, filterHash: OTHER_FILTER_HASH }, KEY))
      .not.toEqual(baseline);
    expect(selectRadarDailySampleV1({ ...common, calendarDate: "2026-07-23" }, KEY))
      .not.toEqual(baseline);
  });

  it("returns at most two fixed pages and no arbitrary offset", () => {
    const first = pageRadarDailySampleV1(CANDIDATE_IDS.slice(0, 20), 0);
    const second = pageRadarDailySampleV1(CANDIDATE_IDS.slice(0, 20), 10);
    expect(first).toEqual({
      candidateProfileIds: CANDIDATE_IDS.slice(0, 10),
      nextPosition: 10,
    });
    expect(second).toEqual({
      candidateProfileIds: CANDIDATE_IDS.slice(10, 20),
      nextPosition: null,
    });
    expect(pageRadarDailySampleV1(CANDIDATE_IDS.slice(0, 10), 0).nextPosition)
      .toBeNull();
    expect(() => pageRadarDailySampleV1(CANDIDATE_IDS.slice(0, 21), 0)).toThrow();
    expect(() => pageRadarDailySampleV1([CANDIDATE_IDS[0]!, CANDIDATE_IDS[0]!], 0))
      .toThrow();
    expect(() => pageRadarDailySampleV1(CANDIDATE_IDS, 20 as 10)).toThrow();
  });
});

describe("scope-bound signed Radar cursor", () => {
  const now = new Date("2026-07-22T10:15:30.000Z");
  const dailySampleId = Buffer.alloc(16, 3).toString("base64url");
  const scope = { companyId: COMPANY_ID, filterHash: FILTER_HASH, dailySampleId };

  it("signs the frozen second-page position and verifies a golden cursor", () => {
    const cursor = signRadarCursorV1({ ...scope, now }, KEY);
    expect(cursor).toBe(
      "eyJwb2xpY3lWZXJzaW9uIjoidjEiLCJrZXlWZXJzaW9uIjoiMjAyNi0wMSIsImNvbXBhbnlJZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSIsImZpbHRlckhhc2giOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiZGFpbHlTYW1wbGVJZCI6IkF3TURBd01EQXdNREF3TURBd01EQXciLCJwb3NpdGlvbiI6MTAsImlzc3VlZEF0IjoxNzg0NzE1MzMwMDAwLCJleHBpcmVzQXQiOjE3ODQ3MTYyMzAwMDB9.zuGP6gdFJ7jrc9pBoC-OYOJLc1u4SW1pl3YjvhICP98",
    );
    expect(verifyRadarCursorV1(cursor, { ...scope, now }, [KEY])).toEqual({
      policyVersion: "v1",
      keyVersion: KEY.version,
      ...scope,
      position: 10,
      issuedAt: now.getTime(),
      expiresAt: now.getTime() + 900_000,
    });
  });

  it("rejects tampering, malformed encodings and missing signing keys", () => {
    const cursor = signRadarCursorV1({ ...scope, now }, KEY);
    const [payload, signature] = cursor.split(".") as [string, string];
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifyRadarCursorV1(`${tamperedPayload}.${signature}`, { ...scope, now }, [KEY]))
      .toBeNull();
    expect(verifyRadarCursorV1(`${payload}.${tamperedSignature}`, { ...scope, now }, [KEY]))
      .toBeNull();
    expect(verifyRadarCursorV1(`${cursor}.extra`, { ...scope, now }, [KEY])).toBeNull();
    expect(verifyRadarCursorV1("not-base64.***", { ...scope, now }, [KEY])).toBeNull();
    expect(verifyRadarCursorV1(cursor, { ...scope, now }, [OLD_KEY])).toBeNull();
  });

  it("fails closed on Company, filter and daily-sample replay", () => {
    const cursor = signRadarCursorV1({ ...scope, now }, KEY);
    expect(verifyRadarCursorV1(cursor, {
      ...scope,
      companyId: OTHER_COMPANY_ID,
      now,
    }, [KEY])).toBeNull();
    expect(verifyRadarCursorV1(cursor, {
      ...scope,
      filterHash: OTHER_FILTER_HASH,
      now,
    }, [KEY])).toBeNull();
    expect(verifyRadarCursorV1(cursor, {
      ...scope,
      dailySampleId: Buffer.alloc(16, 4).toString("base64url"),
      now,
    }, [KEY])).toBeNull();
  });

  it("uses a half-open 15-minute validity window and supports retained read keys", () => {
    const cursor = signRadarCursorV1({ ...scope, now }, OLD_KEY);
    expect(verifyRadarCursorV1(cursor, {
      ...scope,
      now: new Date(now.getTime() + 899_999),
    }, [KEY, OLD_KEY])).not.toBeNull();
    expect(verifyRadarCursorV1(cursor, {
      ...scope,
      now: new Date(now.getTime() + 900_000),
    }, [KEY, OLD_KEY])).toBeNull();
  });

  it("rejects invalid key material before producing or trusting a cursor", () => {
    const invalidKey = { version: "bad version", secret: "not-base64" };
    expect(() => signRadarCursorV1({ ...scope, now }, invalidKey)).toThrow(/key/i);
    const cursor = signRadarCursorV1({ ...scope, now }, KEY);
    expect(() => verifyRadarCursorV1(cursor, { ...scope, now }, [invalidKey]))
      .toThrow(/key/i);
    expect(() => verifyRadarCursorV1(cursor, { ...scope, now }, []))
      .toThrow(/keyring/i);
  });
});

describe("Europe/Zurich calendar attribution", () => {
  it.each([
    ["2026-07-21T21:59:59.999Z", "2026-07-21"],
    ["2026-07-21T22:00:00.000Z", "2026-07-22"],
    ["2026-12-21T22:59:59.999Z", "2026-12-21"],
    ["2026-12-21T23:00:00.000Z", "2026-12-22"],
    ["2026-03-29T00:59:59.999Z", "2026-03-29"],
    ["2026-03-29T01:00:00.000Z", "2026-03-29"],
    ["2026-10-25T00:59:59.999Z", "2026-10-25"],
    ["2026-10-25T01:00:00.000Z", "2026-10-25"],
  ])("attributes %s to %s", (instant, date) => {
    expect(getRadarZurichCalendarDateV1(new Date(instant))).toBe(date);
  });

  it("returns exact half-open day windows across both DST transitions", () => {
    const spring = getRadarZurichCalendarDayWindowV1(
      new Date("2026-03-29T12:00:00.000Z"),
    );
    expect(spring).toEqual({
      calendarDate: "2026-03-29",
      start: new Date("2026-03-28T23:00:00.000Z"),
      end: new Date("2026-03-29T22:00:00.000Z"),
    });
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1_000);

    const autumn = getRadarZurichCalendarDayWindowV1(
      new Date("2026-10-25T12:00:00.000Z"),
    );
    expect(autumn).toEqual({
      calendarDate: "2026-10-25",
      start: new Date("2026-10-24T22:00:00.000Z"),
      end: new Date("2026-10-25T23:00:00.000Z"),
    });
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 60 * 60 * 1_000);
  });

  it("rejects an invalid clock", () => {
    expect(() => getRadarZurichCalendarDateV1(new Date(Number.NaN))).toThrow(/valid/i);
    expect(() => getRadarZurichCalendarDayWindowV1(new Date(Number.NaN))).toThrow(/valid/i);
  });
});
