import * as cheerio from "cheerio";
import { StatusMessage, TransitLeg } from "../types/transit";
import {
  IncidentCategory,
  RouteContextHit,
  RouteContextResult,
  StatusScrapeReport,
  StatusScrapeSection,
  StatusScrapeSource
} from "../types/statusScraper";
import { InfrastructureMap } from "./InfrastructureMap";

const DSB_TRAFIK_URL = "https://www.dsb.dk/trafikinformation/";
const METRO_STATUS_URL = "https://m.dk/da/drift-og-service/status-og-planlagte-driftsaendringer/";
const RP_HOVEDSTADEN_URL =
  "https://webapp.rejseplanen.dk/bin/help.exe/mox?tpl=trafficinfo&selectedRegion=hovedstaden";
const RP_SJAELLAND_URL =
  "https://webapp.rejseplanen.dk/bin/help.exe/mox?tpl=trafficinfo&selectedRegion=sjaelland";
const DSB_PLANLAGT_URL = "https://www.dsb.dk/trafikinformation/planlagte-aendringer/";
const LOKALTOG_PLANLAGT_URL = "https://www.lokaltog.dk/trafikinformation/planlagte-aendringer/";
const DOT_PLANLAGT_URL = "https://dinoffentligetransport.dk/planlaeg-din-rejse/planlagte-aendringer";

const DISRUPTION_HINT =
  /forsink|aflyst|afbrud|driftsændring|driftsaendring|indstillet|omlægning|omlaegning|fejl|erstatning|ingen\s+.*tog|afviklet\s+anderledes|ændret\s+spor|aendret\s+spor|sp[æa]rret|signalfejl|personp[åa]k[øo]rsel|personpaakorsel|kabelfejl|styresystem/i;

const SHORT_INCIDENT_HINTS = [
  /d[øo]re/i,
  /genstand\s+p[åa]\s+sporet/i,
  /kortvarig/i,
  /5\s*-\s*10\s*min/i
];

const LONG_INCIDENT_HINTS = [
  /styresystem/i,
  /kabelfejl/i,
  /defekt\s+tog/i,
  /personp[åa]k[øo]rsel/i,
  /personpaakorsel/i,
  /str[øo]msvigt/i,
  /k[øo]reledning/i
];

function decodeIso88591(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("iso-8859-1").decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

async function fetchText(url: string, encoding: "utf-8" | "iso-8859-1"): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SuperRejseplan/1.0 (status; +https://github.com/)",
      Accept: "text/html,application/xhtml+xml"
    },
    next: { revalidate: 120 }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (encoding === "iso-8859-1") {
    const buf = await res.arrayBuffer();
    return decodeIso88591(buf);
  }
  return res.text();
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function uniqueNonEmpty(parts: string[]): string {
  return [...new Set(parts.map((p) => collapseWhitespace(p)).filter((p) => p.length > 0))].join("\n\n");
}

function scrapeDsbRawDump(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $(".container, main, article").each((_, el) => {
    const text = collapseWhitespace($(el).text());
    if (text.length > 0) parts.push(text);
  });
  return uniqueNonEmpty(parts);
}

function scrapeMetroRawDump(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $("main").each((_, el) => {
    const text = collapseWhitespace($(el).text());
    if (text.length > 0) parts.push(text);
  });
  $(
    '[class*="status"], [class*="Status"], [class*="marquee"], [class*="Marquee"], [class*="ticker"], [class*="Ticker"], [role="status"], [class*="status-banner"], [class*="fejl"], [class*="Fejl"]'
  ).each((_, el) => {
    const text = collapseWhitespace($(el).text());
    if (text.length > 0) parts.push(text);
  });
  return uniqueNonEmpty(parts);
}

function scrapeRejseplanenRawDump(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const el = $(`#tinfo_body_${i}`);
    if (!el.length) continue;
    const text = collapseWhitespace(el.text());
    if (text.length > 0) {
      parts.push(`[tinfo_body_${i}]\n${text}`);
    }
  }
  return uniqueNonEmpty(parts);
}

function scrapePlannedRawDump(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $(".container, main, article").each((_, el) => {
    const text = collapseWhitespace($(el).text());
    if (text.length > 0) parts.push(text);
  });
  return uniqueNonEmpty(parts);
}

function excerptAround(text: string, index: number, radius = 220): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return collapseWhitespace(text.slice(start, end));
}

function classifyIncidentCategory(text: string): IncidentCategory {
  if (LONG_INCIDENT_HINTS.some((p) => p.test(text))) return "LONG";
  if (SHORT_INCIDENT_HINTS.some((p) => p.test(text))) return "SHORT";
  if (DISRUPTION_HINT.test(text)) return "SHORT";
  return "NONE";
}

function mergeCategory(a: IncidentCategory, b: IncidentCategory): IncidentCategory {
  if (a === "LONG" || b === "LONG") return "LONG";
  if (a === "SHORT" || b === "SHORT") return "SHORT";
  return "NONE";
}

