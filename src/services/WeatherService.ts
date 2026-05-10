type WeatherSnapshot = {
  source: "GOOGLE_WEATHER" | "WEATHER_FALLBACK";
  stepTime?: string;
  lastUpdated: string;
  temperatureC?: number;
  windSpeedMps?: number;
  /** 0–1 (Google probability.percent / 100). */
  precipitationProbability?: number;
  precipitationMm?: number;
  summary: string;
};

type GoogleForecastHour = {
  interval?: { startTime?: string };
  temperature?: { degrees?: number; unit?: string };
  precipitation?: {
    probability?: { percent?: number };
    qpf?: { quantity?: number; unit?: string };
  };
  wind?: {
    speed?: { value?: number; unit?: string };
    gust?: { value?: number; unit?: string };
  };
  weatherCondition?: {
    description?: { text?: string };
    type?: string;
  };
};

type GoogleForecastResponse = {
  forecastHours?: GoogleForecastHour[];
  error?: { code?: number; message?: string; status?: string };
};

export class WeatherService {
  private static readonly FORECAST_URL = "https://weather.googleapis.com/v1/forecast/hours:lookup";
  private static readonly SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly FALLBACK_CACHE_TTL_MS = 30 * 1000;
  private readonly cache = new Map<string, { snapshot: WeatherSnapshot; createdAt: number; ttlMs: number }>();

  async getWeatherForPosition(lat: number, lng: number): Promise<WeatherSnapshot> {
    const cacheKey = this.getCacheKey(lat, lng);
    const nowMs = Date.now();
    const cacheHit = this.cache.get(cacheKey);
    if (cacheHit && nowMs - cacheHit.createdAt < cacheHit.ttlMs) {
      return cacheHit.snapshot;
    }

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!key) {
      return this.setFallback(cacheKey, nowMs, "Mangler NEXT_PUBLIC_GOOGLE_MAPS_API_KEY til vejr.");
    }

    try {
      const url = new URL(WeatherService.FORECAST_URL);
      url.searchParams.set("key", key);
      url.searchParams.set("location.latitude", String(lat));
      url.searchParams.set("location.longitude", String(lng));
      url.searchParams.set("hours", "1");

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 }
      });

      const payload = (await response.json()) as GoogleForecastResponse;
      if (!response.ok || payload.error) {
        const msg = payload.error?.message ?? `HTTP ${response.status}`;
        throw new Error(msg);
      }

      const hour = payload.forecastHours?.[0];
      if (!hour) {
        throw new Error("Google Weather: tom forecastHours");
      }

      const temperatureC = this.readCelsius(hour.temperature);
      const precipitationMm = hour.precipitation?.qpf?.quantity;
      const probPercent = hour.precipitation?.probability?.percent;
      const precipitationProbability =
        typeof probPercent === "number" && Number.isFinite(probPercent)
          ? Math.min(1, Math.max(0, probPercent / 100))
          : undefined;
      const windMps = this.windToMetersPerSecond(hour.wind);

      const now = new Date(nowMs);
      const snapshot: WeatherSnapshot = {
        source: "GOOGLE_WEATHER",
        stepTime: hour.interval?.startTime,
        lastUpdated: this.toHHMMUtc(now),
        temperatureC,
        windSpeedMps: windMps,
        precipitationProbability,
        precipitationMm: typeof precipitationMm === "number" ? precipitationMm : undefined,
        summary: this.buildSummary(
          hour.weatherCondition?.description?.text,
          temperatureC,
          windMps,
          precipitationMm,
          precipitationProbability
        )
      };

      console.info("[WeatherService] forecast source=weather.googleapis.com", {
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
        temperatureC,
        windSpeedMps: windMps,
        precipitationMm: snapshot.precipitationMm,
        precipitationProbability: snapshot.precipitationProbability
      });

      this.cache.set(cacheKey, {
        snapshot,
        createdAt: nowMs,
        ttlMs: WeatherService.SUCCESS_CACHE_TTL_MS
      });
      return snapshot;
    } catch {
      return this.setFallback(
        cacheKey,
        nowMs,
        "Google Weather utilgængeligt (tjek at Weather API er aktiveret for nøglen). Falder tilbage til trafik-signaler."
      );
    }
  }

  private setFallback(cacheKey: string, nowMs: number, summary: string): WeatherSnapshot {
    const fallback: WeatherSnapshot = {
      source: "WEATHER_FALLBACK",
      lastUpdated: this.toHHMMUtc(new Date(nowMs)),
      summary
    };
    this.cache.set(cacheKey, {
      snapshot: fallback,
      createdAt: nowMs,
      ttlMs: WeatherService.FALLBACK_CACHE_TTL_MS
    });
    return fallback;
  }

  private readCelsius(t?: { degrees?: number; unit?: string }): number | undefined {
    if (typeof t?.degrees !== "number" || !Number.isFinite(t.degrees)) {
      return undefined;
    }
    if (t.unit && t.unit !== "CELSIUS") {
      return undefined;
    }
    return Number(t.degrees.toFixed(1));
  }

  /** Google returnerer typisk km/t; PFM forventer m/s (≥10 m/s = advarsel). */
  private windToMetersPerSecond(
    wind?: GoogleForecastHour["wind"]
  ): number | undefined {
    if (!wind) return undefined;
    const toKmh = (v: { value?: number; unit?: string } | undefined): number => {
      if (typeof v?.value !== "number" || !Number.isFinite(v.value)) return 0;
      if (v.unit === "METERS_PER_SECOND") return v.value * 3.6;
      if (v.unit === "KILOMETERS_PER_HOUR") return v.value;
      return v.value;
    };
    const kph = Math.max(toKmh(wind.speed), toKmh(wind.gust));
    if (kph <= 0) return undefined;
    return Number((kph / 3.6).toFixed(2));
  }

  private buildSummary(
    conditionText: string | undefined,
    temperatureC?: number,
    windSpeedMps?: number,
    precipitationMm?: number,
    precipitationProbability?: number
  ): string {
    const parts: string[] = [];
    if (conditionText) parts.push(conditionText);
    if (typeof temperatureC === "number") parts.push(`${temperatureC.toFixed(1)}°C`);
    if (typeof windSpeedMps === "number") parts.push(`vind ${windSpeedMps.toFixed(1)} m/s`);
    if (typeof precipitationProbability === "number") {
      parts.push(`nedbør-sandsynlighed ${Math.round(precipitationProbability * 100)}%`);
    }
    if (typeof precipitationMm === "number") parts.push(`nedbør ${precipitationMm.toFixed(1)} mm (time)`);
    return parts.length > 0 ? parts.join(", ") : "Ingen vejrparametre i Google-svar.";
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
