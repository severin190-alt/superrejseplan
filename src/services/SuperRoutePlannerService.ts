import {
  GoogleTransitDirectionsClient,
  GoogleTransitDirectionsError,
  TransitTripBundle
} from "../api/GoogleTransitDirectionsClient";
import { FIXED_LOCATIONS, SALSA_DESTINATION } from "../config/constants";
import { PFMEngine } from "./PFMEngine";
import { DashboardDestination, DashboardRoute, GoogleRouteContext, PlannerResult } from "../types/dashboard";
import { RouteContextHit } from "../types/statusScraper";
import { StatusMessage, TransitLeg, TransitTrip } from "../types/transit";
import { PFMContext } from "../types/pfm";
import { CrowdingService } from "./CrowdingService";
import { WeatherService } from "./WeatherService";
import { InfrastructureMap } from "./InfrastructureMap";
import { StatusScraperService } from "./StatusScraperService";

export class SuperRoutePlannerService {
  constructor(
    private readonly directions = new GoogleTransitDirectionsClient(),
    private readonly statusScraper = new StatusScraperService(),
    private readonly pfmEngine = new PFMEngine(),
    private readonly crowdingService = new CrowdingService(),
    private readonly weatherService = new WeatherService(),
    private readonly infrastructureMap = new InfrastructureMap()
  ) {}

  async buildDashboardPlan(
    destination: DashboardDestination,
    scooterModeRequested: boolean,
    userPosition: { lat: number; lng: number }
  ): Promise<PlannerResult> {
    const nowMs = Date.now();
    try {
      const access = await this.directions.verifyDirectionsAccess();
      if (!access.ok) {
        return {
          routes: [],
          staleData: false,
          googleConfigError: true,
          loadError: `Google Config Error: Directions API afvist (${access.status}). ${access.message} Aktivér Directions API, tjek fakturering/kvote og at nøglen matcher projektet.`,
          dataTimestamp: new Date(nowMs).toISOString(),
          useMetro: "1",
          scooterWeatherWarning: false
        };
      }

      const location = userPosition;
      const [statusReport, weatherSnapshot] = await Promise.all([
        this.statusScraper.scrapeReport(),
        this.weatherService.getWeatherForPosition(location.lat, location.lng)
      ]);

      const rawMessages = this.statusScraper.statusMessagesFromReport(statusReport);
      const messages = this.pfmEngine.extractRelevantMessages(rawMessages);
      const crowdingSnapshot = this.crowdingService.estimate();

      const pfmContext: PFMContext = {
        statusMessages: messages,
        scooterModeRequested,
        weatherCondition: weatherSnapshot.summary,
        weatherSnapshot,
        salsaRouteUnstable: destination === "SALSA" && this.detectSalsaDisruption(statusReport.sections)
      };
      const queryOverrides = this.pfmEngine.computeTripQueryOverrides(pfmContext);

      const destQuery = this.resolveGoogleDestination(destination);
      const baseBundles = await this.directions.getTransitTripVariants(location, destQuery, false);
      const baseRoutes = await this.buildRoutesFromBundles(
        baseBundles.slice(0, 4),
        0,
        messages,
        scooterModeRequested,
        crowdingSnapshot.level,
        weatherSnapshot.summary,
        weatherSnapshot,
        pfmContext,
        statusReport
      );

      const criticalTrain = this.findCriticalTrainRoute(baseRoutes);
      let routes = baseRoutes;
      if (criticalTrain) {
        const hackerBundles = await this.directions.getHackerTransitTrips(location, destQuery);
        const qualifyingHackers = this.filterHackerBundles(hackerBundles, criticalTrain);
        if (qualifyingHackers.length > 0) {
          const hackerRoutes = await this.buildRoutesFromBundles(
            qualifyingHackers,
            baseRoutes.length,
            messages,
            scooterModeRequested,
            crowdingSnapshot.level,
            weatherSnapshot.summary,
            weatherSnapshot,
            pfmContext,
            statusReport
          );
          routes = this.mergeRoutes(baseRoutes, hackerRoutes).slice(0, 3);
        }
      } else {
        routes = baseRoutes.slice(0, 3);
      }

      const routeHits = this.collectRouteHits(statusReport.sections, routes);
      const sortedRoutes = this.sortRoutes(routes);
      const promotedRoutes = this.applyBusRecoveryPromotion(
        sortedRoutes,
        routeHits.some((hit) => hit.incidentCategory === "LONG"),
        weatherSnapshot
      );
      const statusDigest = this.statusScraper.digestForUi(statusReport, routeHits);

      const googleRouteContext: GoogleRouteContext = {
        routes: promotedRoutes.slice(0, 3).map((route, index) => ({
          durationSummary: route.trip.legs.map((leg) => leg.line).join(" → "),
          durationMinutes: this.routeDurationMinutes(route),
          warnings: index === 0 ? [] : []
        }))
      };

      return {
        routes: promotedRoutes,
        staleData: false,
        staleForMs: 0,
        dataTimestamp: new Date(nowMs).toISOString(),
        strategicWait: this.pickStrategicWait(promotedRoutes),
        useMetro: queryOverrides.useMetro,
        scooterWeatherWarning: queryOverrides.useMetro === "1" && scooterModeRequested,
        crowdingSnapshot,
        weatherSnapshot,
        statusDigest,
        googleRouteContext
      };
    } catch (err) {
      if (err instanceof GoogleTransitDirectionsError && err.kind === "config") {
        return {
          routes: [],
          staleData: false,
          googleConfigError: true,
          loadError: `Google Config Error: ${err.message}${err.status ? ` (${err.status})` : ""}. Tjek API-nøgle, Directions API og kvote.`,
          dataTimestamp: new Date(nowMs).toISOString(),
          useMetro: "1",
          scooterWeatherWarning: false
        };
      }
      const loadError =
        err instanceof Error
          ? err.message
          : "Ukendt fejl ved hentning af rejseplan.";
      return {
        routes: [],
        staleData: false,
        loadError,
        dataTimestamp: new Date(nowMs).toISOString(),
        useMetro: "1",
        scooterWeatherWarning: false
      };
    }
  }

