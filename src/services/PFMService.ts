import { Departure, HIMMessage, Leg } from "../types/rejseplanen";
import { DispositionRiskResult, PFMContext, PFMEvaluationInput, PFMResult } from "../types/pfm";
import { InfrastructureMap } from "./InfrastructureMap";

type ParsedIncidentSignal = {
  keyword: string;
  penaltyMinutes: number;
  reason: string;
  forceUnstable?: boolean;
  forceReliability?: number;
  suggestBusAlternative?: boolean;
};

export class PFMService {
  private readonly infrastructureMap = new InfrastructureMap();
  private static readonly GEOFENCE_NODES = [
    "roskilde",
    "høje taastrup",
    "hoeje taastrup",
    "glostrup",
    "valby",
    "københavn h",
    "kobenhavn h",
    "ørestad",
    "oerestad"
  ];

  evaluateTrip(input: PFMEvaluationInput): PFMResult {
    const now = input.context?.now ?? new Date();
    const trip = input.trip;
    const legs = this.toArray<Leg>(trip.Leg);
    const officialETA = this.getOfficialETA(legs);

    const penalties: number[] = [];
    let reliabilityScore = 100;
    let unstable = false;
    let suggestBusAlternative = false;
    const reasons: string[] = [];

    const recoveryPenalty = this.applyRecoveryPenalty(input.context, now, reasons);
    penalties.push(recoveryPenalty);

    const busOrMetroRoute = this.infrastructureMap.isBusOrMetroRoute(legs);
    const incidentOutcome = this.applyIncidentWeighting(input.context?.himMessages, legs, now, busOrMetroRoute);
    penalties.push(incidentOutcome.penaltyMinutes);
    reasons.push(...incidentOutcome.reasons);
    unstable = unstable || incidentOutcome.unstable;
    suggestBusAlternative = suggestBusAlternative || incidentOutcome.suggestBusAlternative;
    reliabilityScore = Math.min(reliabilityScore, incidentOutcome.reliabilityCap);
    if (incidentOutcome.deadZoneMinutes > 0) {
      penalties.push(incidentOutcome.deadZoneMinutes);
      reasons.push("Togbus dead-zone aktiv (90-120 min)");
    }

    if (!busOrMetroRoute && this.hasValbyCopenhagenBottleneckSignalIssue(legs, input.context?.himMessages)) {
      reliabilityScore -= 20;
      reasons.push("Signalfejl i flaskehalsen Valby-København H");
    }

    if (!busOrMetroRoute && this.hasMaterialShortage(legs, input.context?.himMessages)) {
      reliabilityScore -= 40;
      reasons.push("Materielmangel giver længere stationstider");
    }

    const transferCount = Math.max(0, legs.length - 1);
    if (transferCount > 0) {
      reliabilityScore -= transferCount * 10;
      reasons.push(`Skift-straf (${transferCount} skift)`);
    }

    const isFavoriteRoute = this.isFavoriteRoute(legs);
    if (isFavoriteRoute) {
      reliabilityScore += 15;
      reasons.push("Favorit-rute comfort bonus");
    }

    const crowding = this.computeCrowding(legs, input.context?.himMessages, now);
    if (crowding.penalty > 0) {
      reliabilityScore -= crowding.penalty;
      reasons.push(crowding.reason);
    }

    if (crowding.suggestWait20Min) {
      reasons.push("Forslag: vent 20 min for lavere passagerpres");
    }

    const scooterOption = this.buildScooterOption(input.context);
    if (scooterOption.weatherWarning) {
      reasons.push("Det er dårligt vejr – jeg foreslår Metro/tog fremfor løbehjul.");
    } else if (scooterOption.feasible) {
      reasons.push("Scooter aktiv: direkte til Ørestad St. (~8 min) og Metro fravalgt");
    }

    const score = this.clamp(reliabilityScore, 0, 100);
    const dominatingPenalty = Math.max(0, ...penalties);
    const pfmETA = this.shiftTime(officialETA, dominatingPenalty);
    const baseStatus = this.scoreToStatus(score, unstable);
    const status = crowding.forceAtLeastYellow && baseStatus === "GREEN" ? "YELLOW" : baseStatus;

    return {
      officialETA,
      pfmETA,
      delayReason: reasons.length > 0 ? reasons.join("; ") : "Ingen ekstra statistiske risici",
      reliabilityScore: score,
      status,
      suggestBusAlternative,
      unstable,
      isFavoriteRoute,
      crowdingLevel: crowding.level,
      scooterOption
    };
  }

