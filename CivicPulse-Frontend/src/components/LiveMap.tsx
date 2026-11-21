import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  ArrowUpRight,
  Check,
  Compass,
  Copy,
  Crosshair,
  Loader2,
  LocateFixed,
  MapPin,
  MapPinPlus,
  Navigation,
  Radio,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiClient, resolveMediaUrl } from '../lib/api';
import { formatAccuracyMeters, formatDistanceKm, haversineKm } from '../lib/geo';
import type {
  Category,
  GeocodeSuggestion,
  GpsStatus,
  Post,
  ReverseGeocodeResponse,
  TravelAdvisory,
  UserCoords,
} from '../types/civicpulse';
import { useToast } from './ToastProvider';

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
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `
    <div style="width:24px;height:24px;border-radius:9999px;background:rgba(14,165,233,0.22);display:flex;align-items:center;justify-content:center;">
      <div style="width:13px;height:13px;border-radius:9999px;background:#0284c7;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(2,132,199,0.5);"></div>
    </div>
  `,
});

const INSPECT_PIN_ICON = L.divIcon({
  className: 'cp-pin-wrapper',
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  html: `
    <div style="width:34px;height:42px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 6px 10px rgba(15,23,42,0.35));">
      <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M17 1.5C8.992 1.5 2.5 7.992 2.5 16C2.5 26.35 15.27 39.04 16.25 40C16.67 40.42 17.33 40.42 17.75 40C18.73 39.04 31.5 26.35 31.5 16C31.5 7.992 25.008 1.5 17 1.5Z" fill="#EA4335" stroke="#FFFFFF" stroke-width="2.5"/>
        <circle cx="17" cy="16" r="5.5" fill="#FFFFFF"/>
      </svg>
    </div>
  `,
});

export interface MapFlyTarget {
  lat: number;
  lng: number;
  zoom: number;
  nonce: number;
}

interface InspectedPlace {
  lat: number;
  lng: number;
  loading: boolean;
  details: ReverseGeocodeResponse | null;
  accuracy?: number;
}

