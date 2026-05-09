/** Rejseplanen API 2.0 (xmlopen.rejseplanen.dk is deprecated — returns HTML). */
export const REJSEPLANEN_BASE_URL = "https://www.rejseplanen.dk/api/";

export const REJSEPLANEN_DEFAULT_QUERY = {
  format: "json",
  lang: "da"
} as const;

export const FIXED_LOCATIONS = {
  WORK: "Rådhusbuen 1A, 4000 Roskilde",
  HOME: "Doris Lessings Vej 47c, 2300 København S"
} as const;

export const FIXED_LOCATION_IDS: Record<keyof typeof FIXED_LOCATIONS, string | null> = {
  WORK: null,
  HOME: null
};