  private detectSalsaDisruption(sections: Array<{ text: string }>): boolean {
    return sections.some((section) =>
      /forsink|aflyst|afbrud|fejl|indstillet|erstatning/i.test(section.text) &&
      /metro|s[\s-]*tog|\bm\s*[1-4]\b/i.test(section.text)
    );
  }

  private async buildRoutesFromBundles(
    bundles: TransitTripBundle[],
    startIndex: number,
    messages: StatusMessage[],
    scooterModeRequested: boolean,
    hardcodedCrowdingLevel: "LOW" | "MEDIUM" | "HIGH",
    weatherCondition: string,
    weatherSnapshot: PFMContext["weatherSnapshot"],
    pfmContext: PFMContext,
    statusReport: Awaited<ReturnType<StatusScraperService["scrapeReport"]>>
  ): Promise<DashboardRoute[]> {
    return Promise.all(
      bundles.map((bundle, index) =>
        this.buildRouteModel(
          bundle.trip,
          startIndex + index,
          messages,
          scooterModeRequested,
          hardcodedCrowdingLevel,
          weatherCondition,
          weatherSnapshot,
          bundle.mapCoordinates,
          bundle.journeyName,
          pfmContext,
          statusReport,
          Boolean(bundle.hackerVariant)
        )
      )
    );
  }

  private resolveGoogleDestination(destination: DashboardDestination): string {
    if (destination === "SALSA") {
      return `${SALSA_DESTINATION.lat},${SALSA_DESTINATION.lng}`;
    }
    if (destination === "WORK") {
      return FIXED_LOCATIONS.WORK;
    }
    return FIXED_LOCATIONS.HOME;
  }