  detectDispositionRisk(departures: Departure[], directionHint = "Roskilde"): DispositionRiskResult {
    const relevant = departures.filter((dep) =>
      (dep.direction ?? "").toLowerCase().includes(directionHint.toLowerCase())
    );

    if (relevant.length < 3) {
      return {
        highRisk: false,
        probability: 0,
        reason: "For få afgange til at vurdere disponering"
      };
    }

    const firstTwoBad = this.isCancelledOrSeverelyDelayed(relevant[0]) &&
      this.isCancelledOrSeverelyDelayed(relevant[1]);

    if (!firstTwoBad) {
      return {
        highRisk: false,
        probability: 0,
        reason: "Mønster for huls-aflysninger er ikke aktivt"
      };
    }

    return {
      highRisk: true,
      probability: 0.9,
      reason: "To på hinanden følgende afgange er aflyst/forsinket >20 min; tredje afgang er high risk"
    };
  }

  getScooterDecision(context?: PFMContext): { feasible: boolean; weatherWarning: boolean } {
    return this.buildScooterOption(context);
  }

  private applyRecoveryPenalty(context: PFMContext | undefined, now: Date, reasons: string[]): number {
    if (!context?.incidentWindows?.length) {
      return 0;
    }

    let penalty = 0;
    for (const incident of context.incidentWindows) {
      if (!incident.incidentResolvedTime) {
        continue;
      }

      const start = this.parseDateTime(incident.incidentStartTime);
      const resolved = this.parseDateTime(incident.incidentResolvedTime);
      if (!start || !resolved) {
        continue;
      }

      const sinceResolvedMinutes = (now.getTime() - resolved.getTime()) / 60000;
      if (sinceResolvedMinutes < 0 || sinceResolvedMinutes > 120) {
        continue;
      }

      const incidentHours = Math.max(0.5, (resolved.getTime() - start.getTime()) / 3600000);
      const recoveryHours = incidentHours * 1.75;
      const scaledPenalty = Math.round(this.clamp(recoveryHours * 8, 15, 30));
      penalty += scaledPenalty;
      reasons.push("Genopretning efter nyligt løst hændelse");
    }

    return penalty;
  }

  private applyIncidentWeighting(
    messages: HIMMessage[] | undefined,
    legs: Leg[],
    now: Date,
    busOrMetroRoute: boolean
  ): {
    penaltyMinutes: number;
    reasons: string[];
    unstable: boolean;
    reliabilityCap: number;
    suggestBusAlternative: boolean;
    deadZoneMinutes: number;
  } {
    const list = (messages ?? [])
      .filter((msg) => this.isMessageInGeofence(msg))
      .filter((msg) => this.infrastructureMap.messageAffectsRoute(msg, legs));
    let penaltyMinutes = 0;
    const reasons: string[] = [];
    let unstable = false;
    let reliabilityCap = 100;
    let suggestBusAlternative = false;
    let deadZoneMinutes = 0;

    for (const msg of list) {
      const text = `${msg.header ?? ""} ${msg.content ?? ""}`.toLowerCase();
      if (busOrMetroRoute && this.looksLikeRailIncident(text)) {
        continue;
      }
      const signal = this.parseIncidentSignal(text, now);
      if (!signal) {
        continue;
      }

      penaltyMinutes = Math.max(penaltyMinutes, signal.penaltyMinutes);
      reasons.push(signal.reason);
      if (signal.forceUnstable) {
        unstable = true;
      }
      if (typeof signal.forceReliability === "number") {
        reliabilityCap = Math.min(reliabilityCap, signal.forceReliability);
      }
      if (signal.suggestBusAlternative) {
        suggestBusAlternative = true;
      }
      deadZoneMinutes = Math.max(deadZoneMinutes, signal.suggestBusAlternative ? 120 : 0);
    }

    return { penaltyMinutes, reasons, unstable, reliabilityCap, suggestBusAlternative, deadZoneMinutes };
  }

