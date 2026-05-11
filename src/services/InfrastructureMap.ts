import { StatusMessage, TransitLeg } from "../types/transit";

type LineMapping = {
  keys: string[];
  stations: string[];
};

const LINE_MAPPINGS: LineMapping[] = [
  {
    keys: ["bane 11a", "11a", "bane 11b", "11b", "vestbanen"],
    stations: ["københavn h", "kobenhavn h", "valby", "glostrup", "høje taastrup", "hoeje taastrup", "hedehusene", "trekroner", "roskilde"]
  },
  {
    keys: ["bane 12", " 12 ", "roskilde-ringsted", "ringstedbanen"],
    stations: ["roskilde", "viby sj", "borup", "ringsted"]
  },
  {
    keys: ["bane 20", "københavn syd-ringsted", "kobenhavn syd-ringsted"],
    stations: ["køge nord", "koege nord", "ringsted"]
  },
  {
    keys: ["bane 50", "øresundsbanen", "oresundsbanen"],
    stations: ["ørestad", "oerestad", "tårnby", "taarnby", "københavn lufthavn", "kobenhavn lufthavn"]
  },
  {
    keys: ["bane 80", "bane 81", "bane 82", "bane 83", "bane 84", "bane 85", "bane 86", "bane 87", "s-tog", "s tog"],
    stations: ["valby", "høje taastrup", "hoeje taastrup", "køge", "koege"]
  },
  {
    keys: ["linje m1", "linje m2", "metro m1", "metro m2", " m1 ", " m2 ", "metrosektion"],
    stations: [
      "vanlose",
      "vanløse",
      "frederiksberg",
      "norreport",
      "norre report",
      "oerestad",
      "ørestad",
      "lindevang",
      "flintholm",
      "kongens nytorv",
      "christianshavn",
      "amagerbro"
    ]
  },
  {
    keys: ["linje c", "linje h", "s-tog c", "s-tog h", "s tog c", "s tog h"],
    stations: ["vanlose", "vanløse", "valby", "københavn h", "kobenhavn h", "norreport", "oerestad", "ørestad"]
  }
];

const MOVIA_BUS_LINE = /^[0-9]+[SCA]?$/i;

export type CanonicalLineToken = string;

export class InfrastructureMap {
  extractCanonicalLineTokens(raw: string): CanonicalLineToken[] {
    const found = new Set<CanonicalLineToken>();
    const upper = raw.toUpperCase();

    for (const m of upper.matchAll(/\bM\s*([1-4])\b/g)) {
      found.add(`METRO:M${m[1]}`);
    }
    for (const m of upper.matchAll(/\bLINJE\s*([A-H])\b/g)) {
      found.add(`STOG:${m[1]}`);
    }
    for (const m of upper.matchAll(/\bS[\s-]*TOG(?:\s+LINJE)?\s*([A-H])\b/g)) {
      found.add(`STOG:${m[1]}`);
    }
    for (const m of raw.matchAll(/\b(RE|IC)\b/gi)) {
      found.add(m[1].toUpperCase());
    }
    for (const m of raw.matchAll(/\b(\d{1,3})([SCA])?\b/gi)) {
      const line = `${m[1]}${(m[2] ?? "").toUpperCase()}`;
      if (MOVIA_BUS_LINE.test(line)) {
        found.add(`BUS:${line}`);
      }
    }
    return [...found];
  }

  routeHasRegularBusLine(routeText: string): boolean {
    const tokens = this.extractCanonicalLineTokens(routeText);
    return tokens.some((t) => t.startsWith("BUS:"));
  }

  isMoviaBusLine(line: string): boolean {
    return MOVIA_BUS_LINE.test(line.trim());
  }

  sanitizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  messageAffectsRoute(message: StatusMessage, legs: TransitLeg[]): boolean {
    const mappedStations = this.getMappedStations(message);
    if (mappedStations.size === 0) {
      return false;
    }
    const routeStations = this.getRouteStations(legs);
    for (const station of mappedStations) {
      if (routeStations.has(station)) {
        return true;
      }
    }
    return false;
  }

