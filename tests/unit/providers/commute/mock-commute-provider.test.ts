// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH,
  MOCK_COMMUTE_POLICY_V1,
  MockCommuteProvider,
  MockCommuteValidationError,
  createCommuteProvider,
  type CommuteDistanceInput,
} from "@/lib/providers/commute";

const cityCoordinates = {
  "city-zurich": { latitude: 47.3769, longitude: 8.5417 },
  "city-bern": { latitude: 46.948, longitude: 7.4474 },
  "city-geneva": { latitude: 46.2044, longitude: 6.1432 },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MockCommuteProvider", () => {
  it("returns a deterministic, symmetric straight-line approximation", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createCommuteProvider(cityCoordinates);

    const zurichToBern = await provider.getDistanceKm({
      from: "city-zurich",
      to: "city-bern",
    });
    const replay = await provider.getDistanceKm({
      from: "city-zurich",
      to: "city-bern",
    });
    const bernToZurich = await provider.getDistanceKm({
      from: "city-bern",
      to: "city-zurich",
    });

    expect(zurichToBern).toBe(replay);
    expect(zurichToBern).toBeCloseTo(95.1, 0);
    expect(bernToZurich).toBeCloseTo(zurichToBern, 10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns zero for the same seeded city", async () => {
    const provider = new MockCommuteProvider(cityCoordinates);
    await expect(
      provider.getDistanceKm({ from: "city-zurich", to: "city-zurich" }),
    ).resolves.toBe(0);
  });

  it("supports array-shaped deterministic seed fixtures", async () => {
    const provider = new MockCommuteProvider([
      { cityId: "city-zurich", latitude: 47.3769, longitude: 8.5417 },
      { cityId: "city-geneva", latitude: 46.2044, longitude: 6.1432 },
    ]);

    const distance = await provider.getDistanceKm({
      from: "city-zurich",
      to: "city-geneva",
    });
    expect(distance).toBeCloseTo(224.4, 0);
  });

  it("fails closed when one or both city coordinates are missing", async () => {
    const provider = new MockCommuteProvider(cityCoordinates);

    await expect(
      provider.getDistanceKm({ from: "city-zurich", to: "city-missing" }),
    ).rejects.toMatchObject({
      name: "MockCommuteValidationError",
      code: "CITY_COORDINATES_NOT_FOUND",
    });
    await expect(
      provider.getDistanceKm({ from: "city-missing", to: "city-missing" }),
    ).rejects.toBeInstanceOf(MockCommuteValidationError);
  });

  it("rejects invalid or duplicate coordinate seeds", () => {
    expect(
      () =>
        new MockCommuteProvider({
          invalid: { latitude: 91, longitude: 8.5 },
        }),
    ).toThrowError(MockCommuteValidationError);
    expect(
      () =>
        new MockCommuteProvider([
          { cityId: "duplicate", latitude: 47, longitude: 8 },
          { cityId: "duplicate", latitude: 46, longitude: 7 },
        ]),
    ).toThrowError(/duplicate city identifier/i);
  });

  it("rejects malformed or extended distance requests", async () => {
    const provider = new MockCommuteProvider(cityCoordinates);
    await expect(
      provider.getDistanceKm({ from: " city-zurich", to: "city-bern" }),
    ).rejects.toMatchObject({ code: "INVALID_CITY_ID" });

    const extended = {
      from: "city-zurich",
      to: "city-bern",
      transportMode: "car",
    } as unknown as CommuteDistanceInput;
    await expect(provider.getDistanceKm(extended)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("publishes an explicit German approximation limitation", () => {
    expect(MOCK_COMMUTE_POLICY_V1).toMatchObject({
      method: "HAVERSINE_AIR_LINE",
      approximate: true,
      performsNetworkRequests: false,
    });
    expect(MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH).toContain("Luftlinie");
    expect(MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH).toContain(
      "keine Routen- oder Fahrzeitberechnung",
    );
  });
});
