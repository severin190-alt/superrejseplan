export type StatusScrapeSource =
  | "DSB_AKUT"
  | "METRO"
  | "RP_HOVEDSTADEN"
  | "RP_SJAELLAND"
  | "DSB_PLANLAGT"
  | "LOKALTOG_PLANLAGT"
  | "DOT_PLANLAGT";

export type IncidentCategory = "NONE" | "SHORT" | "LONG";

export interface StatusScrapeSection {
  source: StatusScrapeSource;
  sectionId?: string;
  text: string;
}

export interface RouteContextHit {
  stopName: string;
  source: StatusScrapeSource;
  rawExcerpt: string;
  incidentCategory: IncidentCategory;
}

export interface RouteContextResult {
  hits: RouteContextHit[];
  incidentCategory: IncidentCategory;
  identifiedCauses: string[];
  alarmActive: boolean;
}

export interface StatusScrapeReport {
  fetchedAt: string;
  sections: StatusScrapeSection[];
  errors: Array<{ source: StatusScrapeSource; message: string }>;
}