  private parseIncidentSignal(text: string, now: Date): ParsedIncidentSignal | null {
    if (text.includes("personpåkørsel")) {
      return {
        keyword: "personpåkørsel",
        penaltyMinutes: 240,
        reason: "Personpåkørsel: +240 min og ustabil drift",
        forceUnstable: true
      };
    }

    if (text.includes("signalfejl")) {
      const hour = now.getHours();
      const rushHour = (hour >= 7 && hour <= 9) || (hour >= 15 && hour <= 17);
      const base = 60;
      const weighted = rushHour ? Math.round(base * 1.5) : base;
      return {
        keyword: "signalfejl",
        penaltyMinutes: weighted,
        reason: rushHour
          ? "Signalfejl (stor) i myldretid: +90 min"
          : "Signalfejl (stor): +60 min"
      };
    }

    if (text.includes("blade på skinnerne")) {
      return {
        keyword: "blade på skinnerne",
        penaltyMinutes: 10,
        reason: "Blade på skinnerne: konstant flow-straf +10 min"
      };
    }

    if (text.includes("strømsvigt")) {
      return {
        keyword: "strømsvigt",
        penaltyMinutes: 120,
        reason: "Strømsvigt: normalisering er langsom, anbefal togbus/bus",
        forceReliability: 0,
        suggestBusAlternative: true
      };
    }

    if (text.includes("materielmangel") || text.includes("kort tog")) {
      return {
        keyword: "materielmangel",
        penaltyMinutes: 20,
        reason: "Materielmangel/kort tog: øget stationstid og dominoeffekt"
      };
    }

    return null;
  }

  private hasMaterialShortage(legs: Leg[], messages: HIMMessage[] | undefined): boolean {
    return (messages ?? [])
      .filter((msg) => this.isMessageInGeofence(msg))
      .filter((msg) => this.infrastructureMap.messageAffectsRoute(msg, legs))
      .some((msg) => {
        const text = `${msg.header ?? ""} ${msg.content ?? ""}`.toLowerCase();
        return text.includes("materielmangel") || text.includes("kort tog");
      });
  }

  private hasValbyCopenhagenBottleneckSignalIssue(legs: Leg[], messages: HIMMessage[] | undefined): boolean {
    const hasSignalIssue = (messages ?? [])
      .filter((msg) => this.isMessageInGeofence(msg))
      .filter((msg) => this.infrastructureMap.messageAffectsRoute(msg, legs))
      .some((msg) => {
      const text = `${msg.header ?? ""} ${msg.content ?? ""}`.toLowerCase();
      return text.includes("signalfejl");
    });
    if (!hasSignalIssue) {
      return false;
    }

    return legs.some((leg) => {
      const from = (leg.Origin?.name ?? "").toLowerCase();
      const to = (leg.Destination?.name ?? "").toLowerCase();
      const valby = "valby";
      const kh = "københavn h";
      const khAlt = "kobenhavn h";
      return (
        (from.includes(valby) && (to.includes(kh) || to.includes(khAlt))) ||
        (to.includes(valby) && (from.includes(kh) || from.includes(khAlt)))
      );
    });
  }

  private isCancelledOrSeverelyDelayed(dep: Departure): boolean {
    const notes = `${dep.messages ?? ""}`.toLowerCase();
    if (notes.includes("aflyst") || notes.includes("cancel")) {
      return true;
    }

    const scheduled = this.parseClock(dep.time);
    const realtime = this.parseClock(dep.rtTime ?? dep.time);
    if (!scheduled || !realtime) {
      return false;
    }
    const diff = realtime - scheduled;
    return diff > 20;
  }

  private getOfficialETA(legs: Leg[]): string {
    const lastLeg = legs[legs.length - 1];
    if (!lastLeg) {
      return "00:00";
    }
    return lastLeg.rtArrivalTime ?? lastLeg.Destination?.rtTime ?? lastLeg.Destination?.time ?? "00:00";
  }

  private parseClock(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    return hours * 60 + mins;
  }

