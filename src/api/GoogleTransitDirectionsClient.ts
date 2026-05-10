import { Leg, Trip } from "../types/rejseplanen";
import { FIXED_LOCATIONS } from "../config/constants";

type GoogleLatLng = { lat: number; lng: number };

type GoogleTimeValue = { value: number; text?: string };

type GoogleStop = { name: string; location: { lat: number; lng: number } };

type GoogleTransitDetails = {
  departure_stop: GoogleStop;
  arrival_stop: GoogleStop;
  departure_time?: GoogleTimeValue;
  arrival_time?: GoogleTimeValue;
  line?: { name?: string; short_name?: string };
  headsign?: string;
};

type GoogleStep = {
  travel_mode: string;
  html_instructions?: string;
  transit_details?: GoogleTransitDetails;
};

type GoogleLeg = {
  start_address: string;
  end_address: string;
  steps: GoogleStep[];
  arrival_time?: GoogleTimeValue;
  departure_time?: GoogleTimeValue;
  duration?: { value: number; text: string };
};

type GoogleRoute = {
  legs: GoogleLeg[];
  overview_polyline?: { points: string };
  warnings?: string[];
};

type GoogleDirectionsResponse = {
  status: string;
  error_message?: string;
  routes?: GoogleRoute[];
};

export type DirectionsAccessGate =
  | { ok: true }
  | { ok: false; status: string; message: string };

export class GoogleTransitDirectionsError extends Error {
  readonly status?: string;
  readonly kind: "config" | "generic";

  constructor(message: string, options?: { status?: string; kind?: "config" | "generic" }) {
    super(message);
    this.name = "GoogleTransitDirectionsError";
    this.status = options?.status;
    this.kind = options?.kind ?? "generic";
  }
}

export function decodeGooglePolyline(encoded: string): GoogleLatLng[] {
  const coordinates: GoogleLatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;
    coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coordinates;
}

function formatCopenhagenTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Copenhagen"
  });
}

function isGoogleConfigFailureStatus(status: string): boolean {
  return status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT";
}

export type TransitTripBundle = {
  trip: Trip;
  mapCoordinates: Array<{ lat: number; lng: number; label: string }>;
  journeyName?: string;
  durationSeconds: number;
  durationSummary: string;
  warnings: string[];
};

export class GoogleTransitDirectionsClient {
  constructor(private readonly apiKey?: string) {}

  /**
   * Intern sanity-check: samme nøgle skal kunne hente transit fra hjem-adresse til Roskilde St.
   */
  async verifyDirectionsAccess(): Promise<DirectionsAccessGate> {
    const key = this.apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!key) {
      return {
        ok: false,
        status: "MISSING_KEY",
        message: "Mangler NEXT_PUBLIC_GOOGLE_MAPS_API_KEY."
      };
    }

    const departureTime = Math.floor(Date.now() / 1000);
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", FIXED_LOCATIONS.HOME);
    url.searchParams.set("destination", "Roskilde St., Danmark");
    url.searchParams.set("mode", "transit");
    url.searchParams.set("departure_time", String(departureTime));
    url.searchParams.set("language", "da");
    url.searchParams.set("region", "dk");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = (await res.json()) as GoogleDirectionsResponse;

    if (isGoogleConfigFailureStatus(data.status)) {
      return {
        ok: false,
        status: data.status,
        message: data.error_message || data.status
      };
    }