  isVestbanenCancellation(message: StatusMessage): boolean {
    const text = this.sanitizeText(`${message.header ?? ""} ${message.content ?? ""}`);
    const mentionsVestbanen =
      text.includes("vestbanen") ||
      /\b11\s*[ab]\b/.test(text) ||
      /\bbane\s*11\s*[ab]\b/.test(text);
    const cancelled = /\b(aflyst|indstillet|udgar|udgaet|aflyses)\b/.test(text);
    return mentionsVestbanen && cancelled;
  }

  isBusOrMetroRoute(legs: TransitLeg[], journeyName?: string): boolean {
    const notesText = this.routeText(legs, journeyName);
    return (
      notesText.includes("bus") ||
      notesText.includes("metro") ||
      notesText.includes("m1") ||
      notesText.includes("m2") ||
      notesText.includes("m3") ||
      notesText.includes("m4") ||
      legs.some((leg) => leg.mode === "BUS" || leg.mode === "METRO" || leg.mode === "TOGBUS")
    );
  }

  isRoskildeKbhBusCorridor(legs: TransitLeg[], journeyName?: string): boolean {
    const stations = this.getRouteStations(legs);
    const hasRoskilde = stations.has("roskilde");
    const hasCopenhagenArea = stations.has("københavn h") || stations.has("kobenhavn h") || stations.has("valby");
    const notesText = this.routeText(legs, journeyName);
    const hasMoviaBus = legs.some((leg) => this.isMoviaBusLine(leg.line));
    return hasRoskilde && hasCopenhagenArea && (hasMoviaBus || notesText.includes("bus"));
  }

  hasRealtimeForBusLeg(legs: TransitLeg[], journeyName?: string): boolean {
    return legs.some((leg) => {
      const likelyBusLeg = leg.mode === "BUS" || leg.mode === "TOGBUS" || this.isMoviaBusLine(leg.line);
      return likelyBusLeg && Boolean(leg.departureTime || leg.arrivalTime);
    });
  }

  private getMappedStations(message: StatusMessage): Set<string> {
    const text = this.sanitizeText(`${message.header ?? ""} ${message.content ?? ""}`);
    const stationSet = new Set<string>();
    for (const mapping of LINE_MAPPINGS) {
      if (mapping.keys.some((key) => this.matchesLineKey(text, this.sanitizeText(key)))) {
        mapping.stations.forEach((station) => stationSet.add(this.sanitizeText(station)));
      }
    }
    return stationSet;
  }

  private getRouteStations(legs: TransitLeg[]): Set<string> {
    const set = new Set<string>();
    for (const leg of legs) {
      set.add(this.normalize(leg.departureStop));
      set.add(this.normalize(leg.arrivalStop));
    }
    return set;
  }

  private normalize(value: string): string {
    return this.sanitizeText(value);
  }

  private routeText(legs: TransitLeg[], journeyName?: string): string {
    const lines = legs.map((leg) => `${leg.line} ${leg.departureStop} ${leg.arrivalStop}`).join(" ");
    return this.normalize(`${journeyName ?? ""} ${lines}`);
  }

  private matchesLineKey(text: string, key: string): boolean {
    const keyTrim = key.trim();
    if (/^\d{1,2}[a-z]?$/.test(keyTrim)) {
      const escaped = keyTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b(?:bane\\s*)?${escaped}\\b`);
      return re.test(text);
    }
    if (/^bane\s*\d{1,2}[a-z]?$/.test(keyTrim)) {
      const numberPart = keyTrim.replace(/^bane\s*/, "");
      const escaped = numberPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\bbane\\s*${escaped}\\b`);
      return re.test(text);
    }
    return text.includes(keyTrim);
  }
}
