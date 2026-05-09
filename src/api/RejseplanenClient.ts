import {
  DepartureBoardResponse,
  HIMResponse,
  JourneyDetailResponse,
  LocationResponse,
  RejseplanErrorPayload,
  TripResponse
} from "../types/rejseplanen";
import { REJSEPLANEN_BASE_URL, REJSEPLANEN_DEFAULT_QUERY } from "../config/constants";

export type RejseplanenProductsBitmask = number;

export class RejseplanenApiError extends Error {
  public readonly endpoint: string;
  public readonly details?: unknown;

  constructor(message: string, endpoint: string, details?: unknown) {
    super(message);
    this.name = "RejseplanenApiError";
    this.endpoint = endpoint;
    this.details = details;
  }
}

export class RejseplanenClient {
  constructor(private readonly baseUrl: string = REJSEPLANEN_BASE_URL) {}

  async getTrip(
    originId: string,
    destId: string,
    options?: { products?: RejseplanenProductsBitmask; useMetro?: boolean }
  ): Promise<TripResponse> {
    return this.get<TripResponse>("trip", {
      originId,
      destId,
      rtMode: "REALTIME",
      useBus: "1",
      useTrain: "1",
      useMetro: options?.useMetro === false ? "0" : "1",
      ...(typeof options?.products === "number" ? { products: String(options.products) } : {})
    });
  }

  async getLocation(query: string): Promise<LocationResponse> {
    return this.get<LocationResponse>("location", {
      input: query
    });
  }

  async getJourneyDetail(ref: string): Promise<JourneyDetailResponse> {
    const url = new URL(ref, this.baseUrl);
    url.searchParams.set("format", REJSEPLANEN_DEFAULT_QUERY.format);
    url.searchParams.set("lang", REJSEPLANEN_DEFAULT_QUERY.lang);
    return this.fetchAndValidate<JourneyDetailResponse>(url.toString(), "journeyDetail");
  }

  async getNearbyStopsByCoordinates(
    longitude: number,
    latitude: number,
    options?: { maxNo?: number }
  ): Promise<LocationResponse> {
    return this.get<LocationResponse>("location", {
      coordX: String(longitude),
      coordY: String(latitude),
      ...(typeof options?.maxNo === "number" ? { maxNo: String(options.maxNo) } : {})
    });
  }

  async getTrafficMessages(): Promise<HIMResponse> {
    return this.get<HIMResponse>("himSearch", {
      clientType: "WEB"
    });
  }

  async getDepartures(
    stationId: string,
    options?: { products?: RejseplanenProductsBitmask }
  ): Promise<DepartureBoardResponse> {
    return this.get<DepartureBoardResponse>("departureBoard", {
      id: stationId,
      "useS-train": "1",
      useBus: "1",
      ...(typeof options?.products === "number" ? { products: String(options.products) } : {})
    });
  }

  private async get<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    Object.entries({
      ...REJSEPLANEN_DEFAULT_QUERY,
      ...params
    }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return this.fetchAndValidate<T>(url.toString(), endpoint);
  }

  private async fetchAndValidate<T>(url: string, endpoint: string): Promise<T> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new RejseplanenApiError(
        `HTTP error from Rejseplanen API: ${response.status} ${response.statusText}`,
        endpoint
      );
    }

    const payload: unknown = await response.json();
    this.assertNoApiError(payload, endpoint);
    return payload as T;
  }

  private assertNoApiError(payload: unknown, endpoint: string): void {
    if (!payload || typeof payload !== "object") {
      throw new RejseplanenApiError("Invalid API payload: expected object", endpoint, payload);
    }

    const maybeErrorPayload = payload as Partial<RejseplanErrorPayload>;
    if (typeof maybeErrorPayload.error === "string") {
      const details =
        typeof maybeErrorPayload.errorText === "string"
          ? ` (${maybeErrorPayload.errorText})`
          : "";
      throw new RejseplanenApiError(
        `Rejseplanen API returned error: ${maybeErrorPayload.error}${details}`,
        endpoint,
        payload
      );
    }
  }
}
