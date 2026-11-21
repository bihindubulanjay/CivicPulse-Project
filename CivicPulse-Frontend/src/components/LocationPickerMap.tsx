import { useEffect } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { UserCoords } from '../types/civicpulse';

const PICKER_PIN_ICON = L.divIcon({
  className: 'cp-pin-wrapper',
  iconSize: [32, 40],
  iconAnchor: [16, 38],
  html: `
    <div style="width:32px;height:40px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 4px 8px rgba(15,23,42,0.35));cursor:grab;">
      <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16 1C8.268 1 2 7.268 2 15C2 24.9 14.32 37.14 15.27 38.07C15.68 38.47 16.32 38.47 16.73 38.07C17.68 37.14 30 24.9 30 15C30 7.268 23.732 1 16 1Z" fill="#0F172A" stroke="#FFFFFF" stroke-width="2.5"/>
        <circle cx="16" cy="15" r="5.5" fill="#38BDF8"/>
      </svg>
    </div>
  `,
});

const USER_GPS_DOT_ICON = L.divIcon({
  className: 'cp-pin-wrapper',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: `
    <div style="width:16px;height:16px;border-radius:9999px;background:rgba(14,165,233,0.22);display:flex;align-items:center;justify-content:center;">
      <div style="width:9px;height:9px;border-radius:9999px;background:#0284c7;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(2,132,199,0.5);"></div>
    </div>
  `,
});

export interface PickerViewTarget {
  lat: number;
  lng: number;
  zoom?: number;
  nonce: number;
}

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  viewTarget: PickerViewTarget | null;
  userCoords: UserCoords | null;
  onPick: (lat: number, lng: number) => void;
}

function PickerMapController({
  viewTarget,
  onPick,
}: {
  viewTarget: PickerViewTarget | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    const container = map.getContainer();
    const timer = window.setTimeout(() => map.invalidateSize(), 150);
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);

  useEffect(() => {
    if (!viewTarget) return;
    const targetZoom = viewTarget.zoom ?? Math.max(map.getZoom(), 15);
    map.flyTo([viewTarget.lat, viewTarget.lng], targetZoom, { duration: 0.55 });
  }, [viewTarget, map]);

  return null;
}

/**
 * Interactive Leaflet location picker embedded inside the incident report dialog.
 * Clicking anywhere on the map or dragging the teardrop pin updates exact coordinates.
 */
export function LocationPickerMap({
  lat,
  lng,
  viewTarget,
  userCoords,
  onPick,
}: LocationPickerMapProps) {
  const accuracyMeters =
    userCoords?.accuracy !== undefined && Number.isFinite(userCoords.accuracy)
      ? Math.min(Math.max(userCoords.accuracy, 5), 5000)
      : null;

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-inner">
      <MapContainer
        center={[lat, lng]}
        zoom={viewTarget?.zoom ?? 13}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <PickerMapController viewTarget={viewTarget} onPick={onPick} />

        {userCoords ? (
          <>
            {accuracyMeters !== null ? (
              <Circle
                center={[userCoords.lat, userCoords.lng]}
                radius={accuracyMeters}
                pathOptions={{
                  color: '#0284c7',
                  weight: 1,
                  opacity: 0.45,
                  fillColor: '#38bdf8',
                  fillOpacity: 0.12,
                }}
              />
            ) : null}
            <Marker
              position={[userCoords.lat, userCoords.lng]}
              icon={USER_GPS_DOT_ICON}
              interactive={false}
            />
          </>
        ) : null}

        <Marker
          position={[lat, lng]}
          icon={PICKER_PIN_ICON}
          draggable
          eventHandlers={{
            dragend(e) {
              const pos = (e.target as L.Marker).getLatLng();
              onPick(pos.lat, pos.lng);
            },
          }}
        />
      </MapContainer>

      <div className="pointer-events-none absolute left-2.5 top-2.5 z-[400] rounded-full border border-slate-200/90 bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">
        Click map or drag pin to exact spot
      </div>
    </div>
  );
}
