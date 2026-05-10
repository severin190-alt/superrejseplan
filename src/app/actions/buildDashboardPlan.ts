"use server";

import { DashboardDestination, PlannerResult } from "@/types/dashboard";
import { SuperRoutePlannerService } from "@/services/SuperRoutePlannerService";

const PLAN_BUDGET_MS = 8000;

export async function buildDashboardPlanAction(
  destination: DashboardDestination,
  scooterModeRequested: boolean,
  position: { lat: number; lng: number }
): Promise<PlannerResult> {
  const planner = new SuperRoutePlannerService();
  const started = Date.now();
  try {
    return await Promise.race([
      planner.buildDashboardPlan(destination, scooterModeRequested, position),
      new Promise<PlannerResult>((_, reject) =>
        setTimeout(() => reject(new Error("PLAN_TIMEOUT")), PLAN_BUDGET_MS)
      )
    ]);
  } catch (e) {
    if (e instanceof Error && e.message === "PLAN_TIMEOUT") {
      return {
        routes: [],
        staleData: false,
        loadError: `Planlægning timeout (${PLAN_BUDGET_MS / 1000} s). Prøv igen.`,
        dataTimestamp: new Date(started).toISOString(),
        useMetro: "1",
        scooterWeatherWarning: false
      };
    }
    throw e;
  }
}