function stopTokens(stopName: string): string[] {
  const normalized = normalizeForMatch(stopName);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 4);
  return tokens.length > 0 ? tokens : [normalized];
}

function sectionsToStatusMessages(sections: StatusScrapeSection[]): StatusMessage[] {
  const label: Record<StatusScrapeSource, string> = {
    DSB_AKUT: "DSB Akut",
    METRO: "Metro",
    RP_HOVEDSTADEN: "Rejseplanen (Hovedstaden)",
    RP_SJAELLAND: "Rejseplanen (Sjælland)",
    DSB_PLANLAGT: "DSB planlagte ændringer",
    LOKALTOG_PLANLAGT: "Lokaltog planlagte ændringer",
    DOT_PLANLAGT: "DOT planlagte ændringer"
  };
  return sections.map((s, i) => ({
    id: `scrape-${s.source}-${i}`,
    header: label[s.source],
    content: s.text
  }));
}

type SourceCacheEntry = {
  at: number;
  sections: StatusScrapeSection[];
  errorMessage?: string;
};

type SourceJob = {
  source: StatusScrapeSource;
  loader: () => Promise<StatusScrapeSection>;
};

export class StatusScraperService {
  private static readonly CACHE_TTL_MS = 2 * 60 * 1000;
  private readonly lineMapper = new InfrastructureMap();
  private readonly sourceCache = new Map<StatusScrapeSource, SourceCacheEntry>();
  private inFlight: Promise<StatusScrapeReport> | null = null;

