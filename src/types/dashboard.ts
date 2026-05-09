import { PFMResult } from "./pfm";
import { Trip } from "./rejseplanen";

export type DashboardDestination = "WORK" | "HOME";

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

export interface PlannerResult {
  routes: DashboardRoute[];
  staleData: boolean;
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
    source: "HARD_CODED_REJSEKORT";
  };
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
