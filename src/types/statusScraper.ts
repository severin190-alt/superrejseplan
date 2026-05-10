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
  /** e.g. bus, metro, s-tog */
  sectionId?: string;
  text: string;
}

export interface StatusScrapeReport {
  fetchedAt: string;
  sections: StatusScrapeSection[];
  identifiedCauses: string[];
  incidentCategory: IncidentCategory;
  plannedAlerts: Array<{
    source: StatusScrapeSource;
    lineIds: string[];
    dateTokens: string[];
    category: IncidentCategory;
    text: string;
  }>;
  /** True when disruption wording affects M1/M2 or S-tog C/H (salsa / Vanløse relevance). */
  salsaLineRisk: boolean;
  errors: Array<{ source: StatusScrapeSource; message: string }>;
}
