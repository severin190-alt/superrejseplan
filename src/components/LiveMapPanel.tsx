"use client";

import { useMemo } from "react";
import { GoogleMap, Marker, Polyline, useLoadScript } from "@react-google-maps/api";

export function LiveMapPanel({
  routeCoordinates,
  currentPosition,
  scooterEnabled,
  unstable
}: {
  routeCoordinates: Array<{ lat: number; lng: number; label: string }>;
  currentPosition?: { lat: number; lng: number };
  scooterEnabled: boolean;
  unstable?: boolean;
}) {
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const { isLoaded } = useLoadScript({ googleMapsApiKey: mapsKey });

  const center = useMemo(() => {
    if (routeCoordinates.length > 0) {
      return { lat: routeCoordinates[0].lat, lng: routeCoordinates[0].lng };
    }
    return { lat: currentPosition?.lat ?? 55.6761, lng: currentPosition?.lng ?? 12.5683 };
  }, [currentPosition?.lat, currentPosition?.lng, routeCoordinates]);

  const liveVehiclePosition = useMemo(() => {
    if (routeCoordinates.length === 0) return undefined;
    const idx = Math.floor((routeCoordinates.length - 1) * 0.5);
    return routeCoordinates[idx];
  }, [routeCoordinates]);

  const stableSegment = useMemo(
    () => (unstable ? routeCoordinates.slice(0, Math.max(2, Math.floor(routeCoordinates.length * 0.6))) : routeCoordinates),
    [routeCoordinates, unstable]
  );
  const unstableSegment = useMemo(
    () => (unstable ? routeCoordinates.slice(Math.max(1, Math.floor(routeCoordinates.length * 0.55))) : []),
    [routeCoordinates, unstable]
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-2 text-xs text-slate-300">
        Live map overlays: rute + live stop-punkter{ scooterEnabled ? " + scooter-radius (10 km)" : "" }
      </div>
      {!mapsKey ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 text-center text-xs text-slate-500 md:h-80">
          Sæt <code className="mx-1 text-slate-400">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> i <code className="mx-1 text-slate-400">.env.local</code> for at vise kortet.
        </div>
      ) : !isLoaded ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/50 px-4 text-center text-xs text-slate-500 md:h-80">
          Indlæser interaktivt kort...
        </div>
      ) : (
        <GoogleMap
          center={center}
          zoom={routeCoordinates.length > 0 ? 11 : 10}
          mapContainerClassName="h-64 w-full rounded-xl md:h-80"
          options={{ disableDefaultUI: false, streetViewControl: false, mapTypeControl: false }}
        >
          {stableSegment.length > 1 && (
            <Polyline
              path={stableSegment}
              options={{ strokeColor: "#06b6d4", strokeWeight: 4, strokeOpacity: 0.95 }}
            />
          )}
          {unstableSegment.length > 1 && (
            <Polyline
              path={unstableSegment}
              options={{ strokeColor: "#ef4444", strokeWeight: 5, strokeOpacity: 0.95 }}
            />
          )}
          {routeCoordinates[0] && <Marker position={routeCoordinates[0]} label="A" />}
          {routeCoordinates.length > 1 && <Marker position={routeCoordinates[routeCoordinates.length - 1]} label="B" />}
          {liveVehiclePosition && <Marker position={liveVehiclePosition} title="Live position" label="LIVE" />}
          {!routeCoordinates.length && currentPosition && <Marker position={currentPosition} title="Aktuel position" />}
        </GoogleMap>
      )}
      {routeCoordinates.length > 0 && (
        <div className="mt-2 text-xs text-slate-400">
          Live positions: {routeCoordinates.slice(0, 5).map((c) => c.label).join(", ")}
        </div>
      )}
      {scooterEnabled && currentPosition && (
        <div className="mt-1 text-xs text-cyan-300">
          Scooter-radius aktiv omkring {currentPosition.lat.toFixed(3)}, {currentPosition.lng.toFixed(3)}.
        </div>
      )}
    </div>
  );
}
