"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleRouteContext } from "@/types/dashboard";
import { RouteContextHit } from "@/types/statusScraper";

const NAVIGATOR_BUDGET_MS = 20000;
const MAX_ROUTES = 3;
const MAX_SCRAPER_CHARS = 22000;

type AnalyzeTravelSituationInput = {
  officialData: Array<{
    routeId: string;
    officialETA: string;
  }>;
  pfmData: Array<{
    routeId: string;
    pfmETA: string;
    status: "GREEN" | "YELLOW" | "RED";
    reliabilityScore: number;
    delayReason: string;
    isFavoriteRoute: boolean;
    crowdingLevel: "LOW" | "MEDIUM" | "HIGH";
    suggestBusAlternative: boolean;
    unstable: boolean;
    isHackerRoute: boolean;
    legs: Array<{
      mode: string;
      line: string;
      departureStop: string;
      arrivalStop: string;
      departureTime?: string;
      arrivalTime?: string;
      walkDistanceText?: string;
      departurePlatform?: string;
      headsign?: string;
      hasLiveTiming?: boolean;
    }>;
  }>;
  isScooterActive: boolean;
  statusIdentifiedCauses?: string[];
  rawScraperExcerpt: string;
  googleRouteContext?: GoogleRouteContext;
  bottleneckMode?: boolean;
  routeContextHits?: RouteContextHit[];
};

export type AnalyzeTravelSituationResult = {
  message: string;
  recommendedRouteId: string | null;
  alternativeBeatsFavorite: boolean;
  isFallback: boolean;
};

const SYSTEM_PROMPT = `Du er trafik-hackeren og strategiske hjerne bag dashboardet for pendleren Roskilde–København.

Du får rå scraper-tekst fra syv driftskilder og konkrete ruter med legs, PFM-score og Google-ETA. Korrelér scraper-tekst med de stationer der optræder på hver rute. Nævn eksplicit når en station på ruten rammer en hændelse i scraperen.

Hvis Google og scraperen divergerer, forklar hvorfor du alligevel anbefaler det du gør — med konkret begrundelse (fx kabelfejl, signalfejl, togbus-helvede, hacker-rute der slår skinnernes genopretningstid).

Skeln mellem korte fejl (døre/småting) og lange fejl (kabler, styresystem, personpåkørsel). Prioritér regulære Movia-busser over togbus ved akut nedbrud.

Bind anbefalingen til en routeId fra input. Brug reliability, PFM-ETA, legs og delayReason — ikke tomme formodninger.

Returnér KUN gyldig JSON:
{"message":"...", "recommendedRouteId":"route-x eller tom streng", "alternativeBeatsFavorite": true|false}`;

const FALLBACK_MESSAGE =
  "[PFM FALLBACK] Strategisk vurdering nåede ikke frem i tide. Brug tidslinjen, pålidelighed og rå scraper-tekst på kortene.";

function buildCompactPayload(input: AnalyzeTravelSituationInput): string {
  const routes = input.pfmData.slice(0, MAX_ROUTES).map((route) => {
    const official = input.officialData.find((o) => o.routeId === route.routeId);
    return {
      id: route.routeId,
      googleETA: official?.officialETA,
      pfmETA: route.pfmETA,
      reliability: route.reliabilityScore,
      status: route.status,
      unstable: route.unstable,
      favorite: route.isFavoriteRoute,
      crowding: route.crowdingLevel,
      hacker: route.isHackerRoute,
      reason: route.delayReason.slice(0, 320),
      legs: route.legs.slice(0, 12).map((leg) => ({
        mode: leg.mode,
        line: leg.line,
        from: leg.departureStop,
        to: leg.arrivalStop,
        dep: leg.departureTime,
        arr: leg.arrivalTime,
        walk: leg.walkDistanceText,
        platform: leg.departurePlatform,
        headsign: leg.headsign,
        live: leg.hasLiveTiming
      }))
    };
  });

  return JSON.stringify({
    routes,
    bottleneckMode: input.bottleneckMode ?? false,
    routeContextHits: input.routeContextHits?.slice(0, 8),
    statusCauses: input.statusIdentifiedCauses?.slice(0, 8),
    scraperExcerpt: input.rawScraperExcerpt.slice(0, MAX_SCRAPER_CHARS),
    google: input.googleRouteContext?.routes.slice(0, MAX_ROUTES),
    scooter: input.isScooterActive
  });
}

function parseNavigatorJson(raw: string): AnalyzeTravelSituationResult | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<AnalyzeTravelSituationResult>;
    if (typeof obj.message !== "string") return null;
    return {
      message: obj.message,
      recommendedRouteId:
        typeof obj.recommendedRouteId === "string" && obj.recommendedRouteId.length > 0 ? obj.recommendedRouteId : null,
      alternativeBeatsFavorite: Boolean(obj.alternativeBeatsFavorite),
      isFallback: false
    };
  } catch {
    return null;
  }
}

export async function analyzeTravelSituation(
  input: AnalyzeTravelSituationInput
): Promise<AnalyzeTravelSituationResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return fallbackResult();
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), NAVIGATOR_BUDGET_MS);

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" }
    });
    const prompt = `${SYSTEM_PROMPT}\n\nInput:\n${buildCompactPayload(input)}`;
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      })
    ]);
    const text = result.response.text();
    const parsed = parseNavigatorJson(text);
    if (!parsed) {
      return fallbackResult();
    }
    return parsed;
  } catch {
    return fallbackResult();
  } finally {
    clearTimeout(deadline);
  }
}

function fallbackResult(): AnalyzeTravelSituationResult {
  return {
    message: FALLBACK_MESSAGE,
    isFallback: true,
    recommendedRouteId: null,
    alternativeBeatsFavorite: false
  };
}