  private async buildRouteModel(
    trip: TransitTrip,
    index: number,
    messages: StatusMessage[],
    scooterModeRequested: boolean,
    hardcodedCrowdingLevel?: "LOW" | "MEDIUM" | "HIGH",
    weatherCondition?: string,
    weatherSnapshot?: PFMContext["weatherSnapshot"],
    mapCoordinates: Array<{ lat: number; lng: number; label: string }> = [],
    journeyName?: string,
    pfmContext?: PFMContext,
    statusReport?: Awaited<ReturnType<StatusScraperService["scrapeReport"]>>,
    isHackerRoute = false
  ): Promise<DashboardRoute> {
    const legs = trip.legs;
    const routeIncident = statusReport
      ? this.statusScraper.routeIncidentForTrip(statusReport, legs, journeyName)
      : {
          category: "NONE" as const,
          usesTogbus: false,
          usesRegularBus: false,
          context: { hits: [], incidentCategory: "NONE" as const, identifiedCauses: [], alarmActive: false }
        };
    const pfmBase = this.pfmEngine.evaluateTrip(trip, {
      ...pfmContext,
      statusMessages: messages,
      statusIdentifiedCauses: routeIncident.context.identifiedCauses,
      scooterModeRequested,
      weatherCondition,
      weatherSnapshot,
      journeyName,
      routeIncidentCategory: routeIncident.category,
      routeUsesTogbus: routeIncident.usesTogbus,
      routeUsesRegularBus: routeIncident.usesRegularBus
    });
    const pfm = hardcodedCrowdingLevel === "HIGH" ? { ...pfmBase, crowdingLevel: "HIGH" as const } : pfmBase;
    const officialETA = this.getTrueETA(legs.at(-1)) ?? "--:--";
    const isBusOrMetroRoute = this.infrastructureMap.isBusOrMetroRoute(legs, journeyName);
    const hasLiveBusRealtime = this.infrastructureMap.hasRealtimeForBusLeg(legs, journeyName);

    return {
      id: `route-${index}-${isHackerRoute ? "hacker" : "base"}`,
      trip,
      pfm,
      officialETA,
      isBusOrMetroRoute,
      hasLiveBusRealtime,
      isHackerRoute,
      mapCoordinates
    };
  }

  private findCriticalTrainRoute(routes: DashboardRoute[]): DashboardRoute | undefined {
    return routes.find((route) => this.isCriticalRailRoute(route));
  }

  private isCriticalRailRoute(route: DashboardRoute): boolean {
    const hasTrain = route.trip.legs.some((leg) => leg.mode === "TRAIN");
    if (!hasTrain) return false;
    const reason = route.pfm.delayReason.toLowerCase();
    return (
      route.pfm.unstable ||
      reason.includes("personpåkørsel") ||
      reason.includes("personpaakorsel") ||
      reason.includes("signalfejl") ||
      route.pfm.reliabilityScore <= 35
    );
  }

  private filterHackerBundles(
    bundles: TransitTripBundle[],
    criticalTrain: DashboardRoute
  ): TransitTripBundle[] {
    const recoveryMinutes = this.minutesUntil(criticalTrain.pfm.pfmETA);
    return bundles.filter((bundle) => {
      const arrivalMinutes = this.minutesUntil(this.bundleArrivalTime(bundle));
      return arrivalMinutes < recoveryMinutes;
    });
  }

  private bundleArrivalTime(bundle: TransitTripBundle): string {
    const lastLeg = bundle.trip.legs.at(-1);
    return lastLeg?.arrivalTime ?? "23:59";
  }

  private mergeRoutes(baseRoutes: DashboardRoute[], hackerRoutes: DashboardRoute[]): DashboardRoute[] {
    const merged = [...hackerRoutes, ...baseRoutes];
    const seen = new Set<string>();
    const out: DashboardRoute[] = [];
    for (const route of merged) {
      const key = route.trip.legs
        .map((leg) => `${leg.mode}:${leg.line}:${leg.departureStop}:${leg.arrivalStop}`)
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(route);
    }
    return out;
  }

