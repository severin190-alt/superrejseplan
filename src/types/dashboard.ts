import { PFMResult } from "./pfm";
import { IncidentCategory } from "./statusScraper";
import { StatusScrapeSource } from "./statusScraper";
import { Trip } from "./rejseplanen";

export type DashboardDestination = "WORK" | "HOME" | "SALSA";

export interface DashboardRoute {
  id: string;
  trip: Trip;
  pfm: PFMResult;
  officialETA: string;
  isBusOrMetroRoute: boolean;
  hasLiveBusRealtime: boolean;
  mapCoordinates: Array<{ lat: number; lng: number; label: string }>;
  liveVehicleCoordinate?: { lat: number; lng: number; label: string; estimated: boolean };
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
  /** Sandt når Google Directions afviser nøglen / quota (vis særskilt fejl, ikke “forældet data”). */
  googleConfigError?: boolean;
  /** Første fejl eller API-konfiguration — ikke det samme som “forældet data”. */
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
    /** Nedbørssandsynlighed 0–1 fra Google (time-slot). */
    precipitationProbability?: number;
    precipitationMm?: number;
    summary: string;
  };
  /** Aggregeret drift fra StatusScraperService (vises på dashboardet). */
  statusDigest?: {
    fetchedAt: string;
    summaryLines: string[];
    identifiedCauses: string[];
    salsaLineRisk: boolean;
    incidentCategory: IncidentCategory;
    /** Rå scraper-tekst til Navigator (Gemini), ikke kun opsummerede linjer. */
    rawScraperExcerpt: string;
    sourceLabels: Array<{ source: StatusScrapeSource; count: number; ok: boolean }>;
  };
  /** Google Directions: varighed og advarsler til Navigator (trafik vs. status-radar). */
  googleRouteContext?: GoogleRouteContext;
}
