"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleRouteContext } from "@/types/dashboard";

const NAVIGATOR_BUDGET_MS = 8000;
const LAST_RESORT_FETCH_MS = 2500;

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
  }>;
  isScooterActive: boolean;
  /** Fra StatusScraperService — bruges til mere præcis genopretnings-vurdering. */
  statusIdentifiedCauses?: string[];
  /** Kort tekst-oversigt af scraper-fund (DSB, Metro, Rejseplanen mobil). */
  statusScraperSummary?: string;
  /** Rå uddrag fra alle scraper-sektioner — vigtig sandhedskilde til Navigator. */
  rawScraperExcerpt: string;
  /** Google Directions: rejsetid og advarsler (trafik / service-advarsler). */
  googleRouteContext?: GoogleRouteContext;
};

export type AnalyzeTravelSituationResult = {
  message: string;
  recommendedRouteId: string | null;
  alternativeBeatsFavorite: boolean;
  isFallback: boolean;
};

const SYSTEM_PROMPT = `Du er en hyper-intelligent rejse-navigator for en IT-professionel, der pendler mellem Roskilde og København S. Du er rationel, direkte og bruger aldrig fyldord eller høflighedsfraser.

Datakilder (vigtigt):
- Rutedata og officielle ankomsttider kommer fra Google Maps Directions (transit), som indregner realtids-/trafik- og GPS-baserede forsinkelser der hvor Google har dem.
- Drifts- og hændelsestekst kommer fra vores Status-radar (scraping af DSB Akut, Metro og Rejseplanen mobil). Brug ALTID feltet rawScraperExcerpt som primær ordret tekst fra scraperen — det er den rå sandhed vi injicerer, ikke kun statusScraperSummary.

Ørestad: Brugeren elsker Ørestad St. Hvis ruten går over Ørestad, skal du anerkende det som et klogt, effektivt træk — medmindre der er kritisk nedbrud (massiv aflysning, akut tunnel/kollaps-signaler, eller både Google og scraper viser dødt kaos omkring knudepunktet).

Udstil løgnen / konflikter: Sammenlign Googles rejsetid (officialData) med PFM-modellens ETA. Hvis PFM viser ekstra risiko pga. genopretning som Google ikke afspejler, sig det. Brug statusIdentifiedCauses til at kalibrere genopretning.

Google forsinket, scraper “normal drift”: Hvis Google viser tydelig forsinkelse eller advarsler (warnings), men rawScraperExcerpt/statusScraperSummary primært lyder som normal drift uden konkrete hændelser — forklar at operatørerne (DSB/Metro/Rejseplanen) ofte er langsomme til at opdatere offentlig driftstekst, mens Google afspejler det der sker ude på nettet. Brug en skarp, lidt hånlig vittighed om langsom kommunikation (uden personangreb eller slurs).

Find sprækkerne: Hvis regionaltoget er nede eller 'Rødt', foreslå alternativer (Metro Ørestad, bus, osv.). Brug rawScraperExcerpt til konkrete linjer og formuleringer.

Strategisk navigation: Foreslå kun at 'blive på kontoret', hvis ALT er 'Rødt' eller unstable er sand for alle relevante ruter. Ellers find den mest pålidelige vej.

Salsa-strategi: Ved destination Vanløse ("TIL SALSA"): hvis S-tog linje C/H eller Metro M1/M2 har LANG fejl, skal du foreslå konkrete regulære buslinjer (brug linjenumre fra data) før togbus. Nævn tydeligt at togbusser ofte er proppede under krise.

Tone: Teknisk og autoritær.

Returnér KUN gyldig JSON på denne form:
{"message":"...", "recommendedRouteId":"route-x eller tom streng", "alternativeBeatsFavorite": true|false}`;

const FALLBACK_MESSAGE =
  "[PFM FALLBACK] AI-analytikeren er offline. Baserer vurdering på rå statistisk PFM-data: Tjek pålidelighedsscore og officielle meldinger.";

async function fetchTextSnippet(url: string, parent: AbortSignal): Promise<string | null> {
  if (parent.aborted) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LAST_RESORT_FETCH_MS);
  const onParentAbort = () => ctrl.abort();
  parent.addEventListener("abort", onParentAbort, { once: true });
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    const text = (await res.text()).replace(/\s+/g, " ").slice(0, 900);
    return `${url} :: ${text}`;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
    parent.removeEventListener("abort", onParentAbort);
  }
}

async function maybeFetchLastResortSignals(input: AnalyzeTravelSituationInput, signal: AbortSignal): Promise<string | null> {
  const hasKnownCauses = Boolean(input.statusIdentifiedCauses?.length);
  const hasWarnings = Boolean(input.googleRouteContext?.routes.some((r) => r.warnings.length > 0));
  const largeDurationSpread = Boolean(
    input.googleRouteContext?.routes.length &&
      Math.max(...input.googleRouteContext.routes.map((r) => r.durationMinutes)) -
        Math.min(...input.googleRouteContext.routes.map((r) => r.durationMinutes)) >=
        25
  );
  const shouldFetch = !hasKnownCauses && (hasWarnings || largeDurationSpread);
  if (!shouldFetch) {
    return null;
  }

  const targets = [
    "https://www.dsb.dk/trafikinformation/",
    "https://m.dk/da/drift-og-service/status-og-planlagte-driftsaendringer/"
  ];
  const snippets: string[] = [];
  for (const url of targets) {
    if (signal.aborted) break;
    const bit = await fetchTextSnippet(url, signal);
    if (bit) snippets.push(bit);
  }
  return snippets.length ? snippets.join("\n") : null;
}

function buildUserPayload(input: AnalyzeTravelSituationInput, lastResort: string | null): string {
  const { rawScraperExcerpt, ...rest } = input;
  return JSON.stringify(
    {
      ...rest,
      rawScraperExcerpt,
      lastResortWebSignals: lastResort
    },
    null,
    0
  );
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
    const work = async (): Promise<AnalyzeTravelSituationResult> => {
      const lastResortContext = await maybeFetchLastResortSignals(input, controller.signal);
      if (controller.signal.aborted) {
        throw new Error("abort");
      }
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `${SYSTEM_PROMPT}\n\nInput (JSON):\n${buildUserPayload(input, lastResortContext)}`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = safeParse(text);
      if (!parsed) {
        return fallbackResult();
      }
      return parsed;
    };

    return await Promise.race([
      work(),
      new Promise<AnalyzeTravelSituationResult>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      })
    ]);
  } catch {
    return fallbackResult();
  } finally {
    clearTimeout(deadline);
  }
}

function safeParse(raw: string): AnalyzeTravelSituationResult | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<AnalyzeTravelSituationResult>;
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

function fallbackResult(): AnalyzeTravelSituationResult {
  return {
    message: FALLBACK_MESSAGE,
    isFallback: true,
    recommendedRouteId: null,
    alternativeBeatsFavorite: false
  };
}
