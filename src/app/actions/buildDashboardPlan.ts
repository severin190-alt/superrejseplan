"use server";

import { DashboardDestination, PlannerResult } from "@/types/dashboard";
import { SuperRoutePlannerService } from "@/services/SuperRoutePlannerService";

export async function buildDashboardPlanAction(
  destination: DashboardDestination,
  scooterModeRequested: boolean,
  position: { lat: number; lng: number }
): Promise<PlannerResult> {
  const planner = new SuperRoutePlannerService();
  return planner.buildDashboardPlan(destination, scooterModeRequested, position);
}
