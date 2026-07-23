import {
  JOBROOM_FIXTURE_IDS,
  JOBROOM_LEGAL_DISCLAIMER,
  JOBROOM_OFFICIAL_SOURCE_URL,
  OCCUPATION_CODES_2026_FIXTURE,
  type OccupationCodeDatasetFixture,
} from "@/lib/providers/jobroom/fixtures/occupation-codes-2026";
import { jobroomProvider, MockJobroomProvider } from "@/lib/providers/jobroom";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function provider(at = NOW) {
  return new MockJobroomProvider({ now: () => new Date(at) });
}

function metadata() {
  return {
    disclaimer: JOBROOM_LEGAL_DISCLAIMER,
    datasetVersion: OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
    dataYear: OCCUPATION_CODES_2026_FIXTURE.dataYear,
    sourceUrl: JOBROOM_OFFICIAL_SOURCE_URL,
  };
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    ...OCCUPATION_CODES_2026_FIXTURE,
    occupationCodes: OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(
      (occupationCode) => ({ ...occupationCode }),
    ),
    ...overrides,
  };
}

function fixtureEntry(overrides: Record<string, unknown> = {}) {
  const source = OCCUPATION_CODES_2026_FIXTURE.occupationCodes[0];
  if (!source) {
    throw new Error("The Jobroom fixture must contain a test occupation.");
  }
  return { ...source, ...overrides };
}

async function checkInjectedFixture(runtimeFixture: unknown) {
  return new MockJobroomProvider({
    fixture: runtimeFixture as OccupationCodeDatasetFixture,
    now: () => new Date(NOW),
  }).checkReportingObligation({
    occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
  });
}

