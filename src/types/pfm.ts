import { Departure, HIMMessage, Trip } from "./rejseplanen";

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
  himMessages?: HIMMessage[];
  departures?: Departure[];
  incidentWindows?: PFMIncidentWindow[];
  now?: Date;
  journeyName?: string;
  scooterModeRequested?: boolean;
  weatherCondition?: string;
  /** Årsags-tags fra StatusScraperService (Signalfejl, Personpåkørsel, …). */
  statusIdentifiedCauses?: string[];
  /** Sættes når destination er salsa og M1/M2 eller S-tog C/H har aktiv forstyrrelse. */
  salsaRouteUnstable?: boolean;
  /** Incident duration-classifikation (fra alle scraper-kilder) for netop denne rute. */
  routeIncidentCategory?: "NONE" | "SHORT" | "LONG";
  /** Sand hvis ruten indeholder togbus-segmenter. */
  routeUsesTogbus?: boolean;
  /** Sand hvis ruten indeholder regulære buslinjer (ikke togbus). */
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

export interface DispositionRiskResult {
  highRisk: boolean;
  probability: number;
  reason: string;
}

export interface PFMEvaluationInput {
  trip: Trip;
  context?: PFMContext;
}