    return { ok: true };
  }

  async getTransitTrips(
    origin: { lat: number; lng: number },
    destination: string
  ): Promise<TransitTripBundle[]> {
    const key = this.apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!key) {
      throw new GoogleTransitDirectionsError(
        "Mangler NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Aktivér Directions API i Google Cloud og tilføj nøglen.",
        { kind: "config", status: "MISSING_KEY" }
      );
    }
    const originStr = `${origin.lat},${origin.lng}`;
    const departureTime = Math.floor(Date.now() / 1000);
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", originStr);
    url.searchParams.set("destination", destination);
    url.searchParams.set("mode", "transit");
    url.searchParams.set("departure_time", String(departureTime));
    url.searchParams.set("alternatives", "true");
    url.searchParams.set("language", "da");
    url.searchParams.set("region", "dk");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    const data = (await res.json()) as GoogleDirectionsResponse;

    if (data.status !== "OK" || !data.routes?.length) {
      const msg = data.error_message || `Google Directions: ${data.status ?? "ukendt fejl"}`;
      if (isGoogleConfigFailureStatus(data.status)) {
        throw new GoogleTransitDirectionsError(msg, { status: data.status, kind: "config" });
      }
      throw new GoogleTransitDirectionsError(msg, { status: data.status, kind: "generic" });
    }

    return data.routes.map((route) => this.routeToBundle(route));
  }

  private routeToBundle(route: GoogleRoute): TransitTripBundle {
    const steps = route.legs.flatMap((l) => l.steps ?? []);
    const transitSteps = steps.filter((s) => s.travel_mode === "TRANSIT" && s.transit_details);

    const legs: Leg[] = transitSteps.map((step) => {
      const td = step.transit_details!;
      const dep = td.departure_time?.value;
      const arr = td.arrival_time?.value;
      const depStr = typeof dep === "number" ? formatCopenhagenTime(dep) : undefined;
      const arrStr = typeof arr === "number" ? formatCopenhagenTime(arr) : undefined;
      const lineName = td.line?.short_name || td.line?.name || "Transit";
      const headsign = td.headsign ?? "";
      const note = `${lineName}${headsign ? ` · ${headsign}` : ""}`.trim();
      return {
        Origin: {
          name: td.departure_stop.name,
          time: depStr,
          rtTime: depStr
        },
        Destination: {
          name: td.arrival_stop.name,
          time: arrStr,
          rtTime: arrStr
        },
        Notes: {
          Note: [{ value: note }]
        },
        rtDepartureTime: depStr,
        rtArrivalTime: arrStr
      };
    });

    if (legs.length === 0 && route.legs[0]) {
      const gLeg = route.legs[0];
      const arr = gLeg.arrival_time?.value;
      const dep = gLeg.departure_time?.value;
      const depStr = typeof dep === "number" ? formatCopenhagenTime(dep) : undefined;
      const arrStr = typeof arr === "number" ? formatCopenhagenTime(arr) : undefined;
      legs.push({
        Origin: { name: gLeg.start_address, time: depStr, rtTime: depStr },
        Destination: { name: gLeg.end_address, time: arrStr, rtTime: arrStr },
        Notes: {
          Note: [{ value: "Gang / lokal transport (Google)" }]
        },
        rtDepartureTime: depStr,
        rtArrivalTime: arrStr
      });
    }

    const journeyName = transitSteps
      .map((s) => {
        const td = s.transit_details!;
        return td.line?.short_name || td.line?.name || "";
      })
      .filter(Boolean)
      .join(" → ");

    const durationSeconds = route.legs.reduce((sum, l) => sum + (l.duration?.value ?? 0), 0);
    const durationSummary =
      route.legs
        .map((l) => l.duration?.text)
        .filter(Boolean)
        .join(" → ") ||
      (durationSeconds > 0 ? `ca. ${Math.max(1, Math.round(durationSeconds / 60))} min` : "");

    const warnings = route.warnings ?? [];

    const poly = route.overview_polyline?.points;
    let mapCoordinates: Array<{ lat: number; lng: number; label: string }> = [];
    if (poly) {
      mapCoordinates = decodeGooglePolyline(poly).map((c, i) => ({
        ...c,
        label: i === 0 ? "Start" : "Rute"
      }));
    }
    if (mapCoordinates.length === 0 && transitSteps.length > 0) {
      const pts: Array<{ lat: number; lng: number; label: string }> = [];
      for (const s of transitSteps) {
        const td = s.transit_details!;
        pts.push({
          lat: td.departure_stop.location.lat,
          lng: td.departure_stop.location.lng,
          label: td.departure_stop.name
        });
      }
      const lastTd = transitSteps[transitSteps.length - 1]!.transit_details!;
      pts.push({
        lat: lastTd.arrival_stop.location.lat,
        lng: lastTd.arrival_stop.location.lng,
        label: lastTd.arrival_stop.name
      });
      mapCoordinates = pts;
    }

    return {
      trip: { Leg: legs.length === 1 ? legs[0] : legs },
      mapCoordinates,
      journeyName: journeyName || undefined,
      durationSeconds,
      durationSummary,
      warnings
    };
  }
}