describe("MockJobroomProvider", () => {
  it("is selected explicitly by the composition root", () => {
    expect(jobroomProvider).toBeInstanceOf(MockJobroomProvider);
  });

  it("keeps fixture identifiers seed-compatible and unique", () => {
    const ids = OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(({ id }) => id);
    const codes = OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(({ code }) => code);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each([
    [JOBROOM_FIXTURE_IDS.requiresReporting, "REQUIRES_REPORTING", "REPORTING_REQUIRED"],
    [JOBROOM_FIXTURE_IDS.notRequired, "NOT_REQUIRED", "REPORTING_NOT_REQUIRED"],
    [JOBROOM_FIXTURE_IDS.sourceUnknown, "UNKNOWN", "SOURCE_RESULT_UNKNOWN"],
  ] as const)(
    "returns the fixture tri-state for %s",
    async (occupationCodeId, result, reasonCode) => {
      await expect(
        provider().checkReportingObligation({ occupationCodeId, cantonCode: "zh" }),
      ).resolves.toEqual({ result, reasonCode, ...metadata() });
    },
  );

  it("resolves the canonical occupation code independently of database identifiers", async () => {
    await expect(
      provider().checkReportingObligation({
        occupationCode: "mock-chisco-0002",
        cantonCode: "zh",
      }),
    ).resolves.toEqual({
      result: "NOT_REQUIRED",
      reasonCode: "REPORTING_NOT_REQUIRED",
      ...metadata(),
    });
  });

  it.each([
    [{}, "MISSING_OCCUPATION_CODE"],
    [{ occupationCodeId: "   " }, "MISSING_OCCUPATION_CODE"],
    [
      { occupationCodeId: "00000000-0000-4000-8000-000000000000" },
      "OCCUPATION_CODE_NOT_FOUND",
    ],
    [
      { occupationCodeId: JOBROOM_FIXTURE_IDS.ambiguous },
      "AMBIGUOUS_OCCUPATION_CODE",
    ],
    [
      { occupationCodeId: JOBROOM_FIXTURE_IDS.stale },
      "STALE_OCCUPATION_CODE",
    ],
    [
      { occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired, cantonCode: "XX" },
      "UNSUPPORTED_CANTON",
    ],
  ] as const)("fails closed for %o", async (input, reasonCode) => {
    const result = await provider().checkReportingObligation(input);

    expect(result).toEqual({
      result: "UNKNOWN",
      reasonCode,
      ...metadata(),
    });
    expect(result.result).not.toBe("NOT_REQUIRED");
  });

  it.each([
    null,
    [],
    "not-an-object",
    { occupationCodeId: 42 },
    { occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired, unexpected: true },
    { occupationCodeId: `${JOBROOM_FIXTURE_IDS.notRequired}\u0000` },
    { occupationCodeId: "x".repeat(10_000) },
    {
      occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
      occupationCode: "MOCK-CHISCO-0002",
    },
    { occupationCode: "nicht gültig" },
    { occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired, cantonCode: 42 },
    { occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired, cantonCode: "Z\u0000" },
  ])("rejects malformed runtime input without throwing: %o", async (runtimeInput) => {
    const result = await provider().checkReportingObligation(
      runtimeInput as unknown as {
        occupationCodeId?: string;
        occupationCode?: string;
        cantonCode?: string;
      },
    );

    expect(result).toEqual({
      result: "UNKNOWN",
      reasonCode: "INVALID_INPUT",
      ...metadata(),
    });
  });

  it("rejects accessor and symbol fields without evaluating content", async () => {
    const getter = vi.fn(() => JOBROOM_FIXTURE_IDS.notRequired);
    const accessorInput = Object.defineProperty({}, "occupationCodeId", { get: getter });
    const symbolInput = {
      occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
      [Symbol("extra")]: true,
    };

    const accessorResult = await provider().checkReportingObligation(accessorInput);
    const symbolResult = await provider().checkReportingObligation(symbolInput);

    expect(accessorResult.reasonCode).toBe("INVALID_INPUT");
    expect(symbolResult.reasonCode).toBe("INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ["null fixture", (): unknown => null],
    ["non-object fixture", (): unknown => "invalid"],
    ["missing dataset field", () => {
      const { datasetVersion: _removed, ...invalid } = fixture();
      return invalid;
    }],
    ["extra dataset field", () => fixture({ extra: true })],
    ["invalid dataset key", () => fixture({ datasetKey: "jobroom lower" })],
    ["oversized version", () => fixture({ datasetVersion: "v".repeat(33) })],
    ["non-integer year", () => fixture({ dataYear: 2026.5 })],
    ["out-of-range year", () => fixture({ dataYear: 2200 })],
    ["unreviewed source", () => fixture({ source: "Unreviewed fixture" })],
    ["changed legal disclaimer", () => fixture({ disclaimer: "Keine Gewähr." })],
    ["HTTP source", () => fixture({
      sourceUrl: "http://www.arbeit.swiss/de/arbeitgebende/stellenmeldepflicht-2026",
    })],
    ["unofficial source", () => fixture({
      sourceUrl: "https://arbeit.swiss.attacker.example/de/arbeitgebende/stellenmeldepflicht-2026",
    })],
    ["credential-bearing source", () => fixture({
      sourceUrl: "https://user:secret@www.arbeit.swiss/de/arbeitgebende/stellenmeldepflicht-2026",
    })],
    ["source query", () => fixture({
      sourceUrl: `${JOBROOM_OFFICIAL_SOURCE_URL}?redirect=attacker`,
    })],
    ["invalid dataset start", () => fixture({ validFrom: "not-a-date" })],
    ["reversed dataset window", () => fixture({
      validFrom: "2027-01-01T00:00:00.000Z",
      validTo: "2026-01-01T00:00:00.000Z",
    })],
    ["year-misaligned window", () => fixture({
      validFrom: "2026-02-01T00:00:00.000Z",
    })],
    ["occupationCodes not an array", () => fixture({ occupationCodes: {} })],
    ["empty occupationCodes", () => fixture({ occupationCodes: [] })],
    ["oversized occupationCodes", () => fixture({
      occupationCodes: Array.from({ length: 10_001 }, () => fixtureEntry()),
    })],
    ["non-object occupation entry", () => fixture({ occupationCodes: [null] })],
    ["entry with extra field", () => fixture({
      occupationCodes: [fixtureEntry({ extra: true })],
    })],
    ["invalid occupation id", () => fixture({
      occupationCodes: [fixtureEntry({ id: "not-a-uuid" })],
    })],
    ["invalid occupation code", () => fixture({
      occupationCodes: [fixtureEntry({ code: "bad code" })],
    })],
    ["oversized occupation label", () => fixture({
      occupationCodes: [fixtureEntry({ label: "x".repeat(256) })],
    })],
    ["unsupported result enum", () => fixture({
      occupationCodes: [fixtureEntry({ result: "MAYBE" })],
    })],
    ["unsupported classification enum", () => fixture({
      occupationCodes: [fixtureEntry({ classificationStatus: "UNCERTAIN" })],
    })],
    ["ambiguous not-required record", () => fixture({
      occupationCodes: [fixtureEntry({
        classificationStatus: "AMBIGUOUS",
        result: "NOT_REQUIRED",
      })],
    })],
    ["invalid occupation window", () => fixture({
      occupationCodes: [fixtureEntry({ effectiveTo: "invalid" })],
    })],
    ["reversed occupation window", () => fixture({
      occupationCodes: [fixtureEntry({
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        effectiveTo: "2026-02-01T00:00:00.000Z",
      })],
    })],
    ["duplicate occupation ids", () => {
      const first = fixtureEntry();
      return fixture({
        occupationCodes: [
          first,
          fixtureEntry({ id: first.id, code: "MOCK-SECOND-001" }),
        ],
      });
    }],
    ["duplicate occupation codes", () => {
      const first = fixtureEntry();
      return fixture({
        occupationCodes: [
          first,
          fixtureEntry({
            id: "b7b7d035-6fd5-4f9c-8f31-000000000099",
            code: first.code,
          }),
        ],
      });
    }],
  ] as const)("fails closed for malformed fixture: %s", async (_name, createFixture) => {
    const result = await checkInjectedFixture(createFixture());

    expect(result).toEqual({
      result: "UNKNOWN",
      reasonCode: "INVALID_FIXTURE_DATA",
      ...metadata(),
    });
    expect(result.result).not.toBe("NOT_REQUIRED");
  });

  it("rejects throwing fixture accessors and proxies without evaluating content", async () => {
    const getter = vi.fn(() => "NOT_REQUIRED");
    const accessorEntry = Object.defineProperty(
      fixtureEntry(),
      "result",
      { configurable: true, enumerable: true, get: getter },
    );
    const throwingProxy = new Proxy({}, {
      ownKeys() {
        throw new Error("fixture-secret-must-not-escape");
      },
    });

    const [accessorResult, proxyResult] = await Promise.all([
      checkInjectedFixture(fixture({ occupationCodes: [accessorEntry] })),
      checkInjectedFixture(throwingProxy),
    ]);

    expect(accessorResult.reasonCode).toBe("INVALID_FIXTURE_DATA");
    expect(proxyResult.reasonCode).toBe("INVALID_FIXTURE_DATA");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ["throwing clock", (): unknown => {
      throw new Error("clock-secret-must-not-escape");
    }],
    ["invalid Date", (): unknown => new Date("invalid")],
    ["non-Date value", (): unknown => "2026-07-20"],
  ] as const)("fails closed for %s", async (_name, runtimeClock) => {
    const result = await new MockJobroomProvider({
      now: runtimeClock as unknown as () => Date,
    }).checkReportingObligation({
      occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
    });

    expect(result).toEqual({
      result: "UNKNOWN",
      reasonCode: "INVALID_FIXTURE_DATA",
      ...metadata(),
    });
  });

  it("treats an expired dataset as unknown, never as not required", async () => {
    const result = await provider(new Date("2027-01-01T00:00:00.000Z"))
      .checkReportingObligation({
        occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
      });

    expect(result).toEqual({
      result: "UNKNOWN",
      reasonCode: "STALE_DATASET",
      ...metadata(),
    });
  });

  it("carries the identical legal metadata on every result path", async () => {
    const inputs = [
      { occupationCodeId: JOBROOM_FIXTURE_IDS.requiresReporting },
      { occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired },
      { occupationCodeId: JOBROOM_FIXTURE_IDS.sourceUnknown },
      { occupationCodeId: JOBROOM_FIXTURE_IDS.ambiguous },
      { occupationCodeId: JOBROOM_FIXTURE_IDS.stale },
      {},
    ];

    const results = await Promise.all(
      inputs.map((input) => provider().checkReportingObligation(input)),
    );
    for (const result of results) {
      expect(result).toMatchObject(metadata());
      expect(result.disclaimer).toBe(JOBROOM_LEGAL_DISCLAIMER);
    }
  });

  it("returns the immutable MVP sentinel and performs no external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = provider();

    await adapter.checkReportingObligation({
      occupationCodeId: JOBROOM_FIXTURE_IDS.requiresReporting,
    });
    const submission = await adapter.submitJob({ privateJobContent: "nicht senden" });

    expect(submission).toEqual({
      accepted: false,
      reason: "not_implemented_in_mvp",
    });
    expect(Object.isFrozen(submission)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
