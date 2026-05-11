import { StatusMessage, TransitTrip } from "./transit";

export type PFMStatus = "GREEN" | "YELLOW" | "RED";
export type CrowdingLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PFMResult {
  officialETA: string;
  pfmETA: string;
  delayReason: string;
  reliabilityScore: number;
  status: PFMStatus;
  suggestBusAlternative: boolean;
  unstable: boolean;
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
  statusMessages?: StatusMessage[];
  incidentWindows?: PFMIncidentWindow[];
  now?: Date;
  journeyName?: string;
  scooterModeRequested?: boolean;
  weatherCondition?: string;
  statusIdentifiedCauses?: string[];
  salsaRouteUnstable?: boolean;
  routeIncidentCategory?: "NONE" | "SHORT" | "LONG";
  routeUsesTogbus?: boolean;
  routeUsesRegularBus?: boolean;
  weatherSnapshot?: {
    source: "GOOGLE_WEATHER" | "WEATHER_FALLBACK";
    stepTime?: string;
    lastUpdated: string;
    temperatureC?: number;
    windSpeedMps?: number;
    precipitationProbability?: number;
    precipitationMm?: number;
    summary: string;
  };
}

export interface PFMEvaluationInput {
  trip: TransitTrip;
  context?: PFMContext;
}
