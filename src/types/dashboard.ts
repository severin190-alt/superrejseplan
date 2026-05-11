import { PFMResult } from "./pfm";
import { IncidentCategory, RouteContextHit, StatusScrapeSource } from "./statusScraper";
import { TransitTrip } from "./transit";

export type DashboardDestination = "WORK" | "HOME" | "SALSA";

export interface DashboardRoute {
  id: string;
  trip: TransitTrip;
  pfm: PFMResult;
  officialETA: string;
  isBusOrMetroRoute: boolean;
  hasLiveBusRealtime: boolean;
  isHackerRoute: boolean;
  mapCoordinates: Array<{ lat: number; lng: number; label: string }>;
}

export interface GoogleRouteInsight {
  durationSummary: string;
  durationMinutes: number;
  warnings: string[];
}

export interface GoogleRouteContext {
  routes: GoogleRouteInsight[];
}

export interface PlannerResult {
  routes: DashboardRoute[];
  staleData: boolean;
  googleConfigError?: boolean;
  loadError?: string;
  staleMessage?: string;
  dataTimestamp?: string;
  staleForMs?: number;
  strategicWait?: string;
  useMetro: "0" | "1";
  scooterWeatherWarning: boolean;
  crowdingSnapshot?: {
    level: "LOW" | "MEDIUM" | "HIGH";
    tripsPerHour: number;
    weekday: number;
    hour: number;
    source: "CROWDING_MODEL_ESTIMATE";
  };
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
  statusDigest?: {
    fetchedAt: string;
    summaryLines: string[];
    identifiedCauses: string[];
    incidentCategory: IncidentCategory;
    rawScraperExcerpt: string;
    sourceLabels: Array<{ source: StatusScrapeSource; count: number; ok: boolean }>;
    bottleneckAlarm?: {
      active: boolean;
      stations: string[];
      triggerSource: StatusScrapeSource;
      rawText: string;
    };
    routeContextHits: RouteContextHit[];
    bottleneckMode: boolean;
  };
  googleRouteContext?: GoogleRouteContext;
}
