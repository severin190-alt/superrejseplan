import * as cheerio from "cheerio";
import { HIMMessage, Leg } from "../types/rejseplanen";
import { IncidentCategory, StatusScrapeReport, StatusScrapeSection, StatusScrapeSource } from "../types/statusScraper";
import { InfrastructureMap } from "./InfrastructureMap";

const DSB_TRAFIK_URL = "https://www.dsb.dk/trafikinformation/";
const METRO_STATUS_URL = "https://m.dk/da/drift-og-service/status-og-planlagte-driftsaendringer/";
/** Offentlige HTML-sider (samme som i browseren — ikke et proprietært API). */
const RP_HOVEDSTADEN_URL =
  "https://webapp.rejseplanen.dk/bin/help.exe/mox?tpl=trafficinfo&selectedRegion=hovedstaden";
const RP_SJAELLAND_URL =
  "https://webapp.rejseplanen.dk/bin/help.exe/mox?tpl=trafficinfo&selectedRegion=sjaelland";
const DSB_PLANLAGT_URL = "https://www.dsb.dk/trafikinformation/planlagte-aendringer/";
const LOKALTOG_PLANLAGT_URL = "https://www.lokaltog.dk/trafikinformation/planlagte-aendringer/";
const DOT_PLANLAGT_URL = "https://dinoffentligetransport.dk/planlaeg-din-rejse/planlagte-aendringer";

const CAUSE_KEYWORDS = [
  { id: "Signalfejl", patterns: [/signalfejl/i] },
  { id: "Personpåkørsel", patterns: [/personpåkørsel/i, /personpaakorsel/i] },
  { id: "Sporarbejde", patterns: [/sporarbejde/i, /spor\s*arbejde/i] },
  { id: "Mangel på togpersonale", patterns: [/mangel\s+på\s+togpersonale/i, /mangel\s+paa\s+togpersonale/i] }
] as const;

const DISRUPTION_HINT =
  /forsink|aflyst|afbrud|driftsændring|driftsaendring|indstillet|omlægning|omlaegning|fejl|erstatning|ingen\s+.*tog|afviklet\s+anderledes|ændret\s+spor|aendret\s+spor/i;

const SHORT_INCIDENT_HINTS = [
  /d[øo]re/i,
  /str[øo]mafbrydelse/i,
  /genstand\s+p[åa]\s+sporet/i,
  /personer\s+p[åa]\s+sporet/i,
  /kortvarig/i,
  /5\s*-\s*10\s*min/i
];

const LONG_INCIDENT_HINTS = [
  /styresystem/i,
  /kabelfejl/i,
  /defekt\s+tog\s+i\s+tunnel/i,
  /teknisk\s+fejl\s+i\s+tunnel/i,
  /sporskiftefejl/i,
  /personp[åa]k[øo]rsel/i,
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

function extractCauses(text: string): string[] {
  const found = new Set<string>();
  for (const { id, patterns } of CAUSE_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) {
      found.add(id);
    }
  }
  return [...found];
}

function classifyIncidentCategory(text: string): IncidentCategory {
  if (LONG_INCIDENT_HINTS.some((p) => p.test(text))) return "LONG";
  if (SHORT_INCIDENT_HINTS.some((p) => p.test(text))) return "SHORT";
  return "NONE";
}

function mergeCategory(a: IncidentCategory, b: IncidentCategory): IncidentCategory {
  if (a === "LONG" || b === "LONG") return "LONG";
  if (a === "SHORT" || b === "SHORT") return "SHORT";
  return "NONE";
}

function detectSalsaLineRisk(blob: string): boolean {
  if (!DISRUPTION_HINT.test(blob)) {
    return false;
  }
  const n = normalizeForMatch(blob);
  const metroM12 =
    /\bm\s*[12]\b/.test(n) ||
    /\bmetro\b.*\bm\s*[12]\b/.test(n) ||
    /\bm\s*[12]\b.*\bmetro\b/.test(n);
  const stogCh =
    /\bs[\s-]*tog\b.*\blinje\s*[ch]\b/.test(n) ||
    /\blinje\s*[ch]\b.*\bs[\s-]*tog\b/.test(n) ||
    /\bs[\s-]*tog\s*[ch]\b/.test(n);
  return metroM12 || stogCh;
}

function scrapeDsbAkut(html: string): string[] {
  const $ = cheerio.load(html);
  const blocks: string[] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const title = $(el).text().trim().toLowerCase();
    if (!title.includes("akut") || !title.includes("ændring")) {
      return;
    }
    let cur = $(el).next();
    let depth = 0;
    while (cur.length && depth < 40) {
      depth += 1;
      const tag = cur.prop("tagName")?.toLowerCase();
      if (tag && /^h[1-4]$/.test(tag)) {
        const nextTitle = cur.text().trim().toLowerCase();
        if (nextTitle.length > 3 && !nextTitle.includes("akut")) {
          break;
        }
      }
      if (tag === "p" || tag === "li") {
        const tx = cur.text().replace(/\s+/g, " ").trim();
        if (tx.length > 15) {
          blocks.push(tx);
        }
      } else if (tag === "div") {
        const tx = cur.text().replace(/\s+/g, " ").trim();
        if (tx.length > 40 && cur.children("p, li").length === 0) {
          blocks.push(tx);
        }
      }
      cur = cur.next();
    }
  });
  return [...new Set(blocks)];
}

