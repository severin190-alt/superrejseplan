import { HIMMessage, Leg } from "../types/rejseplanen";

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
  }
];

export class InfrastructureMap {
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

  messageAffectsRoute(message: HIMMessage, legs: Leg[]): boolean {
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

  isVestbanenCancellation(message: HIMMessage): boolean {
    const text = this.sanitizeText(`${message.header ?? ""} ${message.content ?? ""}`);
    const mentionsVestbanen =
      text.includes("vestbanen") ||
      /\b11\s*[ab]\b/.test(text) ||
      /\bbane\s*11\s*[ab]\b/.test(text);
    const cancelled = /\b(aflyst|indstillet|udgar|udgaet|aflyses)\b/.test(text);
    return mentionsVestbanen && cancelled;
  }

  isBusOrMetroRoute(legs: Leg[], journeyName?: string): boolean {
    const notesText = this.routeText(legs, journeyName);
    return (
      notesText.includes("bus") ||
      notesText.includes("metro") ||
      notesText.includes("m1") ||
      notesText.includes("m2") ||
      notesText.includes("m3") ||
      notesText.includes("m4") ||
      notesText.includes("5c") ||
      /\b\d{1,3}s?\b/.test(notesText)
    );
  }

  isRoskildeKbhBusCorridor(legs: Leg[], journeyName?: string): boolean {
    const stations = this.getRouteStations(legs);
    const hasRoskilde = stations.has("roskilde");
    const hasCopenhagenArea = stations.has("københavn h") || stations.has("kobenhavn h") || stations.has("valby");
    const notesText = this.routeText(legs, journeyName);
    const knownLines = ["123", "212", "250s"];
    const hasKnownLine = knownLines.some((line) => notesText.includes(line));
    return hasRoskilde && hasCopenhagenArea && (hasKnownLine || notesText.includes("bus"));
  }

  hasRealtimeForBusLeg(legs: Leg[], journeyName?: string): boolean {
    return legs.some((leg) => {
      const notesText = this.routeText([leg], journeyName);
      const likelyBusLeg = notesText.includes("bus") || this.looksLikeBusLine(notesText);
      return likelyBusLeg && Boolean(leg.rtDepartureTime || leg.rtArrivalTime || leg.Origin?.rtTime || leg.Destination?.rtTime);
    });
  }

  private getMappedStations(message: HIMMessage): Set<string> {
    const text = this.sanitizeText(`${message.header ?? ""} ${message.content ?? ""}`);
    const stationSet = new Set<string>();
    for (const mapping of LINE_MAPPINGS) {
      if (mapping.keys.some((key) => this.matchesLineKey(text, this.sanitizeText(key)))) {
        mapping.stations.forEach((station) => stationSet.add(this.sanitizeText(station)));
      }
    }
    return stationSet;
  }

  private getRouteStations(legs: Leg[]): Set<string> {
    const set = new Set<string>();
    for (const leg of legs) {
      set.add(this.normalize(leg.Origin?.name ?? ""));
      set.add(this.normalize(leg.Destination?.name ?? ""));
    }
    return set;
  }

  private normalize(value: string): string {
    return this.sanitizeText(value);
  }

  private routeText(legs: Leg[], journeyName?: string): string {
    const notes = legs
      .flatMap((leg) => this.toArray(leg.Notes?.Note))
      .map((n) => n.value ?? "")
      .join(" ");
    return this.normalize(`${journeyName ?? ""} ${notes}`);
  }

  private looksLikeBusLine(text: string): boolean {
    return /\b(1\d{2}|2\d{2}|[0-9]{1,2}[a-z]?)\b/.test(text);
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

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }
}
