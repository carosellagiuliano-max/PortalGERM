export interface CommuteDistanceInput {
  from: string;
  to: string;
}

export interface CommuteProvider {
  getDistanceKm(input: CommuteDistanceInput): Promise<number>;
}
