"use client";

import { useMemo } from "react";

export function LiveMapPanel({
  routeCoordinates,
  currentPosition,
  scooterEnabled
}: {
  routeCoordinates: Array<{ lat: number; lng: number; label: string }>;
  currentPosition?: { lat: number; lng: number };
  scooterEnabled: boolean;
}) {
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const mapUrl = useMemo(() => {
    if (!mapsKey) return null;
    if (routeCoordinates.length > 0) {
      const first = routeCoordinates[0];
      const last = routeCoordinates[routeCoordinates.length - 1];
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(mapsKey)}&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}&mode=transit`;
    }
    const lat = currentPosition?.lat ?? 55.6761;
    const lng = currentPosition?.lng ?? 12.5683;
    return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(mapsKey)}&center=${lat},${lng}&zoom=11`;
  }, [mapsKey, currentPosition?.lat, currentPosition?.lng, routeCoordinates]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-2 text-xs text-slate-300">
        Live map overlays: rute + live stop-punkter{ scooterEnabled ? " + scooter-radius (10 km)" : "" }
      </div>
      {mapUrl ? (
        <iframe title="Live map" src={mapUrl} className="h-64 w-full rounded-xl border-0 md:h-80" loading="lazy" />
      ) : (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 text-center text-xs text-slate-500 md:h-80">
          Sæt <code className="mx-1 text-slate-400">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> i <code className="mx-1 text-slate-400">.env.local</code> for at vise kortet.
        </div>
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
