import { Departure, HIMMessage, Trip } from "./rejseplanen";

export type PFMStatus = "GREEN" | "YELLOW" | "RED";
export type CrowdingLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PFMResult {
  officialETA: string;
  pfmETA: string;
  delayReason: string;
  reliabilityScore: number;
  status: PFMStatus;
  suggestBusAlternative?: boolean;
  unstable?: boolean;
  isFavoriteRoute: boolean;
  crowdingLevel: CrowdingLevel;
  scooterOption: {
    feasible: boolean;
    weatherWarning: boolean;
  };
}

export interface PFMIncidentWindow {
  incidentStartTime: string;
  incidentResolvedTime?: string;
  routeHint?: string;
}

export interface PFMContext {
  himMessages?: HIMMessage[];
  departures?: Departure[];
  incidentWindows?: PFMIncidentWindow[];
  now?: Date;
  journeyName?: string;
  scooterModeRequested?: boolean;
  weatherCondition?: string;
  weatherSnapshot?: {
    source: "DMI_EDR" | "HIM_FALLBACK";
    stepTime?: string;
    lastUpdated: string;
    temperatureC?: number;
    windSpeedMps?: number;
    precipitationMm?: number;
    summary: string;
  };
}

export interface DispositionRiskResult {
  highRisk: boolean;
  probability: number;
  reason: string;
}

export interface PFMEvaluationInput {
  trip: Trip;
  context?: PFMContext;
}