  private shiftTime(hhmm: string, plusMinutes: number): string {
    const base = this.parseClock(hhmm);
    if (base === null) {
      return hhmm;
    }
    const wrapped = (base + plusMinutes + 24 * 60 * 3) % (24 * 60);
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  private parseDateTime(value: string): Date | null {
    const iso = new Date(value);
    if (!Number.isNaN(iso.getTime())) {
      return iso;
    }

    const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const yearRaw = Number(match[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    return new Date(year, month, day, hour, minute, 0, 0);
  }

  private scoreToStatus(score: number, unstable: boolean): "GREEN" | "YELLOW" | "RED" {
    if (unstable || score < 40) {
      return "RED";
    }
    if (score < 75) {
      return "YELLOW";
    }
    return "GREEN";
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private isMessageInGeofence(message: HIMMessage): boolean {
    const text = `${message.header ?? ""} ${message.content ?? ""}`.toLowerCase();
    return PFMService.GEOFENCE_NODES.some((node) => text.includes(node));
  }

  private isFavoriteRoute(legs: Leg[]): boolean {
    const names = legs.flatMap((leg) => [(leg.Origin?.name ?? "").toLowerCase(), (leg.Destination?.name ?? "").toLowerCase()]);
    const hasBella = names.some((n) => n.includes("bella center"));
    const hasOrestad = names.some((n) => n.includes("ørestad") || n.includes("oerestad"));
    const hasRoskilde = names.some((n) => n.includes("roskilde"));
    return hasBella && hasOrestad && hasRoskilde;
  }

  private computeCrowding(
    legs: Leg[],
    messages: HIMMessage[] | undefined,
    now: Date
  ): {
    level: "LOW" | "MEDIUM" | "HIGH";
    penalty: number;
    reason: string;
    forceAtLeastYellow: boolean;
    suggestWait20Min: boolean;
  } {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const inPeak =
      (minutes >= 7 * 60 + 30 && minutes <= 8 * 60 + 30) ||
      (minutes >= 15 * 60 + 30 && minutes <= 17 * 60);
    const viaKbhH = legs.some((leg) => {
      const from = (leg.Origin?.name ?? "").toLowerCase();
      const to = (leg.Destination?.name ?? "").toLowerCase();
      return from.includes("københavn h") || from.includes("kobenhavn h") || to.includes("københavn h") || to.includes("kobenhavn h");
    });

    if (
      this.infrastructureMap.isRoskildeKbhBusCorridor(legs) &&
      (messages ?? []).some((msg) => this.infrastructureMap.isVestbanenCancellation(msg))
    ) {
      return {
        level: "HIGH",
        penalty: 15,
        reason: "Bane 11a aflysning presser passagerer over i bus-korridoren",
        forceAtLeastYellow: true,
        suggestWait20Min: false
      };
    }

    if (viaKbhH && inPeak) {
      return {
        level: "HIGH",
        penalty: 20,
        reason: "Høj passager-densitet",
        forceAtLeastYellow: true,
        suggestWait20Min: true
      };
    }

    if (viaKbhH) {
      return {
        level: "MEDIUM",
        penalty: 10,
        reason: "København H-veto: ekstra pres i knudepunkt",
        forceAtLeastYellow: false,
        suggestWait20Min: false
      };
    }

    return {
      level: "LOW",
      penalty: 0,
      reason: "Lav passagerdensitet",
      forceAtLeastYellow: false,
      suggestWait20Min: false
    };
  }

  private buildScooterOption(context: PFMContext | undefined): { feasible: boolean; weatherWarning: boolean } {
    const precip = context?.weatherSnapshot?.precipitationMm;
    const wind = context?.weatherSnapshot?.windSpeedMps;
    const severeByForecast = (typeof precip === "number" && precip >= 0.4) || (typeof wind === "number" && wind >= 10);
    if (severeByForecast) {
      return { feasible: false, weatherWarning: true };
    }

    const weatherText = `${context?.weatherCondition ?? ""} ${(context?.himMessages ?? [])
      .map((m) => `${m.header ?? ""} ${m.content ?? ""}`)
      .join(" ")}`.toLowerCase();
    const badWeather = weatherText.includes("regn") || weatherText.includes("sne");

    if (badWeather) {
      return { feasible: false, weatherWarning: true };
    }

    if (context?.scooterModeRequested) {
      return { feasible: true, weatherWarning: false };
    }

    return { feasible: false, weatherWarning: false };
  }

  private looksLikeRailIncident(text: string): boolean {
    return (
      text.includes("signalfejl") ||
      text.includes("strømsvigt") ||
      text.includes("sporspærr") ||
      text.includes("vestbanen") ||
      text.includes("bane ")
    );
  }
}