function scrapeMetroMarquee(html: string): string[] {
  const $ = cheerio.load(html);
  const texts: string[] = [];
  $(
    '[class*="marquee"], [class*="Marquee"], [class*="ticker"], [class*="Ticker"], [role="status"], [class*="status-banner"]'
  ).each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length > 5) {
      texts.push(t);
    }
  });
  if (texts.length === 0) {
    const main = $("main").first().text().replace(/\s+/g, " ").trim();
    if (main.length > 20) {
      texts.push(main.slice(0, 2000));
    }
  }
  return [...new Set(texts)];
}

function scrapeRejseplanenBodies(html: string, source: StatusScrapeSource): StatusScrapeSection[] {
  const $ = cheerio.load(html);
  const ids: { id: string; label: string }[] =
    source === "RP_HOVEDSTADEN"
      ? [
          { id: "tinfo_body_1", label: "bus" },
          { id: "tinfo_body_3", label: "metro" },
          { id: "tinfo_body_4", label: "s-tog" }
        ]
      : [
          { id: "tinfo_body_1", label: "bus" },
          { id: "tinfo_body_5", label: "tog" }
        ];

  const out: StatusScrapeSection[] = [];
  for (const { id, label } of ids) {
    const el = $(`#${id}`);
    if (!el.length) {
      continue;
    }
    const text = el.text().replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      out.push({ source, sectionId: label, text });
    }
  }
  return out;
}

function scrapePlannedChangeText(html: string): string[] {
  const $ = cheerio.load(html);
  const lines: string[] = [];
  $("main p, main li, main h2, main h3, article p, article li, section p, section li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 20) lines.push(text);
  });
  return [...new Set(lines)];
}

function extractDateTokens(text: string): string[] {
  const set = new Set<string>();
  const normalized = normalizeForMatch(text);
  if (normalized.includes("i dag")) set.add("i dag");
  if (normalized.includes("i morgen")) set.add("i morgen");
  for (const m of text.matchAll(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g)) {
    set.add(m[0]);
  }
  return [...set];
}

function sectionsToHimMessages(sections: StatusScrapeSection[]): HIMMessage[] {
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
    header: s.sectionId ? `${label[s.source]} · ${s.sectionId}` : label[s.source],
    content: s.text
  }));
}

