import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { ArrowUpRight, Compass, Crosshair, MapPinPlus, ShieldCheck, X } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import { formatDistanceKm, haversineKm } from '../lib/geo';
import type { Category, Post, TravelAdvisory, UserCoords } from '../types/civicpulse';

const CATEGORY_COLORS: Record<Category, string> = {
  Disaster: '#f43f5e',
  Nature: '#10b981',
  Tourism: '#0ea5e9',
  Road: '#f59e0b',
};

const ADVISORY_BADGES: Record<TravelAdvisory, string> = {
  Safe: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Caution: 'bg-amber-50 text-amber-800 border-amber-200',
  Danger: 'bg-rose-50 text-rose-700 border-rose-200',
};

function createPinIcon(post: Post, selected: boolean): L.DivIcon {
  const color = post.is_resolved ? '#64748b' : CATEGORY_COLORS[post.category];
  const isHighDisaster = !post.is_resolved && post.category === 'Disaster' && post.severity >= 7;
  const ring = selected ? '0 0 0 4px rgba(15, 23, 42, 0.25)' : '0 4px 12px rgba(15, 23, 42, 0.28)';

  return L.divIcon({
    className: 'cp-pin-wrapper',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
    html: `
      <div class="${isHighDisaster ? 'cp-pin-pulse' : ''}" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
        <div style="
          width:${selected ? 24 : 20}px;
          height:${selected ? 24 : 20}px;
          border-radius:9999px;
          background:${color};
          border:3px solid #ffffff;
          box-shadow:${ring};
          display:flex;
          align-items:center;
          justify-content:center;
          color:#ffffff;
          font-size:10px;
          font-weight:800;
        ">${post.severity}</div>
      </div>
    `,
  });
}

const USER_GPS_ICON = L.divIcon({
  className: 'cp-pin-wrapper',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `
    <div style="width:22px;height:22px;border-radius:9999px;background:rgba(14,165,233,0.22);display:flex;align-items:center;justify-content:center;">
      <div style="width:12px;height:12px;border-radius:9999px;background:#0284c7;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(2,132,199,0.5);"></div>
    </div>
  `,
});

export interface MapFlyTarget {
  lat: number;
  lng: number;
  zoom: number;
  nonce: number;
}

function formatAccuracy(meters: number): string {
  return meters >= 1000 ? `±${(meters / 1000).toFixed(1)} km` : `±${Math.round(meters)} m`;
}

