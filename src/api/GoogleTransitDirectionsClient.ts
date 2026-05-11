import { TransitLeg, TransitMode, TransitTrip } from "../types/transit";
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
  vehicle?: { type?: string; name?: string };
  num_stops?: number;
};

type GoogleStep = {
  travel_mode: string;
  html_instructions?: string;
  distance?: { value: number; text?: string };
  duration?: { value: number; text?: string };
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

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePlatform(instructions: string): string | undefined {
  const match = instructions.match(/\b(?:perron|spor|platform)\s*([a-z0-9]+)/i);
  return match?.[1]?.toUpperCase();
}

function isTogbusContext(line: string, headsign: string): boolean {
  const blob = `${line} ${headsign}`.toLowerCase();
  return /\btogbus\b|\btog\s+bus\b|rail\s+replacement|erstatningsbus/.test(blob);
}

function mapVehicleType(vehicleType: string | undefined, line: string, headsign: string): TransitMode {
  if (isTogbusContext(line, headsign)) {
    return "TOGBUS";
  }
  const normalized = (vehicleType ?? "").toUpperCase();
  if (normalized.includes("SUBWAY") || normalized.includes("METRO")) return "METRO";
  if (normalized.includes("TRAIN") || normalized.includes("RAIL") || normalized.includes("TRAM")) return "TRAIN";
  if (normalized.includes("BUS")) return "BUS";
  if (normalized.includes("FERRY")) return "FERRY";
  return "OTHER";
}

export type TransitRoutingPreference = "LESS_WALKING" | "FEWER_TRANSFERS";

export type TransitTripBundle = {
  trip: TransitTrip;
  mapCoordinates: Array<{ lat: number; lng: number; label: string }>;
  journeyName?: string;
  durationSeconds: number;
  durationSummary: string;
  warnings: string[];
  routingPreference?: TransitRoutingPreference;
  hackerVariant?: "BUS" | "WAYPOINT_KOGE_NORD" | "WAYPOINT_VANLOSE";
};

type DirectionsQueryOptions = {
  routingPreference?: TransitRoutingPreference;
  transitMode?: "bus" | "rail" | "subway" | "train" | "tram";
  waypoint?: string;
};

export class GoogleTransitDirectionsClient {
  constructor(private readonly apiKey?: string) {}

  private resolveApiKey(): string {
    const key = this.apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!key) {
      throw new GoogleTransitDirectionsError(
        "Mangler NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Aktivér Directions API i Google Cloud og tilføj nøglen.",
        { kind: "config", status: "MISSING_KEY" }
      );
    }
    return key;
  }

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
    destination: string,
    options?: DirectionsQueryOptions
  ): Promise<TransitTripBundle[]> {
    const data = await this.fetchDirections(origin, destination, options);
    return data.routes?.map((route) => this.routeToBundle(route, options)) ?? [];
  }

  async getTransitTripVariants(
    origin: { lat: number; lng: number },
    destination: string,
    bottleneckMode: boolean
  ): Promise<TransitTripBundle[]> {
    const preferences: Array<DirectionsQueryOptions | undefined> = bottleneckMode
      ? [{}, { routingPreference: "LESS_WALKING" }, { routingPreference: "FEWER_TRANSFERS" }]
      : [{}];
    const settled = await Promise.allSettled(
      preferences.map((options) => this.getTransitTrips(origin, destination, options))
    );
    return this.mergeBundles(settled);
  }

  async getHackerTransitTrips(
    origin: { lat: number; lng: number },
    destination: string
  ): Promise<TransitTripBundle[]> {
    const variants: Array<{ options: DirectionsQueryOptions; hackerVariant: TransitTripBundle["hackerVariant"] }> = [
      { options: { transitMode: "bus" }, hackerVariant: "BUS" },
      { options: { waypoint: "Køge Nord St., Danmark" }, hackerVariant: "WAYPOINT_KOGE_NORD" },
      { options: { waypoint: "Vanløse St., Danmark" }, hackerVariant: "WAYPOINT_VANLOSE" }
    ];
    const settled = await Promise.allSettled(
      variants.map(async ({ options, hackerVariant }) => {
        const bundles = await this.getTransitTrips(origin, destination, options);
        return bundles.map((bundle) => ({ ...bundle, hackerVariant }));
      })
    );
    const merged = this.mergeBundles(
      settled.map((outcome) =>
        outcome.status === "fulfilled" ? { status: "fulfilled" as const, value: outcome.value } : outcome
      )
    );
    return merged;
  }

  private async fetchDirections(
    origin: { lat: number; lng: number },
    destination: string,
    options?: DirectionsQueryOptions
  ): Promise<GoogleDirectionsResponse> {
    const key = this.resolveApiKey();
    const originStr = `${origin.lat},${origin.lng}`;
    const departureTime = Math.floor(Date.now() / 1000);
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", originStr);
    url.searchParams.set("destination", destination);
    url.searchParams.set("mode", "transit");
    url.searchParams.set("departure_time", String(departureTime));
    url.searchParams.set("alternatives", "true");
    if (options?.routingPreference) {
      url.searchParams.set("transit_routing_preference", options.routingPreference);
    }
    if (options?.transitMode) {
      url.searchParams.set("transit_mode", options.transitMode);
    }
    if (options?.waypoint) {
      url.searchParams.set("waypoints", options.waypoint);
    }
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

    return data;
  }

  private mergeBundles(
    settled: Array<PromiseSettledResult<TransitTripBundle[]>>
  ): TransitTripBundle[] {
    const merged: TransitTripBundle[] = [];
    const seen = new Set<string>();
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      for (const bundle of outcome.value) {
        const key = bundle.trip.legs
          .map((leg) => `${leg.mode}:${leg.line}:${leg.departureStop}:${leg.arrivalStop}:${leg.instructions ?? ""}`)
          .join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(bundle);
      }
    }
    if (merged.length === 0) {
      const firstFailure = settled.find((o) => o.status === "rejected");
      if (firstFailure && firstFailure.status === "rejected") {
        throw firstFailure.reason;
      }
    }
    return merged.sort((a, b) => a.durationSeconds - b.durationSeconds);
  }

  private routeToBundle(route: GoogleRoute, options?: DirectionsQueryOptions): TransitTripBundle {
    const steps = route.legs.flatMap((l) => l.steps ?? []);
    const transitSteps = steps.filter((s) => s.travel_mode === "TRANSIT" && s.transit_details);
    const legs: TransitLeg[] = [];

    for (const step of steps) {
      if (step.travel_mode === "WALK") {
        const instructions = stripHtml(step.html_instructions ?? "Gang");
        const durationMinutes = Math.max(1, Math.round((step.duration?.value ?? 0) / 60));
        const walkDistanceMeters = step.distance?.value;
        legs.push({
          mode: "WALK",
          line: "Gang",
          departureStop: instructions,
          arrivalStop: instructions,
          durationMinutes,
          walkDistanceMeters,
          walkDistanceText: step.distance?.text,
          instructions
        });
        continue;
      }
      if (step.travel_mode !== "TRANSIT" || !step.transit_details) {
        continue;
      }
      const td = step.transit_details;
      const dep = td.departure_time?.value;
      const arr = td.arrival_time?.value;
      const depStr = typeof dep === "number" ? formatCopenhagenTime(dep) : undefined;
      const arrStr = typeof arr === "number" ? formatCopenhagenTime(arr) : undefined;
      const lineName = td.line?.short_name || td.line?.name || "Transit";
      const headsign = td.headsign ?? "";
      const durationMinutes = Math.max(1, Math.round((step.duration?.value ?? 0) / 60));
      const mode = mapVehicleType(td.vehicle?.type, lineName, headsign);
      const instructions = stripHtml(step.html_instructions ?? "");
      legs.push({
        mode,
        line: lineName,
        departureStop: td.departure_stop.name,
        arrivalStop: td.arrival_stop.name,
        durationMinutes,
        departureTime: depStr,
        arrivalTime: arrStr,
        headsign,
        departurePlatform: parsePlatform(instructions),
        instructions,
        hasLiveTiming: Boolean(depStr || arrStr)
      });
    }

    if (legs.length === 0 && route.legs[0]) {
      const gLeg = route.legs[0];
      const arr = gLeg.arrival_time?.value;
      const dep = gLeg.departure_time?.value;
      const depStr = typeof dep === "number" ? formatCopenhagenTime(dep) : undefined;
      const arrStr = typeof arr === "number" ? formatCopenhagenTime(arr) : undefined;
      const durationMinutes = Math.max(1, Math.round((gLeg.duration?.value ?? 0) / 60));
      legs.push({
        mode: "WALK",
        line: "Gang",
        departureStop: gLeg.start_address,
        arrivalStop: gLeg.end_address,
        durationMinutes,
        departureTime: depStr,
        arrivalTime: arrStr
      });
    }

    const journeyName = legs
      .filter((leg) => leg.mode !== "WALK")
      .map((leg) => leg.line)
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
      trip: { legs },
      mapCoordinates,
      journeyName: journeyName || undefined,
      durationSeconds,
      durationSummary,
      warnings,
      routingPreference: options?.routingPreference
    };
  }
}
