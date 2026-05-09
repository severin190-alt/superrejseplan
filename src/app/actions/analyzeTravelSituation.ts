"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";

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
    suggestBusAlternative?: boolean;
    unstable?: boolean;
  }>;
  isScooterActive: boolean;
};

export type AnalyzeTravelSituationResult = {
  message: string;
  recommendedRouteId: string | null;
  alternativeBeatsFavorite: boolean;
  isFallback: boolean;
};

const SYSTEM_PROMPT = `Du er en hyper-intelligent rejse-navigator for en IT-professionel, der pendler mellem Roskilde og København S. Du er rationel, direkte og bruger aldrig fyldord eller høflighedsfraser.

Dine opgaver:

Udstil løgnen: Sammenlign Rejseplanens officielle ETA med PFM-modellens realistiske ETA. Hvis PFM viser en forsinkelse pga. genopretning, som DSB ikke har meldt ud endnu, skal du sige det direkte.

Find sprækkerne: Hvis regionaltoget er nede eller 'Rødt', skal du aktivt foreslå alternativer. Kan han tage Metroen fra Ørestad? Er der en bus (f.eks. 150S/250S), der er hurtigere lige nu?

Strategisk navigation: Foreslå kun at 'blive på kontoret', hvis ALT (tog, busser og scooter-mulighed) er markeret som 'Rødt' eller 'Unstable'. Ellers skal du finde den mest pålidelige vej hjem.

Favorit-tjek: Husk at Bella Center -> Ørestad er favorit-ruten. Hvis den er 'Grøn', så bekræft at han skal tage den.

Tone: Teknisk og autoritær. Eksempel: 'Regionaltoget mod Ørestad er ramt af følge-forsinkelser. PFM-ETA er +22 min. Tag bus 250S nu – den kører udenom trængslen og sparer dig 15 minutter.'

Returnér KUN gyldig JSON på denne form:
{"message":"...", "recommendedRouteId":"route-x eller tom streng", "alternativeBeatsFavorite": true|false}`;

const FALLBACK_MESSAGE =
  "[PFM FALLBACK] AI-analytikeren er offline. Baserer vurdering på rå statistisk PFM-data: Tjek pålidelighedsscore og officielle meldinger.";

export async function analyzeTravelSituation(
  input: AnalyzeTravelSituationInput
): Promise<AnalyzeTravelSituationResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return fallbackResult();
  }

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `${SYSTEM_PROMPT}\n\nInput:\n${JSON.stringify(input)}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = safeParse(text);
    if (!parsed) {
      return fallbackResult();
    }
    return parsed;
  } catch {
    return fallbackResult();
  }
}

function safeParse(raw: string): AnalyzeTravelSituationResult | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<AnalyzeTravelSituationResult>;
    if (typeof obj.message !== "string") return null;
    return {
      message: obj.message,
      recommendedRouteId: typeof obj.recommendedRouteId === "string" && obj.recommendedRouteId.length > 0
        ? obj.recommendedRouteId
        : null,
      alternativeBeatsFavorite: Boolean(obj.alternativeBeatsFavorite),
      isFallback: false
    };
  } catch {
    return null;
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
