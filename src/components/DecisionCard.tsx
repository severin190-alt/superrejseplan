"use client";

import { Cloud, Heart, Radio, Train, Users } from "lucide-react";
import { DashboardRoute } from "../types/dashboard";

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

export function DecisionCard({
  route,
  onSelect,
  selected,
  aiRecommended = false
}: {
  route: DashboardRoute;
  onSelect: () => void;
  selected: boolean;
  aiRecommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left ${
        selected ? "ring-2 ring-cyan-400" : ""
      }`}
    >
      <div className={`h-2 w-full rounded-full ${statusClasses[route.pfm.status]}`} />
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
