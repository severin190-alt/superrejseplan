import { Departure, HIMMessage, Trip } from "../types/rejseplanen";
import { DispositionRiskResult, PFMContext, PFMResult } from "../types/pfm";
import { PFMService } from "./PFMService";

export class PFMEngine {
  private readonly service: PFMService;

  constructor(service?: PFMService) {
    this.service = service ?? new PFMService();
  }

  evaluateTrip(trip: Trip, context?: PFMContext): PFMResult {
    return this.service.evaluateTrip({ trip, context });
  }

  detectDispositionRisk(departures: Departure[], directionHint?: string): DispositionRiskResult {
    return this.service.detectDispositionRisk(departures, directionHint);
  }

  evaluateBatch(trips: Trip[], context?: PFMContext): PFMResult[] {
    return trips.map((trip) => this.evaluateTrip(trip, context));
  }

  extractRelevantMessages(messages: HIMMessage[]): HIMMessage[] {
    return messages.filter((msg) => {
      const header = msg.header ?? "";
      if (/^(DSB|Metro|Rejseplanen|Lokaltog|DOT)/.test(header)) {
        return true;
      }
      const text = `${header} ${msg.content ?? ""}`.toLowerCase();
      return (
        text.includes("roskilde") ||
        text.includes("høje taastrup") ||
        text.includes("hoeje taastrup") ||
        text.includes("glostrup") ||
        text.includes("valby") ||
        text.includes("københavn h") ||
        text.includes("kobenhavn h") ||
        text.includes("ørestad") ||
        text.includes("oerestad") ||
        text.includes("vanløse") ||
        text.includes("vanlose") ||
        text.includes("personpåkørsel") ||
        text.includes("signalfejl") ||
        text.includes("sporarbejde") ||
        text.includes("mangel på togpersonale") ||
        text.includes("blade på skinnerne") ||
        text.includes("strømsvigt") ||
        text.includes("materielmangel") ||
        text.includes("kort tog") ||
        text.includes("regn") ||
        text.includes("sne")
      );
    });
  }

  computeTripQueryOverrides(context?: PFMContext): { useMetro: "0" | "1"; message?: string } {
    const scooter = this.service.getScooterDecision(context);
    if (scooter.weatherWarning) {
      return {
        useMetro: "1",
        message: "Det er dårligt vejr – jeg foreslår Metro/tog fremfor løbehjul."
      };
    }
    if (scooter.feasible) {
      return {
        useMetro: "0",
        message: "Scooter til Ørestad St. (~8 min), Metro fravalgt for lavere pris."
      };
    }
    return { useMetro: "1" };
  }
}
