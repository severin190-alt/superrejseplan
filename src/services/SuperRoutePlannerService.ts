import {
  GoogleTransitDirectionsClient,
  GoogleTransitDirectionsError
} from "../api/GoogleTransitDirectionsClient";
import { FIXED_LOCATIONS, SALSA_DESTINATION } from "../config/constants";
import { PFMEngine } from "./PFMEngine";
import { DashboardDestination, DashboardRoute, GoogleRouteContext, PlannerResult } from "../types/dashboard";
import { HIMMessage, Leg, Trip } from "../types/rejseplanen";
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

      const rawMessages = this.statusScraper.himMessagesFromReport(statusReport);
      const messages = this.pfmEngine.extractRelevantMessages(rawMessages);
      const crowdingSnapshot = this.crowdingService.estimate();

      const salsaRouteUnstable =
        destination === "SALSA" && Boolean(statusReport.salsaLineRisk);

      const pfmContext: PFMContext = {
        himMessages: messages,
        scooterModeRequested,
        weatherCondition: weatherSnapshot.summary,
        weatherSnapshot,
        statusIdentifiedCauses: statusReport.identifiedCauses,
        salsaRouteUnstable
      };
      const queryOverrides = this.pfmEngine.computeTripQueryOverrides(pfmContext);

      const destQuery = this.resolveGoogleDestination(destination);
      const bundles = await this.directions.getTransitTrips(location, destQuery);

      const googleRouteContext: GoogleRouteContext = {
        routes: bundles.slice(0, 3).map((b) => ({
          durationSummary: b.durationSummary,
          durationMinutes: Math.max(1, Math.round(b.durationSeconds / 60)),
          warnings: b.warnings
        }))
      };

      const routes = await Promise.all(
        bundles.slice(0, 3).map((bundle, index) =>
          this.buildRouteModel(
            bundle.trip,
            index,
            messages,
            scooterModeRequested,
            crowdingSnapshot.level,
            weatherSnapshot.summary,
            weatherSnapshot,
            bundle.mapCoordinates,
            bundle.journeyName,
            pfmContext,
            statusReport
          )
        )
      );

      const sortedRoutes = this.sortRoutes(routes);
      const promotedRoutes = this.applyBusRecoveryPromotion(sortedRoutes, statusReport.incidentCategory === "LONG");
      const statusDigest = this.statusScraper.digestForUi(statusReport);

      const result: PlannerResult = {
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
      return result;
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
    trip: Trip,
    index: number,
    messages: HIMMessage[],
    scooterModeRequested: boolean,
    hardcodedCrowdingLevel?: "LOW" | "MEDIUM" | "HIGH",
    weatherCondition?: string,
    weatherSnapshot?: PFMContext["weatherSnapshot"],
    mapCoordinates: Array<{ lat: number; lng: number; label: string }> = [],
    journeyName?: string,
    pfmContext?: PFMContext,
    statusReport?: Awaited<ReturnType<StatusScraperService["scrapeReport"]>>
  ): Promise<DashboardRoute> {
    const legs = this.toArray<Leg>(trip.Leg);
    const routeIncident = statusReport
      ? this.statusScraper.routeIncidentForTrip(statusReport, legs, journeyName)
      : { category: "NONE" as const, usesTogbus: false, usesRegularBus: false };
    const pfmBase = this.pfmEngine.evaluateTrip(trip, {
      ...pfmContext,
      himMessages: messages,
      scooterModeRequested,
      weatherCondition,
      weatherSnapshot,
      journeyName,
      routeIncidentCategory: routeIncident.category,
      routeUsesTogbus: routeIncident.usesTogbus,
      routeUsesRegularBus: routeIncident.usesRegularBus
    });
    const pfm = hardcodedCrowdingLevel === "HIGH" ? { ...pfmBase, crowdingLevel: "HIGH" as const } : pfmBase;
    const officialETA = this.getTrueETA(legs.at(-1), legs.at(-1)?.Destination) ?? "--:--";
    const isBusOrMetroRoute = this.infrastructureMap.isBusOrMetroRoute(legs, journeyName);
    const hasLiveBusRealtime = this.infrastructureMap.hasRealtimeForBusLeg(legs, journeyName);

    return {
      id: `route-${index}`,
      trip,
      pfm,
      officialETA,
      isBusOrMetroRoute,
      hasLiveBusRealtime,
      mapCoordinates,
      liveVehicleCoordinate: undefined
    };
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

  private applyBusRecoveryPromotion(routes: DashboardRoute[], longIncident: boolean): DashboardRoute[] {
    const trainPrimary = routes.find((r) => !r.isBusOrMetroRoute);
    if (!trainPrimary || trainPrimary.pfm.reliabilityScore >= 60) {
      return routes;
    }
    const candidates = routes.filter((r) => r.isBusOrMetroRoute);
    if (candidates.length === 0) {
      return routes;
    }
    const quickest = candidates.sort((a, b) => this.selectionScore(a, longIncident) - this.selectionScore(b, longIncident))[0];
    return [quickest, ...routes.filter((r) => r.id !== quickest.id)];
  }

  private selectionScore(route: DashboardRoute, longIncident = false): number {
    const minutes = this.minutesUntil(route.pfm.pfmETA);
    const reliabilityFactor = 1 + (1 - route.pfm.reliabilityScore / 100);
    const routeText = this.routeDescriptor(route).toLowerCase();
    const viaOrestadBonus = this.routeTouchesOrestad(route) ? -15 : 0;
    const isTogbus = /\btogbus|tog bus|rail replacement\b/i.test(routeText);
    const regularBusBonus =
      longIncident && this.infrastructureMap.routeHasRegularBusLine(routeText) && !isTogbus ? -10 : 0;
    const base = minutes * reliabilityFactor + viaOrestadBonus + regularBusBonus;
    const togbusPenaltyAfter = longIncident && isTogbus ? 20 : 0;
    return base + togbusPenaltyAfter;
  }

  private minutesUntil(hhmm: string): number {
    const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const target = Number(match[1]) * 60 + Number(match[2]);
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    return (target - current + 24 * 60) % (24 * 60);
  }

  private getTrueETA(lastLeg?: Leg, destination?: Leg["Destination"]): string | undefined {
    return lastLeg?.rtArrivalTime ?? destination?.rtTime ?? destination?.time;
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private routeTouchesOrestad(route: DashboardRoute): boolean {
    return this.routeDescriptor(route).toLowerCase().includes("ørestad") || this.routeDescriptor(route).toLowerCase().includes("oerestad");
  }

  private routeDescriptor(route: DashboardRoute): string {
    const legs = this.toArray<Leg>(route.trip.Leg);
    const stops = legs.map((leg) => `${leg.Origin?.name ?? ""} ${leg.Destination?.name ?? ""}`).join(" ");
    const notes = legs
      .flatMap((leg) => {
        const note = leg.Notes?.Note;
        if (!note) return [];
        return Array.isArray(note) ? note.map((n) => n.value ?? "") : [note.value ?? ""];
      })
      .join(" ");
    return `${stops} ${notes}`;
  }
}
