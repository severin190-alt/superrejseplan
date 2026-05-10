"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Bike, Cloud, Music, Train } from "lucide-react";
import { DecisionCard } from "../components/DecisionCard";
import { StrategicWaitBox } from "../components/StrategicWaitBox";
import { DashboardDestination, DashboardRoute, PlannerResult } from "../types/dashboard";
import { analyzeTravelSituation, AnalyzeTravelSituationResult } from "./actions/analyzeTravelSituation";
import { buildDashboardPlanAction } from "./actions/buildDashboardPlan";

function getBrowserPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation ikke tilgængelig. Tillad placering i browseren."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }),
      (geoErr) => reject(new Error(geoErr.message || "Kunne ikke læse GPS")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export default function DashboardPage() {
  const [scooterModeRequested, setScooterModeRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [activeDestination, setActiveDestination] = useState<DashboardDestination | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DashboardRoute | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [navigatorInsight, setNavigatorInsight] = useState<AnalyzeTravelSituationResult | null>(null);
  const lastGoodRef = useRef<{ plan: PlannerResult; at: number } | null>(null);

  async function runPlanning(destination: DashboardDestination) {
    setActiveDestination(destination);
    setLoading(true);
    setError(null);
    try {
      const position = await getBrowserPosition();
      const rawPlan = await buildDashboardPlanAction(destination, scooterModeRequested, position);

      let nextPlan: PlannerResult = rawPlan;
      const failed = Boolean(rawPlan.loadError);
      const googleConfig = Boolean(rawPlan.googleConfigError);

      if (failed) {
        if (googleConfig) {
          nextPlan = rawPlan;
          setError(rawPlan.loadError ?? "Google Config Error.");
        } else if (lastGoodRef.current) {
          const age = Date.now() - lastGoodRef.current.at;
          if (age < 3 * 60 * 1000) {
            nextPlan = {
              ...lastGoodRef.current.plan,
              staleData: false,
              staleForMs: age,
              loadError: undefined
            };
          } else {
            nextPlan = {
              ...rawPlan,
              routes: [],
              staleData: true,
              staleMessage: "Data er forældet. Jernbanen er blind lige nu – pas på.",
              staleForMs: age,
              loadError: undefined
            };
            setError(nextPlan.staleMessage ?? null);
          }
        } else {
          nextPlan = rawPlan;
          setError(rawPlan.loadError ?? "Kunne ikke hente rejseplan.");
        }
      } else {
        nextPlan = rawPlan;
        if (rawPlan.routes.length > 0) {
          lastGoodRef.current = { plan: rawPlan, at: Date.now() };
        }
      }

      console.log("[SuperRejseplan] plan (vist state)", nextPlan, "routes length:", nextPlan.routes?.length);

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
      const statusDigest = nextPlan.statusDigest;
      const statusScraperSummary = statusDigest
        ? [
            ...statusDigest.identifiedCauses.map((c) => `Årsag: ${c}`),
            ...statusDigest.summaryLines.slice(0, 4)
          ].join("\n")
        : undefined;
      const rawScraperExcerpt = statusDigest?.rawScraperExcerpt ?? "";

      const aiResult = await analyzeTravelSituation({
        officialData,
        pfmData,
        isScooterActive: scooterModeRequested,
        statusIdentifiedCauses: statusDigest?.identifiedCauses,
        statusScraperSummary,
        rawScraperExcerpt,
        googleRouteContext: nextPlan.googleRouteContext
      });
      setNavigatorInsight(aiResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Uventet fejl ved planlægning.";
      setError(msg);
    } finally {
      setAiLoading(false);
      setLoading(false);
    }
  }

  const fallbackRecommendedRouteId = useMemo(() => {
    if (!plan?.routes.length) return null;
    return [...plan.routes].sort((a, b) => b.pfm.reliabilityScore - a.pfm.reliabilityScore)[0]?.id ?? null;
  }, [plan?.routes]);
  const effectiveRecommendedRouteId = navigatorInsight?.recommendedRouteId ?? fallbackRecommendedRouteId;
  const shouldUseAutoRecommendation = Boolean(navigatorInsight && !navigatorInsight.recommendedRouteId);
  const showFallbackBranding = Boolean(navigatorInsight?.isFallback);
  const salsaRouteWarning = Boolean(plan?.statusDigest?.salsaLineRisk && plan?.statusDigest?.incidentCategory !== "NONE");

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
            {plan.weatherSnapshot.source === "GOOGLE_WEATHER"
              ? `Google Weather / weather.googleapis.com · ${plan.weatherSnapshot.lastUpdated} UTC`
              : `Fallback · ${plan.weatherSnapshot.lastUpdated} UTC`}
            ): {plan.weatherSnapshot.summary}
          </div>
        )}
      </header>

      <section className="grid grid-cols-3 gap-2 md:gap-3">
        <button
          type="button"
          onClick={() => runPlanning("WORK")}
          className="rounded-2xl bg-cyan-500 px-2 py-4 text-xs font-semibold text-slate-950 md:px-4 md:text-sm"
          disabled={loading}
        >
          <Train className="mx-auto mb-1 h-4 w-4" />
          TIL ARBEJDE
        </button>
        <button
          type="button"
          onClick={() => runPlanning("HOME")}
          className="rounded-2xl bg-indigo-500 px-2 py-4 text-xs font-semibold md:px-4 md:text-sm"
          disabled={loading}
        >
          <Cloud className="mx-auto mb-1 h-4 w-4" />
          HJEM
        </button>
        <button
          type="button"
          onClick={() => runPlanning("SALSA")}
          className={`rounded-2xl bg-purple-600 px-2 py-4 text-xs font-semibold text-white md:px-4 md:text-sm ${
            salsaRouteWarning ? "animate-pulse border-2 border-rose-400" : ""
          }`}
          disabled={loading}
        >
          <Music className="mx-auto mb-1 h-4 w-4" />
          TIL SALSA
        </button>
      </section>

      {plan?.statusDigest && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Status-radar (alle kilder)</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Opdateret {new Date(plan.statusDigest.fetchedAt).toLocaleString("da-DK")} · DSB, Metro, Rejseplanen mobil
          </p>
          {plan.statusDigest.identifiedCauses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {plan.statusDigest.identifiedCauses.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-100"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {plan.statusDigest.salsaLineRisk && (
            <p className="mt-2 text-xs text-fuchsia-200">
              M1/M2 eller S-tog C/H: aktiv forstyrrelse registreret — Vanløse/salsa-rute kan være ustabil.
            </p>
          )}
          <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs text-slate-300">
            {plan.statusDigest.summaryLines.map((line, i) => (
              <li key={i} className="border-l-2 border-slate-600 pl-2">
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
            {plan.statusDigest.sourceLabels.map((s) => (
              <span key={s.source}>
                {s.source}: {s.ok ? (s.count > 0 ? `${s.count} uddrag` : "OK") : "fejl"}
              </span>
            ))}
          </div>
        </section>
      )}

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
            activeDestination={activeDestination}
            weatherSnapshot={plan.weatherSnapshot}
            aiRecommended={
              Boolean(
                (navigatorInsight?.recommendedRouteId && navigatorInsight.recommendedRouteId === route.id) ||
                (shouldUseAutoRecommendation && effectiveRecommendedRouteId === route.id)
              )
            }
          />
        ))}
      </section>

    </main>
  );
}
