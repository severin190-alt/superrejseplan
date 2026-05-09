import { CrowdingLevel } from "../types/pfm";

type CrowdingSnapshot = {
  level: CrowdingLevel;
  tripsPerHour: number;
  weekday: number;
  hour: number;
  source: "HARD_CODED_REJSEKORT";
};

export class CrowdingService {
  private static readonly HIGH_THRESHOLD = 30000;

  estimate(now: Date = new Date()): CrowdingSnapshot {
    const weekday = now.getDay();
    const hour = now.getHours();
    const tripsPerHour = this.resolveTripsPerHour(weekday, hour);

    return {
      level: this.toCrowdingLevel(tripsPerHour),
      tripsPerHour,
      weekday,
      hour,
      source: "HARD_CODED_REJSEKORT"
    };
  }

  private resolveTripsPerHour(weekday: number, hour: number): number {
    if (weekday >= 1 && weekday <= 4) {
      return this.mondayToThursday(hour);
    }
    if (weekday === 5) {
      return this.friday(hour);
    }
    return 24000;
  }

  private mondayToThursday(hour: number): number {
    if (hour === 7) return 37012;
    if (hour === 8) return 22848;
    if (hour === 15) return 28500;
    if (hour === 16) return 34200;
    if (hour === 6 || hour === 9 || hour === 14 || hour === 17) return 26000;
    return 21000;
  }

  private friday(hour: number): number {
    if (hour === 7) return 34264;
    if (hour >= 15 && hour <= 17) return 31000;
    if (hour === 8 || hour === 14 || hour === 18) return 27000;
    return 22000;
  }

  private toCrowdingLevel(tripsPerHour: number): CrowdingLevel {
    if (tripsPerHour > CrowdingService.HIGH_THRESHOLD) {
      return "HIGH";
    }
    if (tripsPerHour >= 20000) {
      return "MEDIUM";
    }
    return "LOW";
  }
}

export type { CrowdingSnapshot };
