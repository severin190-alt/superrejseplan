"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Bike, Cloud, Train } from "lucide-react";
import { DecisionCard } from "../components/DecisionCard";
import { LiveMapPanel } from "../components/LiveMapPanel";
import { StrategicWaitBox } from "../components/StrategicWaitBox";
import { DashboardDestination, DashboardRoute, PlannerResult } from "../types/dashboard";
import { SuperRoutePlannerService } from "../services/SuperRoutePlannerService";
import { analyzeTravelSituation, AnalyzeTravelSituationResult } from "./actions/analyzeTravelSituation";

const planner = new SuperRoutePlannerService();

export default function DashboardPage() {
  const [scooterModeRequested, setScooterModeRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DashboardRoute | null>(null);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [aiLoading, setAiLoading] = useState(false);
  const [navigatorInsight, setNavigatorInsight] = useState<AnalyzeTravelSituationResult | null>(null);

  async function runPlanning(destination: DashboardDestination) {
    setLoading(true);
    setError(null);
    try {
      const nextPlan = await planner.buildDashboardPlan(destination, scooterModeRequested);
      setPlan(nextPlan);
      setSelectedRoute(nextPlan.routes[0] ?? null);
      setNavigatorInsight(null);
      setAiLoading(true);

      const officialData = nextPlan.routes.map((route) => ({
        routeId: route.id,
        officialETA: route.officialETA
      }));
      const pfmData = nextPlan.routes.map((route) => ({
        routeId: route.id,
        pfmETA: route.pfm.pfmETA,
        status: route.pfm.status,
        reliabilityScore: route.pfm.reliabilityScore,
        delayReason: route.pfm.delayReason,
        isFavoriteRoute: route.pfm.isFavoriteRoute,
        crowdingLevel: route.pfm.crowdingLevel,
        suggestBusAlternative: route.pfm.suggestBusAlternative,
        unstable: route.pfm.unstable
      }));
      const aiResult = await analyzeTravelSituation({
        officialData,
        pfmData,
        isScooterActive: scooterModeRequested
      });
      setNavigatorInsight(aiResult);

      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((p) => {
          setCurrentPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        });
      }
      if (nextPlan.staleData) {
        setError(nextPlan.staleMessage ?? "Data er forældet.");
      }
    } catch {
      setError("Data er forældet. Jernbanen er blind lige nu – pas på.");
    } finally {
      setAiLoading(false);
      setLoading(false);
    }
  }

  const selectedCoordinates = useMemo(() => selectedRoute?.mapCoordinates ?? [], [selectedRoute?.mapCoordinates]);
  const fallbackRecommendedRouteId = useMemo(() => {
    if (!plan?.routes.length) return null;
    return [...plan.routes].sort((a, b) => b.pfm.reliabilityScore - a.pfm.reliabilityScore)[0]?.id ?? null;
  }, [plan?.routes]);
  const effectiveRecommendedRouteId = navigatorInsight?.recommendedRouteId ?? fallbackRecommendedRouteId;
  const shouldUseAutoRecommendation = Boolean(navigatorInsight && !navigatorInsight.recommendedRouteId);
  const showFallbackBranding = Boolean(navigatorInsight?.isFallback);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 md:max-w-3xl md:p-6">
      <section
        className={`rounded-2xl border p-4 font-mono ${
          showFallbackBranding ? "border-amber-700/60 bg-amber-950/30" : "border-cyan-900/60 bg-slate-950"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className={`text-xs uppercase tracking-wide ${showFallbackBranding ? "text-amber-300" : "text-cyan-300"}`}>
            Strategisk vurdering
          </div>
          {showFallbackBranding && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-200">
              <AlertTriangle className="h-3 w-3" />
              STATISTISK FALLBACK
            </span>
          )}
        </div>
        {aiLoading ? (
          <p className="mt-2 text-sm text-cyan-100">Analyserer kaos og passagertal...</p>
        ) : navigatorInsight ? (
          <p className="mt-2 text-sm text-slate-200">{navigatorInsight.message}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Kør en plan for at aktivere Navigator.</p>
        )}
        {plan?.crowdingSnapshot && (
          <div className="mt-2 text-xs text-slate-400">
            Passagertryk: {plan.crowdingSnapshot.tripsPerHour.toLocaleString("da-DK")} rejser/time (
            {plan.crowdingSnapshot.level})
          </div>
        )}
      </section>

      <header className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h1 className="text-xl font-semibold">Super Rejseplan</h1>
        <p className="mt-1 text-sm text-slate-300">Minimalistisk beslutningstager til vej ud af døren.</p>
        <label className="mt-4 flex items-center justify-between rounded-xl border border-slate-700 p-3">
          <span className="flex items-center gap-2 text-sm">
            <Bike className="h-4 w-4" />
            Medbringer el-løbehjul?
          </span>
          <button
            type="button"
            onClick={() => setScooterModeRequested((prev) => !prev)}
            className={`h-7 w-14 rounded-full transition ${scooterModeRequested ? "bg-cyan-500" : "bg-slate-700"}`}
          >
            <span
              className={`block h-6 w-6 rounded-full bg-white transition ${scooterModeRequested ? "translate-x-7" : "translate-x-0.5"}`}
            />
          </button>
        </label>
        {plan?.scooterWeatherWarning && (
          <div className="mt-3 rounded-xl bg-amber-300/20 p-2 text-sm text-amber-100">
            Det er dårligt vejr – jeg foreslår Metro/tog fremfor løbehjul.
          </div>
        )}
        {plan?.weatherSnapshot && (
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
            Vejr (
            {plan.weatherSnapshot.source === "DMI_EDR"
              ? `DMI EDR (Opdateret ${plan.weatherSnapshot.lastUpdated} UTC)`
              : `Fallback (Opdateret ${plan.weatherSnapshot.lastUpdated} UTC)`}): {plan.weatherSnapshot.summary}
          </div>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => runPlanning("WORK")}
          className="rounded-2xl bg-cyan-500 px-4 py-5 text-sm font-semibold text-slate-950"
          disabled={loading}
        >
          <Train className="mx-auto mb-1 h-4 w-4" />
          TIL ARBEJDE
        </button>
        <button
          type="button"
          onClick={() => runPlanning("HOME")}
          className="rounded-2xl bg-indigo-500 px-4 py-5 text-sm font-semibold"
          disabled={loading}
        >
          <Cloud className="mx-auto mb-1 h-4 w-4" />
          HJEM
        </button>
      </section>

      {loading && <div className="text-sm text-slate-300">Beregner ruter...</div>}
      {error && <div className="rounded-xl bg-red-500/20 p-3 text-sm text-red-100">{error}</div>}

      {plan?.strategicWait && <StrategicWaitBox message={plan.strategicWait} />}

      <section className="space-y-3">
        {plan?.routes.slice(0, 3).map((route) => (
          <DecisionCard
            key={route.id}
            route={route}
            onSelect={() => setSelectedRoute(route)}
            selected={selectedRoute?.id === route.id}
            aiRecommended={
              Boolean(
                (navigatorInsight?.recommendedRouteId && navigatorInsight.recommendedRouteId === route.id) ||
                (shouldUseAutoRecommendation && effectiveRecommendedRouteId === route.id)
              )
            }
          />
        ))}
      </section>

      <LiveMapPanel
        routeCoordinates={selectedCoordinates}
        currentPosition={currentPosition}
        scooterEnabled={scooterModeRequested}
      />
    </main>
  );
}
