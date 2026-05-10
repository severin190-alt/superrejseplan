"use client";

import { Cloud, Heart, Radio, Train, Users } from "lucide-react";
import { DashboardDestination, DashboardRoute, PlannerResult } from "../types/dashboard";

const statusClasses: Record<DashboardRoute["pfm"]["status"], string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-yellow-400",
  RED: "bg-red-500"
};

const crowdingLabel: Record<DashboardRoute["pfm"]["crowdingLevel"], string> = {
  LOW: "Lav",
  MEDIUM: "Medium",
  HIGH: "Høj"
};

function isHighPrecipitation(weather?: PlannerResult["weatherSnapshot"]): boolean {
  if (!weather) return false;
  const p = weather.precipitationProbability;
  if (typeof p === "number" && p >= 0.4) return true;
  const mm = weather.precipitationMm;
  return typeof mm === "number" && mm >= 0.4;
}

function cardShellClass(args: {
  unstable: boolean;
  salsaTrip: boolean;
  precip: boolean;
  selected: boolean;
}): string {
  const { unstable, salsaTrip, precip, selected } = args;
  const ring = selected ? "ring-2 ring-cyan-400" : "";
  if (unstable) {
    return `w-full rounded-2xl border border-red-500/75 bg-red-950/40 p-4 text-left text-slate-100 ${ring}`;
  }
  if (precip) {
    return `w-full rounded-2xl border border-sky-600/65 bg-sky-950/35 p-4 text-left text-slate-100 ${ring}`;
  }
  if (salsaTrip) {
    return `w-full rounded-2xl border border-purple-500/65 bg-purple-950/35 p-4 text-left text-slate-100 ${ring}`;
  }
  return `w-full rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left ${ring}`;
}

function statusBarClass(route: DashboardRoute, unstable: boolean): string {
  if (unstable) return "bg-red-600";
  return statusClasses[route.pfm.status];
}

export function DecisionCard({
  route,
  onSelect,
  selected,
  aiRecommended = false,
  activeDestination = null,
  weatherSnapshot
}: {
  route: DashboardRoute;
  onSelect: () => void;
  selected: boolean;
  aiRecommended?: boolean;
  activeDestination?: DashboardDestination | null;
  weatherSnapshot?: PlannerResult["weatherSnapshot"];
}) {
  const unstable = Boolean(route.pfm.unstable);
  const salsaTrip = activeDestination === "SALSA";
  const precip = isHighPrecipitation(weatherSnapshot);

  return (
    <button type="button" onClick={onSelect} className={cardShellClass({ unstable, salsaTrip, precip, selected })}>
      <div className={`h-2 w-full rounded-full ${statusBarClass(route, unstable)}`} />
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Train className="h-4 w-4" />
          <span>Officiel vs PFM</span>
        </div>
        <div className="flex items-center gap-2">
          {aiRecommended && (
            <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200">
              AI RECOMMENDED
            </span>
          )}
          {route.pfm.isFavoriteRoute && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/20 px-2 py-1 text-xs text-pink-200">
              <Heart className="h-3 w-3" />
              Favorit
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-lg font-semibold text-slate-300">{route.officialETA}</span>
        {route.isBusOrMetroRoute && route.hasLiveBusRealtime && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
            <Radio className="h-3 w-3" />
            Live
          </span>
        )}
        <span className="text-xs text-slate-500">-&gt;</span>
        <span className="text-3xl font-bold">{route.pfm.pfmETA}</span>
      </div>
      <p className="mt-3 text-sm text-slate-200">{route.pfm.delayReason}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
        <span className="inline-flex items-center gap-1">
          <Users className="h-4 w-4" />
          {crowdingLabel[route.pfm.crowdingLevel]}
        </span>
        {route.pfm.scooterOption.weatherWarning && (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <Cloud className="h-4 w-4" />
            Rain-check
          </span>
        )}
      </div>
    </button>
  );
}
