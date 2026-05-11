export type TransitMode = "TRAIN" | "METRO" | "BUS" | "TOGBUS" | "WALK" | "FERRY" | "OTHER";

export interface TransitLeg {
  mode: TransitMode;
  line: string;
  departureStop: string;
  arrivalStop: string;
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  headsign?: string;
  departurePlatform?: string;
  arrivalPlatform?: string;
  walkDistanceMeters?: number;
  walkDistanceText?: string;
  instructions?: string;
  hasLiveTiming?: boolean;
}

export interface TransitTrip {
  legs: TransitLeg[];
}

export interface StatusMessage {
  id?: string;
  header?: string;
  content?: string;
  rtPriority?: string;
  rtActualCalls?: string;
}