function MapEffectsController({
  flyTarget,
  layoutTrigger,
  onMapClick,
}: {
  flyTarget: MapFlyTarget | null;
  layoutTrigger: string;
  onMapClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
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
  gpsStatus: GpsStatus;
  gpsTracking: boolean;
  liveLocationDetails: ReverseGeocodeResponse | null;
  selectedPostId: string | null;
  flyTarget: MapFlyTarget | null;
  layoutTrigger: string;
  onRequestGps: () => void;
  onToggleGpsTracking: () => void;
  onJumpToPost: (postId: string) => void;
  onPickLocationToReport: (
    lat: number,
    lng: number,
    details?: ReverseGeocodeResponse | null,
  ) => void;
}

export function LiveMap({
  posts,
  userCoords,
  gpsStatus,
  gpsTracking,
  liveLocationDetails,
  selectedPostId,
  flyTarget,
  layoutTrigger,
  onRequestGps,
  onToggleGpsTracking,
  onJumpToPost,
  onPickLocationToReport,
}: LiveMapProps) {
  const { pushToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pickMode, setPickMode] = useState(false);

  // Floating Google-Maps-Style Place Search State
  const [mapQuery, setMapQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodeSuggestion[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [localFlyTarget, setLocalFlyTarget] = useState<MapFlyTarget | null>(null);

  // Google-Maps-Style Inspected Location Card State
  const [inspected, setInspected] = useState<InspectedPlace | null>(null);
  const [copiedCoords, setCopiedCoords] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const suppressSearchEffectRef = useRef(false);

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

  const inspectSpot = useCallback(
    (lat: number, lng: number, prefilled?: ReverseGeocodeResponse | null, accuracy?: number) => {
      inspectAbortRef.current?.abort();
      if (prefilled) {
        setInspected({ lat, lng, loading: false, details: prefilled, accuracy });
        return;
      }

      const controller = new AbortController();
      inspectAbortRef.current = controller;
      setInspected({ lat, lng, loading: true, details: null, accuracy });

      apiClient
        .geocodeReverse(lat, lng, controller.signal)
        .then((details) => {
          if (controller.signal.aborted) return;
          setInspected({ lat, lng, loading: false, details, accuracy });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setInspected({
            lat,
            lng,
            loading: false,
            details: {
              display_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              short_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
            },
            accuracy,
          });
        });
    },
    [],
  );

  const runPlaceSearch = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setShowResults(false);
      setSearchError(null);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setSearchError(null);

    try {
      const results = await apiClient.geocodeSearch(trimmed, 5, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(results);
      setShowResults(true);
      if (results.length === 0) {
        setSearchError('No matching location found — try adding town or district.');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSearchResults([]);
      setShowResults(true);
      setSearchError(err instanceof Error ? err.message : 'Search unavailable');
    } finally {
      if (searchAbortRef.current === controller) {
        setSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (suppressSearchEffectRef.current) {
      suppressSearchEffectRef.current = false;
      return;
    }
    const trimmed = mapQuery.trim();
    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      setSearchResults([]);
      setShowResults(false);
      setSearchError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runPlaceSearch(trimmed);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [mapQuery, runPlaceSearch]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      inspectAbortRef.current?.abort();
    };
  }, []);

  function selectSuggestion(item: GeocodeSuggestion) {
    suppressSearchEffectRef.current = true;
    setMapQuery(item.short_name);
    setShowResults(false);
    setSearchResults([]);
    setLocalFlyTarget({ lat: item.lat, lng: item.lng, zoom: 15, nonce: Date.now() });
    inspectSpot(item.lat, item.lng, {
      display_name: item.display_name,
      short_name: item.short_name,
      lat: item.lat,
      lng: item.lng,
      category: item.category,
      place_type: item.place_type,
      address: item.address,
    });
  }

  async function handleCopyCoords(lat: number, lng: number) {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCoords(true);
      window.setTimeout(() => setCopiedCoords(false), 1600);
    } catch {
      pushToast({ tone: 'info', title: 'Coordinates', description: text });
    }
  }

  const effectiveFlyTarget = localFlyTarget && (!flyTarget || localFlyTarget.nonce > flyTarget.nonce)
    ? localFlyTarget
    : flyTarget;

  const initialCenter: [number, number] = userCoords
    ? [userCoords.lat, userCoords.lng]
    : [7.8731, 80.7718];
  const initialZoom = userCoords ? 13 : 7;

  const nearbyCount = useMemo(() => {
    if (!inspected) return 0;
    return posts.filter(
      (p) => !p.is_resolved && haversineKm(inspected.lat, inspected.lng, p.lat, p.lng) <= 15,
    ).length;
  }, [inspected, posts]);

  const addressRows = useMemo(() => {
    const addr = inspected?.details?.address;
    if (!addr) return [];
    return [
      { label: 'Road / Place', value: addr.road },
      { label: 'Area / Suburb', value: addr.suburb },
      { label: 'City / Town', value: addr.city },
      { label: 'District', value: addr.district },
      { label: 'Province / State', value: addr.state },
      { label: 'Postcode', value: addr.postcode },
      { label: 'Country', value: addr.country },
    ].filter((r): r is { label: string; value: string } => Boolean(r.value));
  }, [inspected]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-[440px] w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 shadow-glass ${
        pickMode ? '[&_.leaflet-container]:!cursor-crosshair' : ''
      }`}
    >
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />

        <MapEffectsController
          flyTarget={effectiveFlyTarget}
          layoutTrigger={layoutTrigger}
          onMapClick={(lat, lng) => {
            setShowResults(false);
            if (pickMode) {
              setPickMode(false);
              onPickLocationToReport(lat, lng, null);
            } else {
              inspectSpot(lat, lng);
            }
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
            <Marker
              position={[userCoords.lat, userCoords.lng]}
              icon={USER_GPS_ICON}
              eventHandlers={{
                click() {
                  inspectSpot(
                    userCoords.lat,
                    userCoords.lng,
                    liveLocationDetails,
                    userCoords.accuracy,
                  );
                },
              }}
            >
              <Popup>
                <div className="p-3">
                  <p className="text-xs font-bold text-slate-900">Your Live Device Location</p>
                  {liveLocationDetails?.short_name ? (
                    <p className="mt-0.5 text-xs font-semibold text-sky-700">
                      {liveLocationDetails.short_name}
                    </p>
                  ) : null}
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
                  </p>
                  {userCoords.accuracy !== undefined && Number.isFinite(userCoords.accuracy) ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-sky-700">
                      Accuracy: {formatAccuracyMeters(userCoords.accuracy)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      onPickLocationToReport(userCoords.lat, userCoords.lng, liveLocationDetails)
                    }
                    className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                  >
                    <MapPinPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Report Here</span>
                  </button>
                </div>
              </Popup>
            </Marker>
          </>
        ) : null}

        {inspected ? (
          <Marker position={[inspected.lat, inspected.lng]} icon={INSPECT_PIN_ICON} />
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

      {/* Google-Maps-Style Floating Place Search Bar (Top-Left) */}
      <div className="absolute left-3 right-3 top-3 z-[450] sm:right-auto sm:w-80">
        <div className="relative">
          <label htmlFor="live-map-place-search" className="visually-hidden">
            Search place or address on map
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="live-map-place-search"
            type="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={mapQuery}
            onChange={(e) => setMapQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowResults(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                void runPlaceSearch(mapQuery);
              }
            }}
            placeholder="Search any address, road, or city..."
            className="w-full rounded-2xl border border-slate-200/90 bg-white/95 py-2.5 pl-9 pr-9 text-xs font-medium text-slate-900 shadow-elevated backdrop-blur placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
          {searching ? (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-600"
              aria-hidden="true"
            />
          ) : mapQuery ? (
            <button
              type="button"
              onClick={() => {
                setMapQuery('');
                setSearchResults([]);
                setShowResults(false);
                setSearchError(null);
              }}
              aria-label="Clear map search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {showResults && (searchResults.length > 0 || searchError) ? (
          <div className="mt-1.5 max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-elevated">
            {searchResults.length > 0 ? (
              <ul role="listbox" aria-label="Map search results" className="space-y-0.5">
                {searchResults.map((item, idx) => (
                  <li key={`${item.lat}-${item.lng}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => selectSuggestion(item)}
                      className="flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-sky-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-900">{item.short_name}</p>
                        <p className="truncate text-[11px] text-slate-500">{item.display_name}</p>
                      </div>
                      {item.place_type ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
                          {item.place_type}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-xs text-slate-600">{searchError}</p>
            )}
          </div>
        ) : null}
      </div>

      {/* Top-Right Controls: Pin Incident on Map + Live Pin Counter */}
      <div className="absolute right-3 top-14 z-[440] flex flex-wrap items-center justify-end gap-2 sm:top-3">
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

        <div className="pointer-events-none rounded-full border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
          {posts.length} {posts.length === 1 ? 'Pin' : 'Pins'} Live
        </div>
      </div>

      {/* Active Pin-Drop Banner */}
      {pickMode ? (
        <div className="absolute left-6 right-6 top-28 z-[440] flex items-center justify-center sm:top-16">
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

      {/* Bottom-Right Live GPS & Follow Controls (above Leaflet ZoomControl) */}
      <div className="absolute bottom-24 right-2.5 z-[440] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => {
            onRequestGps();
            if (userCoords) {
              setLocalFlyTarget({
                lat: userCoords.lat,
                lng: userCoords.lng,
                zoom: userCoords.accuracy && userCoords.accuracy > 500 ? 13 : 16,
                nonce: Date.now(),
              });
              inspectSpot(
                userCoords.lat,
                userCoords.lng,
                liveLocationDetails,
                userCoords.accuracy,
              );
            }
          }}
          title="Center map on my live GPS location & inspect address"
          aria-label="My live location"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md transition hover:bg-sky-50 hover:text-sky-700"
        >
          {gpsStatus === 'locating' ? (
            <Loader2 className="h-4 w-4 animate-spin text-sky-600" aria-hidden="true" />
          ) : (
            <LocateFixed
              className={`h-4 w-4 ${userCoords ? 'text-sky-600' : 'text-slate-600'}`}
              aria-hidden="true"
            />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleGpsTracking}
          aria-pressed={gpsTracking}
          title={gpsTracking ? 'Disable continuous live GPS tracking' : 'Enable live GPS tracking'}
          aria-label="Toggle live GPS tracking"
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-md transition ${
            gpsTracking
              ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Radio
            className={`h-4 w-4 ${gpsTracking ? 'animate-pulse' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Google-Maps-Style Inspected Location Details Card OR Compact Legend */}
      {inspected ? (
        <div className="absolute bottom-3 left-3 right-14 z-[450] max-w-md rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-elevated backdrop-blur-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
                <h4 className="truncate text-sm font-extrabold text-slate-900">
                  {inspected.loading
                    ? 'Fetching location details...'
                    : inspected.details?.short_name ?? `${inspected.lat.toFixed(5)}, ${inspected.lng.toFixed(5)}`}
                </h4>
                {inspected.details?.place_type ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-600">
                    {inspected.details.place_type}
                  </span>
                ) : null}
              </div>

              {inspected.details?.display_name ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                  {inspected.details.display_name}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                inspectAbortRef.current?.abort();
                setInspected(null);
              }}
              aria-label="Close location details"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {addressRows.length > 0 ? (
            <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-100 bg-slate-50/90 p-2 text-[11px]">
              {addressRows.slice(0, 6).map((row) => (
                <div key={row.label} className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {row.label}
                  </span>
                  <span className="block truncate font-semibold text-slate-800">{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-mono font-semibold text-slate-700">
              {inspected.lat.toFixed(6)}, {inspected.lng.toFixed(6)}
            </span>
            {inspected.accuracy !== undefined && Number.isFinite(inspected.accuracy) ? (
              <span className="font-semibold text-sky-700">
                GPS {formatAccuracyMeters(inspected.accuracy)}
              </span>
            ) : userCoords ? (
              <span className="font-semibold text-sky-700">
                {formatDistanceKm(haversineKm(userCoords.lat, userCoords.lng, inspected.lat, inspected.lng))}
              </span>
            ) : null}
            <span className="font-semibold text-slate-700">
              {nearbyCount} active {nearbyCount === 1 ? 'alert' : 'alerts'} within 15 km
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onPickLocationToReport(inspected.lat, inspected.lng, inspected.details);
                setInspected(null);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              <MapPinPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Report Incident Here</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopyCoords(inspected.lat, inspected.lng)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {copiedCoords ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedCoords ? 'Copied' : 'Coords'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setLocalFlyTarget({
                  lat: inspected.lat,
                  lng: inspected.lng,
                  zoom: 16,
                  nonce: Date.now(),
                })
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              title="Zoom closely to pinned spot"
            >
              <Navigation className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