  private collectRouteHits(
    sections: Awaited<ReturnType<StatusScraperService["scrapeReport"]>>["sections"],
    routes: DashboardRoute[]
  ): RouteContextHit[] {
    const hits: RouteContextHit[] = [];
    const seen = new Set<string>();
    for (const route of routes) {
      const context = this.statusScraper.routeContextForTrip(sections, route.trip.legs);
      for (const hit of context.hits) {
        const key = `${hit.stopName}:${hit.source}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
      }
    }
    return hits;
  }

  private sortRoutes(routes: DashboardRoute[]): DashboardRoute[] {
    return routes.sort((a, b) => {
      if (a.pfm.isFavoriteRoute && a.pfm.status !== "RED") {
        return -1;
      }
      if (b.pfm.isFavoriteRoute && b.pfm.status !== "RED") {
        return 1;
      }
      return b.pfm.reliabilityScore - a.pfm.reliabilityScore;
    });
  }

  private pickStrategicWait(routes: DashboardRoute[]): string | undefined {
    const needsWait = routes.some((route) => route.pfm.delayReason.toLowerCase().includes("vent 20 min"));
    if (!needsWait) {
      return undefined;
    }
    return "Strategisk anbefaling: Vent 20 minutter. Du sparer 15 minutters trængsel og får en mere stabil tur.";
  }

  private applyBusRecoveryPromotion(
    routes: DashboardRoute[],
    longIncident: boolean,
    weatherSnapshot?: PlannerResult["weatherSnapshot"]
  ): DashboardRoute[] {
    const trainPrimary = routes.find((r) => !r.isBusOrMetroRoute);
    if (!trainPrimary || trainPrimary.pfm.reliabilityScore >= 60) {
      return routes;
    }
    const candidates = routes.filter((r) => r.isBusOrMetroRoute);
    if (candidates.length === 0) {
      return routes;
    }
    const quickest = candidates.sort(
      (a, b) => this.selectionScore(a, longIncident, weatherSnapshot) - this.selectionScore(b, longIncident, weatherSnapshot)
    )[0];
    return [quickest, ...routes.filter((r) => r.id !== quickest.id)];
  }

  private selectionScore(
    route: DashboardRoute,
    longIncident = false,
    weatherSnapshot?: PlannerResult["weatherSnapshot"]
  ): number {
    const minutes = this.minutesUntil(route.pfm.pfmETA);
    const reliabilityFactor = 1 + (1 - route.pfm.reliabilityScore / 100);
    const routeText = this.routeDescriptor(route).toLowerCase();
    const viaOrestadBonus = this.routeTouchesOrestad(route) ? -15 : 0;
    const isTogbus =
      route.trip.legs.some((leg) => leg.mode === "TOGBUS") ||
      /\btogbus|tog bus|rail replacement\b/i.test(routeText);
    const regularBusBonus =
      longIncident && this.infrastructureMap.routeHasRegularBusLine(routeText) && !isTogbus ? -10 : 0;
    const precip = weatherSnapshot?.precipitationProbability;
    const weatherPenalty =
      typeof precip === "number" && precip >= 0.4 ? 8 : typeof precip === "number" && precip >= 0.25 ? 4 : 0;
    const causePenalty = route.pfm.delayReason.toLowerCase().includes("status-radar") ? 6 : 0;
    const base = minutes * reliabilityFactor + viaOrestadBonus + regularBusBonus + weatherPenalty + causePenalty;
    const togbusPenaltyAfter = isTogbus ? 20 : 0;
    return base + togbusPenaltyAfter;
  }

  private routeDurationMinutes(route: DashboardRoute): number {
    return route.trip.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
  }

  private minutesUntil(hhmm: string): number {
    const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const target = Number(match[1]) * 60 + Number(match[2]);
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    return (target - current + 24 * 60) % (24 * 60);
  }

  private getTrueETA(lastLeg?: TransitLeg): string | undefined {
    return lastLeg?.arrivalTime;
  }

  private routeTouchesOrestad(route: DashboardRoute): boolean {
    const text = this.routeDescriptor(route).toLowerCase();
    return text.includes("ørestad") || text.includes("oerestad");
  }

  private routeDescriptor(route: DashboardRoute): string {
    return route.trip.legs
      .map((leg) => `${leg.line} ${leg.departureStop} ${leg.arrivalStop}`)
      .join(" ");
  }
}
