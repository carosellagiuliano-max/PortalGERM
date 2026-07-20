import type { CommuteProvider } from "@/lib/providers/commute/commute-provider";
import { MockCommuteProvider } from "@/lib/providers/commute/mock-commute-provider";
import type { MockCommuteCoordinateSeed } from "@/lib/providers/commute/mock-commute-provider";

export type {
  CommuteDistanceInput,
  CommuteProvider,
} from "@/lib/providers/commute/commute-provider";
export {
  MOCK_COMMUTE_APPROXIMATION_NOTICE_DE_CH,
  MOCK_COMMUTE_POLICY_V1,
  MockCommuteProvider,
  MockCommuteValidationError,
  haversineDistanceKm,
  type CityCoordinates,
  type MockCommuteCoordinateSeed,
  type SeededCityCoordinate,
} from "@/lib/providers/commute/mock-commute-provider";

export function createCommuteProvider(
  coordinates: MockCommuteCoordinateSeed,
): CommuteProvider {
  // Phase 05 will supply the reviewed city fixture. An empty singleton would
  // falsely imply useful distance behavior before those coordinates exist.
  return new MockCommuteProvider(coordinates);
}
