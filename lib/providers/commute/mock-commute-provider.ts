import type {
  CommuteDistanceInput,
  CommuteProvider,
} from "@/lib/providers/commute/commute-provider";

const EARTH_MEAN_RADIUS_KM = 6_371.0088;

export const MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH =
  "Ungefähre Luftliniendistanz anhand hinterlegter Stadtkoordinaten; keine Routen- oder Fahrzeitberechnung.";

export const MOCK_COMMUTE_POLICY_V1 = Object.freeze({
  method: "HAVERSINE_AIR_LINE" as const,
  earthRadiusKm: EARTH_MEAN_RADIUS_KM,
  approximate: true,
  performsNetworkRequests: false,
  notice: MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH,
});

export type CityCoordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type SeededCityCoordinate = Readonly<
  CityCoordinates & {
    cityId: string;
  }
>;

export type MockCommuteCoordinateSeed =
  | Readonly<Record<string, CityCoordinates>>
  | readonly SeededCityCoordinate[];

export class MockCommuteValidationError extends TypeError {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_CITY_ID"
    | "INVALID_COORDINATES"
    | "DUPLICATE_CITY_ID"
    | "CITY_COORDINATES_NOT_FOUND";

  constructor(code: MockCommuteValidationError["code"], message: string) {
    super(message);
    this.name = "MockCommuteValidationError";
    this.code = code;
  }
}

/**
 * Deterministic approximation from supplied/seeded coordinates. It deliberately
 * performs no maps request and does not claim route distance or travel time.
 */
export class MockCommuteProvider implements CommuteProvider {
  readonly #coordinates: ReadonlyMap<string, CityCoordinates>;

  constructor(seed: MockCommuteCoordinateSeed) {
    const entries: readonly (readonly [string, CityCoordinates])[] =
      Array.isArray(seed)
        ? seed.map((item) => [item.cityId, item] as const)
        : Object.entries(seed);
    const coordinates = new Map<string, CityCoordinates>();

    for (const [rawCityId, rawCoordinates] of entries) {
      const cityId = assertCityId(rawCityId);
      if (coordinates.has(cityId)) {
        throw new MockCommuteValidationError(
          "DUPLICATE_CITY_ID",
          "Mock commute seed contains a duplicate city identifier.",
        );
      }
      coordinates.set(cityId, validateCoordinates(rawCoordinates));
    }

    this.#coordinates = coordinates;
  }

  async getDistanceKm(input: CommuteDistanceInput): Promise<number> {
    assertExactDistanceInput(input);
    const fromId = assertCityId(input.from);
    const toId = assertCityId(input.to);
    const from = this.#coordinates.get(fromId);
    const to = this.#coordinates.get(toId);

    if (from === undefined || to === undefined) {
      throw new MockCommuteValidationError(
        "CITY_COORDINATES_NOT_FOUND",
        "No seeded coordinates are available for one or both cities.",
      );
    }
    if (fromId === toId) return 0;

    return haversineDistanceKm(from, to);
  }
}

export function haversineDistanceKm(
  from: CityCoordinates,
  to: CityCoordinates,
): number {
  const validatedFrom = validateCoordinates(from);
  const validatedTo = validateCoordinates(to);
  const fromLatitude = degreesToRadians(validatedFrom.latitude);
  const toLatitude = degreesToRadians(validatedTo.latitude);
  const latitudeDelta = toLatitude - fromLatitude;
  const longitudeDelta = degreesToRadians(
    validatedTo.longitude - validatedFrom.longitude,
  );
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));

  return (
    2 *
    MOCK_COMMUTE_POLICY_V1.earthRadiusKm *
    Math.atan2(
      Math.sqrt(boundedHaversine),
      Math.sqrt(1 - boundedHaversine),
    )
  );
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function assertCityId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new MockCommuteValidationError(
      "INVALID_CITY_ID",
      "City identifiers must be bounded opaque strings.",
    );
  }
  return value;
}

function validateCoordinates(value: unknown): CityCoordinates {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MockCommuteValidationError(
      "INVALID_COORDINATES",
      "City coordinates must contain valid latitude and longitude numbers.",
    );
  }
  const latitude = Reflect.get(value, "latitude");
  const longitude = Reflect.get(value, "longitude");
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new MockCommuteValidationError(
      "INVALID_COORDINATES",
      "City coordinates must contain valid latitude and longitude numbers.",
    );
  }
  return Object.freeze({ latitude, longitude });
}

function assertExactDistanceInput(
  input: unknown,
): asserts input is CommuteDistanceInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new MockCommuteValidationError(
      "INVALID_INPUT",
      "Mock commute input must be a city-pair object.",
    );
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(input, "from") ||
    !Object.prototype.hasOwnProperty.call(input, "to") ||
    keys.some((key) => key !== "from" && key !== "to")
  ) {
    throw new MockCommuteValidationError(
      "INVALID_INPUT",
      "Mock commute input contains unsupported fields.",
    );
  }
}
