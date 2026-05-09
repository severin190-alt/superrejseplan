import { FIXED_LOCATIONS } from "../config/constants";
import { RejseplanenClient } from "../api/RejseplanenClient";
import { PFMEngine } from "./PFMEngine";
import { DashboardDestination, DashboardRoute, PlannerResult } from "../types/dashboard";
import { HIMMessage, JourneyDetailStop, Leg, Location, Trip } from "../types/rejseplanen";
import { PFMContext } from "../types/pfm";
import { CrowdingService } from "./CrowdingService";
import { WeatherService } from "./WeatherService";
import { InfrastructureMap } from "./InfrastructureMap";

export class SuperRoutePlannerService {
  constructor(
    private readonly client = new RejseplanenClient(),
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
      const location = userPosition;
      const messages = await this.getMessages();
      const crowdingSnapshot = this.crowdingService.estimate();
      const weatherSnapshot = await this.weatherService.getWeatherForPosition(location.lat, location.lng);
      const pfmContext: PFMContext = {
        himMessages: messages,
        scooterModeRequested,
        weatherCondition: weatherSnapshot.summary,
        weatherSnapshot
      };
      const queryOverrides = this.pfmEngine.computeTripQueryOverrides(pfmContext);

      const originId = await this.resolveOriginStopId(location.lat, location.lng);
      const destId = await this.resolveDestinationId(destination);

      const tripResponse = await this.client.getTrip(originId, destId, {
        useMetro: queryOverrides.useMetro === "1"
      });

      const trips = this.toArray(tripResponse.TripList?.Trip).slice(0, 3);
      const routes = await Promise.all(
        trips.map((trip, index) =>
          this.buildRouteModel(
            trip,
            index,
            messages,
            scooterModeRequested,
            crowdingSnapshot.level,
            weatherSnapshot.summary,
            weatherSnapshot
          )
        )
      );

      const sortedRoutes = this.sortRoutes(routes);
      const promotedRoutes = this.applyBusRecoveryPromotion(sortedRoutes);
      const result: PlannerResult = {
        routes: promotedRoutes,
        staleData: false,
        staleForMs: 0,
        dataTimestamp: new Date(nowMs).toISOString(),
        strategicWait: this.pickStrategicWait(promotedRoutes),
        useMetro: queryOverrides.useMetro,
        scooterWeatherWarning: queryOverrides.useMetro === "1" && scooterModeRequested,
        crowdingSnapshot,
        weatherSnapshot
      };
      return result;
    } catch (err) {
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

  private async buildRouteModel(
    trip: Trip,
    index: number,
    messages: HIMMessage[],
    scooterModeRequested: boolean,
    hardcodedCrowdingLevel?: "LOW" | "MEDIUM" | "HIGH",
    weatherCondition?: string,
    weatherSnapshot?: PFMContext["weatherSnapshot"]
  ): Promise<DashboardRoute> {
    const legs = this.toArray<Leg>(trip.Leg);
    const ref = legs.at(0)?.JourneyDetailRef?.ref;
    const journeyData = ref ? await this.fetchJourneyData(ref) : { mapCoordinates: [], journeyName: undefined };
    const pfmBase = this.pfmEngine.evaluateTrip(trip, {
      himMessages: messages,
      scooterModeRequested,
      weatherCondition,
      weatherSnapshot,
      journeyName: journeyData.journeyName
    });
    const pfm = hardcodedCrowdingLevel === "HIGH" ? { ...pfmBase, crowdingLevel: "HIGH" as const } : pfmBase;
    const officialETA = this.getTrueETA(legs.at(-1), legs.at(-1)?.Destination) ?? "--:--";
    const isBusOrMetroRoute = this.infrastructureMap.isBusOrMetroRoute(legs, journeyData.journeyName);
    const hasLiveBusRealtime = this.infrastructureMap.hasRealtimeForBusLeg(legs, journeyData.journeyName);

    return {
      id: `route-${index}`,
      trip,
      pfm,
      officialETA,
      isBusOrMetroRoute,
      hasLiveBusRealtime,
      mapCoordinates: journeyData.mapCoordinates,
      liveVehicleCoordinate: journeyData.liveVehicleCoordinate
    };
  }

  private async fetchJourneyData(ref: string): Promise<{
    mapCoordinates: Array<{ lat: number; lng: number; label: string }>;
    journeyName?: string;
    liveVehicleCoordinate?: { lat: number; lng: number; label: string; estimated: boolean };
  }> {
    const detail = await this.client.getJourneyDetail(ref);
    const stops = this.toArray<JourneyDetailStop>(detail.JourneyDetail?.stop);
    const mapCoordinates = stops
      .map((stop) => ({
        lat: Number(stop.lat),
        lng: Number(stop.lon),
        label: stop.name ?? "Stop"
      }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    const liveStop = this.pickLatestRealtimeStop(stops);
    const estimatedStop = !liveStop ? stops.find((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))) : undefined;
    return {
      mapCoordinates,
      journeyName: detail.JourneyDetail?.name,
      liveVehicleCoordinate: liveStop
        ? {
            lat: Number(liveStop.lat),
            lng: Number(liveStop.lon),
            label: liveStop.name ?? "Live",
            estimated: false
          }
        : estimatedStop
          ? {
              lat: Number(estimatedStop.lat),
              lng: Number(estimatedStop.lon),
              label: `${estimatedStop.name ?? "Position"} (estimeret)`,
              estimated: true
            }
          : undefined
    };
  }

  private async resolveOriginStopId(lat: number, lng: number): Promise<string> {
    const nearby = await this.client.getNearbyStopsByCoordinates(lng, lat, { maxNo: 1 });
    const stop = this.firstLocation(nearby.LocationList?.StopLocation ?? nearby.LocationList?.CoordLocation);
    if (!stop?.id) {
      throw new Error("No origin stop id found");
    }
    return stop.id;
  }

  private async resolveDestinationId(destination: DashboardDestination): Promise<string> {
    const query = destination === "WORK" ? FIXED_LOCATIONS.WORK : FIXED_LOCATIONS.HOME;
    const result = await this.client.getLocation(query);
    const address = this.firstLocation(result.LocationList?.Address ?? result.LocationList?.StopLocation);
    if (!address?.id) {
      throw new Error("No destination id found");
    }
    return address.id;
  }

  private async getMessages(): Promise<HIMMessage[]> {
    const him = await this.client.getTrafficMessages();
    const raw = this.toArray(him.HIMMessageList?.HIMMessage);
    return this.pfmEngine.extractRelevantMessages(raw);
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

  private applyBusRecoveryPromotion(routes: DashboardRoute[]): DashboardRoute[] {
    const trainPrimary = routes.find((r) => !r.isBusOrMetroRoute);
    if (!trainPrimary || trainPrimary.pfm.reliabilityScore >= 60) {
      return routes;
    }
    const candidates = routes.filter((r) => r.isBusOrMetroRoute);
    if (candidates.length === 0) {
      return routes;
    }
    const quickest = candidates.sort((a, b) => this.selectionScore(a) - this.selectionScore(b))[0];
    return [quickest, ...routes.filter((r) => r.id !== quickest.id)];
  }

  private selectionScore(route: DashboardRoute): number {
    const minutes = this.minutesUntil(route.pfm.pfmETA);
    const reliabilityFactor = 1 + (1 - route.pfm.reliabilityScore / 100);
    return minutes * reliabilityFactor;
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
    const destinationAny = destination as unknown as { rtTime?: string; arrivalTime?: string; time?: string } | undefined;
    return lastLeg?.rtArrivalTime ?? destinationAny?.rtTime ?? destinationAny?.arrivalTime ?? destinationAny?.time;
  }

  private pickLatestRealtimeStop(stops: JourneyDetailStop[]): JourneyDetailStop | undefined {
    const now = Date.now();
    const candidates = stops
      .map((stop) => ({
        stop,
        ts: this.resolveStopRealtimeEpoch(stop)
      }))
      .filter((x): x is { stop: JourneyDetailStop; ts: number } => typeof x.ts === "number" && x.ts <= now)
      .sort((a, b) => b.ts - a.ts);
    return candidates[0]?.stop;
  }

  private resolveStopRealtimeEpoch(stop: JourneyDetailStop): number | undefined {
    const date = stop.rtDepDate ?? stop.rtArrDate ?? stop.depDate ?? stop.arrDate;
    const time = stop.rtDepTime ?? stop.rtArrTime ?? stop.depTime ?? stop.arrTime;
    if (!time) return undefined;
    const parsed = this.parseDateTime(date, time);
    return parsed?.getTime();
  }

  private parseDateTime(date: string | undefined, time: string): Date | undefined {
    if (date) {
      const d = new Date(`${date}T${time}:00`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const now = new Date();
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return undefined;
    const d = new Date(now);
    d.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return d;
  }

  private firstLocation(value: Location | Location[] | undefined): Location | undefined {
    const arr = this.toArray(value);
    return arr[0];
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

}
