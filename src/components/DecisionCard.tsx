"use client";

import {
  ArrowRightLeft,
  Bus,
  Footprints,
  Heart,
  Radio,
  Ship,
  Train,
  TrainFront
} from "lucide-react";
import { DashboardDestination, DashboardRoute, PlannerResult } from "../types/dashboard";
import { TransitLeg, TransitMode } from "../types/transit";

function isHighPrecipitation(weather?: PlannerResult["weatherSnapshot"]): boolean {
  if (!weather) return false;
  const p = weather.precipitationProbability;
  if (typeof p === "number" && p >= 0.4) return true;
  const mm = weather.precipitationMm;
  return typeof mm === "number" && mm >= 0.4;
}

function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function etaDeltaMinutes(officialETA: string, pfmETA: string): number {
  const official = parseClock(officialETA);
  const pfm = parseClock(pfmETA);
  if (official === null || pfm === null) return 0;
  return (pfm - official + 24 * 60) % (24 * 60);
}

function modeIcon(mode: TransitMode) {
  switch (mode) {
    case "METRO":
      return TrainFront;
    case "BUS":
    case "TOGBUS":
      return Bus;
    case "WALK":
      return Footprints;
    case "FERRY":
      return Ship;
    default:
      return Train;
  }
}

function modeLabel(leg: TransitLeg): string {
  if (leg.mode === "TOGBUS") return "Togbus";
  if (leg.mode === "METRO") return `Metro ${leg.line}`;
  if (leg.mode === "BUS") return `Bus ${leg.line}`;
  if (leg.mode === "TRAIN") return `Tog ${leg.line}`;
  if (leg.mode === "WALK") return "Gang";
  return leg.line;
}

type TimelineItem =
  | { kind: "leg"; leg: TransitLeg }
  | { kind: "transfer"; minutes: number; stop: string };

function buildTimeline(legs: TransitLeg[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i]!;
    items.push({ kind: "leg", leg });
    const next = legs[i + 1];
    if (!next) continue;
    const arrival = parseClock(leg.arrivalTime);
    const departure = parseClock(next.departureTime);
    if (arrival === null || departure === null) continue;
    const wait = (departure - arrival + 24 * 60) % (24 * 60);
    if (wait > 0 && wait < 180) {
      items.push({ kind: "transfer", minutes: wait, stop: leg.arrivalStop });
    }
  }
  return items;
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
  const delta = etaDeltaMinutes(route.officialETA, route.pfm.pfmETA);
  const timeline = buildTimeline(route.trip.legs);

  return (
    <button type="button" onClick={onSelect} className={cardShellClass({ unstable, salsaTrip, precip, selected })}>
      <RouteScoreHeader reliability={route.pfm.reliabilityScore} delta={delta} unstable={unstable} />
      <RouteTimeline timeline={timeline} />
      <RouteBadges route={route} aiRecommended={aiRecommended} />
      <p className="mt-3 text-sm text-slate-200">{route.pfm.delayReason}</p>
    </button>
  );
}

function RouteScoreHeader({
  reliability,
  delta,
  unstable
}: {
  reliability: number;
  delta: number;
  unstable: boolean;
}) {
  const label = delta === 0 ? "0 min" : `+${delta} min`;
  return (
    <div className="border-b border-slate-700/60 pb-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Pålidelighed</p>
          <p className={`text-3xl font-bold ${unstable ? "text-red-300" : "text-emerald-300"}`}>{reliability}%</p>
        </div>
        <MotionDelta label={label} />
      </div>
    </div>
  );
}

function RouteTimeline({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <ol className="relative mt-4 space-y-0 border-l border-slate-700 pl-4">
      {timeline.map((item, index) => {
        if (item.kind === "transfer") {
          return (
            <li key={`transfer-${index}`} className="relative pb-4">
              <span className="absolute -left-[1.34rem] top-1 h-2.5 w-2.5 rounded-full bg-amber-300" />
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-amber-300" />
                <span>
                  Skift · {item.minutes} min på {item.stop}
                </span>
              </div>
            </li>
          );
        }
        return (
          <li key={`leg-${index}`} className="relative pb-4">
            <span className="absolute -left-[1.34rem] top-1 h-2.5 w-2.5 rounded-full bg-cyan-300" />
            <LegRow leg={item.leg} />
          </li>
        );
      })}
    </ol>
  );
}

function LegRow({ leg }: { leg: TransitLeg }) {
  const Icon = modeIcon(leg.mode);
  const dep = leg.departureTime ?? "--:--";
  const arr = leg.arrivalTime ?? "--:--";
  const live =
    leg.hasLiveTiming &&
    (leg.mode === "BUS" || leg.mode === "METRO" || leg.mode === "TRAIN" || leg.mode === "TOGBUS");

  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-100">{modeLabel(leg)}</p>
        <p className="text-xs text-slate-400">
          {dep} → {arr}
        </p>
        {leg.mode === "WALK" ? (
          <p className="mt-1 text-xs text-slate-300">
            {leg.walkDistanceText ? `Gå ${leg.walkDistanceText}` : "Gang"}
            {leg.durationMinutes ? ` · ca. ${leg.durationMinutes} min` : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-300">
            {leg.departureStop} → {leg.arrivalStop}
            {leg.departurePlatform ? ` · Perron ${leg.departurePlatform}` : ""}
            {leg.headsign ? ` · mod ${leg.headsign}` : ""}
          </p>
        )}
      </div>
      {live && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
          <Radio className="h-3 w-3" />
          Live
        </span>
      )}
    </div>
  );
}

function RouteBadges({ route, aiRecommended }: { route: DashboardRoute; aiRecommended: boolean }) {
  return (
    <MotionBadges>
      {aiRecommended && (
        <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200">
          AI RECOMMENDED
        </span>
      )}
      {route.isHackerRoute && (
        <span className="inline-flex items-center rounded-full bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-200">
          HACKER-RUTE
        </span>
      )}
      {route.pfm.isFavoriteRoute && (
        <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/20 px-2 py-1 text-xs text-pink-200">
          <Heart className="h-3 w-3" />
          Ørestad-hub
        </span>
      )}
    </MotionBadges>
  );
}

function MotionDelta({ label }: { label: string }) {
  return (
    <div className="text-right">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">PFM vs Google</p>
      <p className="text-2xl font-semibold text-amber-200">{label}</p>
    </div>
  );
}

function MotionBadges({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
}