  async scrapeReport(): Promise<StatusScrapeReport> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.scrapeReportFresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  routeContextForTrip(sections: StatusScrapeSection[], legs: TransitLeg[]): RouteContextResult {
    const hits: RouteContextHit[] = [];
    const seen = new Set<string>();
    const stops = [...new Set(legs.flatMap((leg) => [leg.departureStop, leg.arrivalStop]))];

    for (const section of sections) {
      const normalizedText = normalizeForMatch(section.text);
      for (const stop of stops) {
        const tokens = stopTokens(stop);
        for (const token of tokens) {
          const idx = normalizedText.indexOf(token);
          if (idx < 0) continue;
          const window = normalizedText.slice(Math.max(0, idx - 180), Math.min(normalizedText.length, idx + token.length + 180));
          if (!DISRUPTION_HINT.test(window)) continue;
          const key = `${stop}:${section.source}:${token}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const incidentCategory = classifyIncidentCategory(window);
          hits.push({
            stopName: stop,
            source: section.source,
            rawExcerpt: excerptAround(section.text, idx),
            incidentCategory
          });
        }
      }
    }

    let incidentCategory: IncidentCategory = "NONE";
    for (const hit of hits) {
      incidentCategory = mergeCategory(incidentCategory, hit.incidentCategory);
    }

    const identifiedCauses = hits.map((hit) => `Drift rammer ${hit.stopName} (${hit.source})`);

    return {
      hits,
      incidentCategory,
      identifiedCauses,
      alarmActive: hits.length > 0
    };
  }

  private async pullSource(
    source: StatusScrapeSource,
    loader: () => Promise<StatusScrapeSection>
  ): Promise<{ section?: StatusScrapeSection; error?: { source: StatusScrapeSource; message: string } }> {
    const now = Date.now();
    const hit = this.sourceCache.get(source);
    if (hit && now - hit.at < StatusScraperService.CACHE_TTL_MS) {
      const section = hit.sections[0];
      return {
        section,
        error: hit.errorMessage ? { source, message: hit.errorMessage } : undefined
      };
    }
    try {
      const section = await loader();
      this.sourceCache.set(source, { at: Date.now(), sections: [section], errorMessage: undefined });
      return { section };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ukendt fejl";
      this.sourceCache.set(source, { at: Date.now(), sections: [], errorMessage: message });
      return { section: undefined, error: { source, message } };
    }
  }

  private async scrapeReportFresh(): Promise<StatusScrapeReport> {
    const fetchedAt = new Date().toISOString();
    const sections: StatusScrapeSection[] = [];
    const errors: StatusScrapeReport["errors"] = [];

    const jobs: SourceJob[] = [
      {
        source: "DSB_AKUT",
        loader: async () => {
          const html = await fetchText(DSB_TRAFIK_URL, "utf-8");
          return { source: "DSB_AKUT", text: scrapeDsbRawDump(html) };
        }
      },
      {
        source: "METRO",
        loader: async () => {
          const html = await fetchText(METRO_STATUS_URL, "utf-8");
          return { source: "METRO", text: scrapeMetroRawDump(html) };
        }
      },
      {
        source: "RP_HOVEDSTADEN",
        loader: async () => {
          const html = await fetchText(RP_HOVEDSTADEN_URL, "iso-8859-1");
          return { source: "RP_HOVEDSTADEN", text: scrapeRejseplanenRawDump(html) };
        }
      },
      {
        source: "RP_SJAELLAND",
        loader: async () => {
          const html = await fetchText(RP_SJAELLAND_URL, "iso-8859-1");
          return { source: "RP_SJAELLAND", text: scrapeRejseplanenRawDump(html) };
        }
      },
      {
        source: "DSB_PLANLAGT",
        loader: async () => {
          const html = await fetchText(DSB_PLANLAGT_URL, "utf-8");
          return { source: "DSB_PLANLAGT", text: scrapePlannedRawDump(html) };
        }
      },
      {
        source: "LOKALTOG_PLANLAGT",
        loader: async () => {
          const html = await fetchText(LOKALTOG_PLANLAGT_URL, "utf-8");
          return { source: "LOKALTOG_PLANLAGT", text: scrapePlannedRawDump(html) };
        }
      },
      {
        source: "DOT_PLANLAGT",
        loader: async () => {
          const html = await fetchText(DOT_PLANLAGT_URL, "utf-8");
          return { source: "DOT_PLANLAGT", text: scrapePlannedRawDump(html) };
        }
      }
    ];

    const settled = await Promise.allSettled(
      jobs.map(async (job) => {
        const result = await this.pullSource(job.source, job.loader);
        return { source: job.source, ...result };
      })
    );

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        continue;
      }
      const { section, error } = outcome.value;
      if (section && section.text.length > 0) {
        sections.push(section);
      }
      if (error) {
        errors.push(error);
      }
    }

    return { fetchedAt, sections, errors };
  }

  statusMessagesFromReport(report: StatusScrapeReport): StatusMessage[] {
    return sectionsToStatusMessages(report.sections);
  }

  digestForUi(
    report: StatusScrapeReport,
    routeHits: RouteContextHit[] = []
  ): {
    fetchedAt: string;
    summaryLines: string[];
    identifiedCauses: string[];
    incidentCategory: IncidentCategory;
    rawScraperExcerpt: string;
    sourceLabels: Array<{ source: StatusScrapeSource; count: number; ok: boolean }>;
    bottleneckAlarm?: {
      active: boolean;
      stations: string[];
      triggerSource: StatusScrapeSource;
      rawText: string;
    };
    routeContextHits: RouteContextHit[];
    bottleneckMode: boolean;
  } {
    const bySource = new Map<StatusScrapeSource, number>();
    for (const s of report.sections) {
      bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1);
    }
    const allSources: StatusScrapeSource[] = [
      "DSB_AKUT",
      "METRO",
      "RP_HOVEDSTADEN",
      "RP_SJAELLAND",
      "DSB_PLANLAGT",
      "LOKALTOG_PLANLAGT",
      "DOT_PLANLAGT"
    ];
    const sourceLabels = allSources.map((source) => ({
      source,
      count: bySource.get(source) ?? 0,
      ok: !report.errors.some((e) => e.source === source)
    }));

    const summaryLines = report.sections.map((s) => {
      const bit = s.text.length > 180 ? `${s.text.slice(0, 177)}…` : s.text;
      return `${s.source}: ${bit}`;
    });

    const rawScraperExcerpt = report.sections
      .map((s) => `[${s.source} @ ${report.fetchedAt}]\n${s.text}`)
      .join("\n---\n");

    const identifiedCauses = [...new Set(routeHits.map((hit) => `Drift rammer ${hit.stopName}`))];
    let incidentCategory: IncidentCategory = "NONE";
    for (const hit of routeHits) {
      incidentCategory = mergeCategory(incidentCategory, hit.incidentCategory);
    }

    const primaryHit = routeHits[0];
    const bottleneckAlarm = primaryHit
      ? {
          active: true,
          stations: [...new Set(routeHits.map((hit) => hit.stopName))],
          triggerSource: primaryHit.source,
          rawText: primaryHit.rawExcerpt
        }
      : undefined;

    return {
      fetchedAt: report.fetchedAt,
      summaryLines,
      identifiedCauses,
      incidentCategory,
      rawScraperExcerpt,
      sourceLabels,
      bottleneckAlarm,
      routeContextHits: routeHits,
      bottleneckMode: routeHits.length > 0
    };
  }

  routeIncidentForTrip(report: StatusScrapeReport, legs: TransitLeg[], journeyName?: string): {
    category: IncidentCategory;
    usesTogbus: boolean;
    usesRegularBus: boolean;
    context: RouteContextResult;
  } {
    const context = this.routeContextForTrip(report.sections, legs);
    const routeText = this.routeText(legs, journeyName);
    const usesTogbus =
      legs.some((leg) => leg.mode === "TOGBUS") || /\btogbus|tog bus|rail replacement\b/i.test(routeText);
    const usesRegularBus = this.lineMapper.routeHasRegularBusLine(routeText) && !usesTogbus;
    return { category: context.incidentCategory, usesTogbus, usesRegularBus, context };
  }

  private routeText(legs: TransitLeg[], journeyName?: string): string {
    const lines = legs.map((leg) => `${leg.line} ${leg.departureStop} ${leg.arrivalStop}`).join(" ");
    return `${journeyName ?? ""} ${lines}`.toLowerCase();
  }
}