function MapEffectsController({
  flyTarget,
  layoutTrigger,
  pickMode,
  onPickLocation,
}: {
  flyTarget: MapFlyTarget | null;
  layoutTrigger: string;
  pickMode: boolean;
  onPickLocation: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (pickMode) {
        onPickLocation(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  useEffect(() => {
    if (!flyTarget) return;
    map.flyTo([flyTarget.lat, flyTarget.lng], flyTarget.zoom, { duration: 0.75 });
  }, [flyTarget, map]);

  useEffect(() => {
    const container = map.getContainer();
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [layoutTrigger, map]);

  return null;
}

interface LiveMapProps {
  posts: Post[];
  userCoords: UserCoords | null;
  selectedPostId: string | null;
  flyTarget: MapFlyTarget | null;
  layoutTrigger: string;
  onJumpToPost: (postId: string) => void;
  onPickLocationToReport?: (lat: number, lng: number) => void;
}

export function LiveMap({
  posts,
  userCoords,
  selectedPostId,
  flyTarget,
  layoutTrigger,
  onJumpToPost,
  onPickLocationToReport,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pickMode, setPickMode] = useState(false);

  const pins = useMemo(() => {
    return posts.map((post) => ({
      post,
      icon: createPinIcon(post, post.id === selectedPostId),
    }));
  }, [posts, selectedPostId]);

  const gpsAccuracyMeters =
    userCoords?.accuracy !== undefined && Number.isFinite(userCoords.accuracy)
      ? Math.min(Math.max(userCoords.accuracy, 5), 5000)
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-[420px] w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 shadow-glass ${
        pickMode ? '[&_.leaflet-container]:!cursor-crosshair' : ''
      }`}
    >
      <MapContainer
        center={[7.45, 80.55]}
        zoom={8}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapEffectsController
          flyTarget={flyTarget}
          layoutTrigger={layoutTrigger}
          pickMode={pickMode}
          onPickLocation={(lat, lng) => {
            setPickMode(false);
            onPickLocationToReport?.(lat, lng);
          }}
        />

        {userCoords ? (
          <>
            {gpsAccuracyMeters !== null ? (
              <Circle
                center={[userCoords.lat, userCoords.lng]}
                radius={gpsAccuracyMeters}
                pathOptions={{
                  color: '#0284c7',
                  weight: 1.5,
                  opacity: 0.45,
                  fillColor: '#38bdf8',
                  fillOpacity: 0.14,
                }}
              />
            ) : null}
            <Marker position={[userCoords.lat, userCoords.lng]} icon={USER_GPS_ICON}>
              <Popup>
                <div className="p-3">
                  <p className="text-xs font-bold text-slate-900">Your Current GPS</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
                  </p>
                  {userCoords.accuracy !== undefined && Number.isFinite(userCoords.accuracy) ? (
                    <p className="mt-1 text-[11px] font-semibold text-sky-700">
                      Accuracy: {formatAccuracy(userCoords.accuracy)}
                    </p>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          </>
        ) : null}

        {pins.map(({ post, icon }) => {
          const mediaSrc = resolveMediaUrl(post.media_url);
          const dist =
            userCoords !== null
              ? haversineKm(userCoords.lat, userCoords.lng, post.lat, post.lng)
              : null;

          return (
            <Marker key={post.id} position={[post.lat, post.lng]} icon={icon}>
              <Popup>
                <div className="bg-white">
                  {mediaSrc ? (
                    <div className="relative h-28 w-full overflow-hidden bg-slate-100">
                      <img
                        src={mediaSrc}
                        alt={post.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <div className="p-3.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${ADVISORY_BADGES[post.travel_advisory]}`}
                      >
                        {post.travel_advisory}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        Sev {post.severity}/10
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        AI {post.ai_authenticity_score}%
                      </span>
                    </div>

                    <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                      {post.title}
                    </h3>

                    <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                      <Compass className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{post.location_name}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      {post.lat.toFixed(5)}, {post.lng.toFixed(5)}
                    </p>
                    {dist !== null ? (
                      <p className="mt-0.5 text-[11px] font-semibold text-sky-600">
                        {formatDistanceKm(dist)}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onJumpToPost(post.id)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      <span>Jump to Post</span>
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Top-Right Controls: Pin Incident on Map + Live Pin Counter */}
      <div className="absolute right-3 top-3 z-[400] flex flex-wrap items-center justify-end gap-2">
        {onPickLocationToReport ? (
          <button
            type="button"
            onClick={() => setPickMode((prev) => !prev)}
            aria-pressed={pickMode}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm backdrop-blur transition ${
              pickMode
                ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
                : 'border-slate-200/90 bg-white/95 text-slate-800 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800'
            }`}
          >
            {pickMode ? (
              <>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cancel Pin Mode</span>
              </>
            ) : (
              <>
                <MapPinPlus className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                <span>Pin Incident on Map</span>
              </>
            )}
          </button>
        ) : null}

        <div className="pointer-events-none rounded-full border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
          {posts.length} {posts.length === 1 ? 'Pin' : 'Pins'} Live
        </div>
      </div>

      {/* Active Pin-Drop Banner */}
      {pickMode ? (
        <div className="absolute left-12 right-12 top-14 z-[400] flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-2xl border border-sky-300 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-white shadow-elevated backdrop-blur">
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />
            <span>Click anywhere on the map to report an incident at that exact spot</span>
            <button
              type="button"
              onClick={() => setPickMode(false)}
              className="ml-1 rounded-lg bg-white/15 px-2 py-0.5 text-[11px] font-bold hover:bg-white/25"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Compact Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          Disaster
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Nature
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          Tourism
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Road
        </span>
      </div>
    </div>
  );
}
