import { StatusMessage, TransitTrip } from "../types/transit";
import { PFMContext, PFMResult } from "../types/pfm";
import { PFMService } from "./PFMService";

export class PFMEngine {
  private readonly service: PFMService;

  constructor(service?: PFMService) {
    this.service = service ?? new PFMService();
  }

  evaluateTrip(trip: TransitTrip, context?: PFMContext): PFMResult {
    return this.service.evaluateTrip({ trip, context });
  }

  evaluateBatch(trips: TransitTrip[], context?: PFMContext): PFMResult[] {
    return trips.map((trip) => this.evaluateTrip(trip, context));
  }

  extractRelevantMessages(messages: StatusMessage[]): StatusMessage[] {
    return messages;
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