type SourceCacheEntry = {
  at: number;
  sections: StatusScrapeSection[];
  errorMessage?: string;
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

  private async pullSource(
    source: StatusScrapeSource,
    loader: () => Promise<StatusScrapeSection[]>
  ): Promise<{ sections: StatusScrapeSection[]; error?: { source: StatusScrapeSource; message: string } }> {
    const now = Date.now();
    const hit = this.sourceCache.get(source);
    if (hit && now - hit.at < StatusScraperService.CACHE_TTL_MS) {
      return {
        sections: hit.sections,
        error: hit.errorMessage ? { source, message: hit.errorMessage } : undefined
      };
    }
    try {
      const sections = await loader();
      this.sourceCache.set(source, { at: Date.now(), sections, errorMessage: undefined });
      return { sections };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ukendt fejl";
      this.sourceCache.set(source, { at: Date.now(), sections: [], errorMessage: message });
      return { sections: [], error: { source, message } };
    }
  }

  private async scrapeReportFresh(): Promise<StatusScrapeReport> {
    const fetchedAt = new Date().toISOString();
    const sections: StatusScrapeSection[] = [];
    const errors: StatusScrapeReport["errors"] = [];
    const plannedAlerts: StatusScrapeReport["plannedAlerts"] = [];

    const packs = await Promise.all([
      this.pullSource("DSB_AKUT", async () => {
        const html = await fetchText(DSB_TRAFIK_URL, "utf-8");
        const chunks = scrapeDsbAkut(html);
        const out: StatusScrapeSection[] = chunks.map((text) => ({ source: "DSB_AKUT", text }));
        if (chunks.length === 0) {
          const fallback = scrapeMetroMarquee(html);
          if (fallback[0]) {
            out.push({ source: "DSB_AKUT", text: fallback[0]!.slice(0, 1500) });
          }
        }
        return out;
      }),
      this.pullSource("METRO", async () => {
        const html = await fetchText(METRO_STATUS_URL, "utf-8");
        return scrapeMetroMarquee(html).map((text) => ({ source: "METRO", text }));
      }),
      this.pullSource("RP_HOVEDSTADEN", async () => {
        const html = await fetchText(RP_HOVEDSTADEN_URL, "iso-8859-1");
        return scrapeRejseplanenBodies(html, "RP_HOVEDSTADEN");
      }),
      this.pullSource("RP_SJAELLAND", async () => {
        const html = await fetchText(RP_SJAELLAND_URL, "iso-8859-1");
        return scrapeRejseplanenBodies(html, "RP_SJAELLAND");
      }),
      this.pullSource("DSB_PLANLAGT", async () => {
        const html = await fetchText(DSB_PLANLAGT_URL, "utf-8");
        return scrapePlannedChangeText(html).map((text) => ({ source: "DSB_PLANLAGT", text }));
      }),
      this.pullSource("LOKALTOG_PLANLAGT", async () => {
        const html = await fetchText(LOKALTOG_PLANLAGT_URL, "utf-8");
        return scrapePlannedChangeText(html).map((text) => ({ source: "LOKALTOG_PLANLAGT", text }));
      }),
      this.pullSource("DOT_PLANLAGT", async () => {
        const html = await fetchText(DOT_PLANLAGT_URL, "utf-8");
        return scrapePlannedChangeText(html).map((text) => ({ source: "DOT_PLANLAGT", text }));
      })
    ]);

    for (const pack of packs) {
      sections.push(...pack.sections);
      if (pack.error) {
        errors.push(pack.error);
      }
    }

    const blob = sections.map((s) => s.text).join("\n");
    const identifiedCauses = extractCauses(blob);
    const salsaLineRisk = detectSalsaLineRisk(blob);
    let incidentCategory = classifyIncidentCategory(blob);
    for (const section of sections) {
      if (!section.source.endsWith("PLANLAGT")) continue;
      const category = classifyIncidentCategory(section.text);
      plannedAlerts.push({
        source: section.source,
        lineIds: this.lineMapper.extractCanonicalLineTokens(section.text),
        dateTokens: extractDateTokens(section.text),
        category,
        text: section.text
      });
      incidentCategory = mergeCategory(incidentCategory, category);
    }

    return {
      fetchedAt,
      sections,
      identifiedCauses,
      incidentCategory,
      plannedAlerts,
      salsaLineRisk,
      errors
    };
  }

  himMessagesFromReport(report: StatusScrapeReport): HIMMessage[] {
    return sectionsToHimMessages(report.sections);
  }

  digestForUi(report: StatusScrapeReport): {
    fetchedAt: string;
    summaryLines: string[];
    identifiedCauses: string[];
    salsaLineRisk: boolean;
    incidentCategory: IncidentCategory;
    rawScraperExcerpt: string;
    sourceLabels: Array<{ source: StatusScrapeSource; count: number; ok: boolean }>;
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

    const summaryLines = report.sections.slice(0, 8).map((s) => {
      const bit = s.text.length > 160 ? `${s.text.slice(0, 157)}…` : s.text;
      return `${s.source}${s.sectionId ? ` · ${s.sectionId}` : ""}: ${bit}`;
    });

    const rawScraperExcerpt = report.sections
      .map((s) => `[${s.source}${s.sectionId ? ` · ${s.sectionId}` : ""}]\n${s.text}`)
      .join("\n---\n")
      .slice(0, 12000);

    return {
      fetchedAt: report.fetchedAt,
      summaryLines,
      identifiedCauses: report.identifiedCauses,
      salsaLineRisk: report.salsaLineRisk,
      incidentCategory: report.incidentCategory,
      rawScraperExcerpt,
      sourceLabels
    };
  }

  routeIncidentForTrip(report: StatusScrapeReport, legs: Leg[], journeyName?: string): {
    category: IncidentCategory;
    usesTogbus: boolean;
    usesRegularBus: boolean;
  } {
    const routeText = this.routeText(legs, journeyName);
    const routeTokens = new Set(this.lineMapper.extractCanonicalLineTokens(routeText));
    let category: IncidentCategory = "NONE";
    for (const alert of report.plannedAlerts) {
      if (alert.lineIds.length === 0) continue;
      const hits = alert.lineIds.some((id) => routeTokens.has(id));
      if (hits) {
        category = mergeCategory(category, alert.category);
      }
    }
    category = mergeCategory(category, classifyIncidentCategory(routeText));
    category = mergeCategory(category, report.incidentCategory);
    const usesTogbus = /\btogbus|tog bus|rail replacement\b/i.test(routeText);
    const usesRegularBus = this.lineMapper.routeHasRegularBusLine(routeText) && !usesTogbus;
    return { category, usesTogbus, usesRegularBus };
  }

  private routeText(legs: Leg[], journeyName?: string): string {
    const notes = legs
      .flatMap((leg) => {
        const note = leg.Notes?.Note;
        if (!note) return [];
        return Array.isArray(note) ? note.map((n) => n.value ?? "") : [note.value ?? ""];
      })
      .join(" ");
    const stops = legs.map((leg) => `${leg.Origin?.name ?? ""} ${leg.Destination?.name ?? ""}`).join(" ");
    return `${journeyName ?? ""} ${notes} ${stops}`.toLowerCase();
  }
}
