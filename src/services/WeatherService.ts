type WeatherSnapshot = {
  source: "DMI_EDR" | "HIM_FALLBACK";
  stepTime?: string;
  lastUpdated: string;
  temperatureC?: number;
  windSpeedMps?: number;
  precipitationMm?: number;
  summary: string;
};

type DmiGeoJsonFeature = {
  properties?: Record<string, unknown> & {
    step?: string;
    "temperature-2m"?: number;
    "wind-speed-10m"?: number;
    "wind-speed"?: number;
    "precipitation-1h"?: number;
  };
};

type DmiGeoJsonResponse = {
  features?: DmiGeoJsonFeature[];
};

export class WeatherService {
  private static readonly BASE_URL = "https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position";
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly cache = new Map<string, { snapshot: WeatherSnapshot; createdAt: number }>();

  async getWeatherForPosition(lat: number, lng: number): Promise<WeatherSnapshot> {
    const cacheKey = this.getCacheKey(lat, lng);
    const nowMs = Date.now();
    const cacheHit = this.cache.get(cacheKey);
    if (cacheHit && nowMs - cacheHit.createdAt < WeatherService.CACHE_TTL_MS) {
      return cacheHit.snapshot;
    }

    try {
      const now = new Date();
      const from = now.toISOString();
      const to = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
      const coords = `POINT(${lng.toFixed(6)} ${lat.toFixed(6)})`;
      const query = new URLSearchParams({
        coords,
        crs: "crs84",
        f: "GeoJSON",
        "parameter-name": "temperature-2m,wind-speed-10m,precipitation-1h",
        datetime: `${from}/${to}`
      });

      const response = await fetch(`${WeatherService.BASE_URL}?${query.toString()}`, {
        headers: { Accept: "application/geo+json, application/json" },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`DMI EDR HTTP ${response.status}`);
      }

      const payload = (await response.json()) as DmiGeoJsonResponse;
      const feature = payload.features?.[0];
      if (!feature?.properties) {
        throw new Error("DMI EDR response missing weather properties");
      }

      const temperatureK = this.asNumber(feature.properties["temperature-2m"]);
      const wind = this.asNumber(feature.properties["wind-speed-10m"]) ?? this.asNumber(feature.properties["wind-speed"]);
      const precipitation = this.asNumber(feature.properties["precipitation-1h"]);
      const stepTime = typeof feature.properties.step === "string" ? feature.properties.step : undefined;
      const temperatureC = typeof temperatureK === "number" ? Number((temperatureK - 273.15).toFixed(1)) : undefined;
      const snapshot: WeatherSnapshot = {
        source: "DMI_EDR",
        stepTime,
        lastUpdated: this.toHHMMUtc(now),
        temperatureC,
        windSpeedMps: wind,
        precipitationMm: precipitation,
        summary: this.buildSummary(temperatureC, wind, precipitation)
      };
      this.cache.set(cacheKey, { snapshot, createdAt: nowMs });

      return snapshot;
    } catch {
      const fallback: WeatherSnapshot = {
        source: "HIM_FALLBACK",
        lastUpdated: this.toHHMMUtc(new Date(nowMs)),
        summary: "DMI-vejr utilgængeligt. Falder tilbage til signaler fra trafikhændelser."
      };
      this.cache.set(cacheKey, { snapshot: fallback, createdAt: nowMs });
      return fallback;
    }
  }

  private buildSummary(temperatureC?: number, windSpeedMps?: number, precipitationMm?: number): string {
    const parts: string[] = [];
    if (typeof temperatureC === "number") parts.push(`${temperatureC.toFixed(1)}C`);
    if (typeof windSpeedMps === "number") parts.push(`vind ${windSpeedMps.toFixed(1)} m/s`);
    if (typeof precipitationMm === "number") parts.push(`nedbor ${precipitationMm.toFixed(1)} mm/h`);
    return parts.length > 0 ? parts.join(", ") : "Ingen vejrparametre i DMI-svar.";
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private toHHMMUtc(date: Date): string {
    const h = String(date.getUTCHours()).padStart(2, "0");
    const m = String(date.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  private getCacheKey(lat: number, lng: number): string {
    return `${lat.toFixed(3)},${lng.toFixed(3)}`;
  }
}

export type { WeatherSnapshot };
