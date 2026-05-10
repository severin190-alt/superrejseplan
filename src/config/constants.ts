export const FIXED_LOCATIONS = {
  WORK: "Rådhusbuen 1A, 4000 Roskilde",
  HOME: "Doris Lessings Vej 47c, 2300 København S"
} as const;

/** Vanløse St. — salsa-destination */
export const SALSA_DESTINATION = {
  lat: 55.687,
  lng: 12.491,
  label: "Vanløse St."
} as const;

export const FIXED_LOCATION_IDS: Record<keyof typeof FIXED_LOCATIONS, string | null> = {
  WORK: null,
  HOME: null
};
