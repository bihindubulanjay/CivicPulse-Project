import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CloudOff,
  Crosshair,
  Info,
  Loader2,
  Lock,
  MapPin,
  Radio,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { formatAccuracyMeters } from '../lib/geo';
import { compressFileToJpegDataUrl, enqueueOfflineReport } from '../lib/offlineQueue';
import type {
  AuthSession,
  Category,
  CreatePostRequest,
  GeocodeSuggestion,
  Post,
  ReverseGeocodeResponse,
  UserCoords,
} from '../types/civicpulse';
import { LocationPickerMap, type PickerViewTarget } from './LocationPickerMap';
import { ModalDialog } from './ModalDialog';
import { useToast } from './ToastProvider';

type LocationSource = 'default' | 'gps' | 'search' | 'map' | 'manual';

const SOURCE_LABELS: Record<LocationSource, string> = {
  default: 'Awaiting Pin',
  gps: 'Live GPS',
  search: 'Place Search',
  map: 'Map Pin',
  manual: 'Manual Coords',
};

interface ReportIncidentModalProps {
  open: boolean;
  session: AuthSession | null;
  allowGuestUploads: boolean;
  userCoords: UserCoords | null;
  liveLocationDetails?: ReverseGeocodeResponse | null;
  defaultLat?: number;
  defaultLng?: number;
  initialPin?: { lat: number; lng: number } | null;
  initialAddressDetails?: ReverseGeocodeResponse | null;
  onGpsDetected: (coords: UserCoords) => void;
  onClose: () => void;
  onOpenAuth: () => void;
  onPostCreated: (post: Post) => void;
  onQueueUpdated: (count: number) => void;
  onGuestPolicySynced: (allowed: boolean) => void;
}

export function ReportIncidentModal({
  open,
  session,
  allowGuestUploads,
  userCoords,
  liveLocationDetails = null,
  defaultLat = 7.8731,
  defaultLng = 80.7718,
  initialPin = null,
  initialAddressDetails = null,
  onGpsDetected,
  onClose,
  onOpenAuth,
  onPostCreated,
  onQueueUpdated,
  onGuestPolicySynced,
}: ReportIncidentModalProps) {
  const { pushToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('Disaster');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState(() => defaultLat.toFixed(6));
  const [lng, setLng] = useState(() => defaultLng.toFixed(6));

  // Location Picker & Structured Address State
  const [locationSource, setLocationSource] = useState<LocationSource>('default');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [detectingGps, setDetectingGps] = useState(false);
  const [pickerViewTarget, setPickerViewTarget] = useState<PickerViewTarget | null>(null);
  const [resolvedDetails, setResolvedDetails] = useState<ReverseGeocodeResponse | null>(null);

  const [placeQuery, setPlaceQuery] = useState('');
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locatingName, setLocatingName] = useState(false);
  const [reversingPlace, setReversingPlace] = useState(false);
  const [reverseSuggestion, setReverseSuggestion] = useState<string | null>(null);

  // Media State
  const [mediaMode, setMediaMode] = useState<'camera' | 'upload'>('upload');
  const [mediaDataUri, setMediaDataUri] = useState<string | null>(null);
  const [isLiveCaptured, setIsLiveCaptured] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingPolicy, setCheckingPolicy] = useState(false);

  // Refs for lifecycle stability & abort control
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wasOpenRef = useRef(false);
  const locationNameAutoFilledRef = useRef(true);
  const locationNameRef = useRef(locationName);
  locationNameRef.current = locationName;
  const suppressNextSearchEffectRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const reverseDebounceRef = useRef<number | null>(null);
  const onGuestPolicySyncedRef = useRef(onGuestPolicySynced);
  onGuestPolicySyncedRef.current = onGuestPolicySynced;

  const titleId = useId();
  const descId = useId();
  const catId = useId();
  const searchId = useId();
  const locId = useId();
  const latId = useId();
  const lngId = useId();

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const applyReverseResult = useCallback((res: ReverseGeocodeResponse) => {
    setResolvedDetails(res);
    const label = res.short_name?.trim();
    if (!label) return;
    if (!locationNameRef.current.trim() || locationNameAutoFilledRef.current) {
      setLocationName(label);
      locationNameAutoFilledRef.current = true;
      setReverseSuggestion(null);
    } else if (label.toLowerCase() !== locationNameRef.current.trim().toLowerCase()) {
      setReverseSuggestion(label);
    } else {
      setReverseSuggestion(null);
    }
  }, []);

  const triggerReverseGeocode = useCallback(
    (targetLat: number, targetLng: number) => {
      reverseAbortRef.current?.abort();
      const controller = new AbortController();
      reverseAbortRef.current = controller;
      setReversingPlace(true);

      apiClient
        .geocodeReverse(targetLat, targetLng, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          applyReverseResult(res);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        })
        .finally(() => {
          if (reverseAbortRef.current === controller) {
            setReversingPlace(false);
          }
        });
    },
    [applyReverseResult],
  );

  const detectGpsInModal = useCallback(
    (opts?: { quietOnError?: boolean }) => {
      if (!navigator.geolocation) {
        if (!opts?.quietOnError) {
          pushToast({ tone: 'error', title: 'Geolocation is unsupported in this browser' });
        }
        return;
      }
      setDetectingGps(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: UserCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          const coarse = coords.accuracy !== undefined && coords.accuracy > 500;
          setDetectingGps(false);
          onGpsDetected(coords);
          setLat(coords.lat.toFixed(6));
          setLng(coords.lng.toFixed(6));
          setLocationSource('gps');
          setGpsAccuracy(coords.accuracy ?? null);
          setShowSuggestions(false);
          setPickerViewTarget({
            lat: coords.lat,
            lng: coords.lng,
            zoom: coarse ? 13 : 16,
            nonce: Date.now(),
          });
          triggerReverseGeocode(coords.lat, coords.lng);
          if (!opts?.quietOnError) {
            pushToast({
              tone: coarse ? 'warning' : 'success',
              title: coarse
                ? `Approximate GPS detected (${formatAccuracyMeters(coords.accuracy!)})`
                : 'Live GPS location locked',
              description: coarse
                ? 'Desktop Wi-Fi/IP location may be broad — drag the pin or search exact street.'
                : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
            });
          }
        },
        (err) => {
          setDetectingGps(false);
          if (!opts?.quietOnError) {
            pushToast({
              tone: 'warning',
              title: 'Could not read device GPS',
              description: `${err.message}. Search an address or click the map instead.`,
            });
          }
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
      );
    },
    [onGpsDetected, pushToast, triggerReverseGeocode],
  );

  // Initialize pin position ONLY when `open` transitions from false -> true
  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        stopCamera();
        searchAbortRef.current?.abort();
        reverseAbortRef.current?.abort();
        if (reverseDebounceRef.current !== null) {
          window.clearTimeout(reverseDebounceRef.current);
          reverseDebounceRef.current = null;
        }
      }
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    locationNameAutoFilledRef.current = !locationNameRef.current.trim();
    setReverseSuggestion(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError(null);

    if (initialPin) {
      setLat(initialPin.lat.toFixed(6));
      setLng(initialPin.lng.toFixed(6));
      setLocationSource('map');
      setGpsAccuracy(null);
      setPickerViewTarget({
        lat: initialPin.lat,
        lng: initialPin.lng,
        zoom: 16,
        nonce: Date.now(),
      });
      if (initialAddressDetails) {
        applyReverseResult(initialAddressDetails);
      } else {
        triggerReverseGeocode(initialPin.lat, initialPin.lng);
      }
    } else if (userCoords) {
      const coarse = userCoords.accuracy !== undefined && userCoords.accuracy > 500;
      setLat(userCoords.lat.toFixed(6));
      setLng(userCoords.lng.toFixed(6));
      setLocationSource('gps');
      setGpsAccuracy(userCoords.accuracy ?? null);
      setPickerViewTarget({
        lat: userCoords.lat,
        lng: userCoords.lng,
        zoom: coarse ? 13 : 16,
        nonce: Date.now(),
      });
      if (liveLocationDetails) {
        applyReverseResult(liveLocationDetails);
      } else {
        triggerReverseGeocode(userCoords.lat, userCoords.lng);
      }
    } else {
      setLat(defaultLat.toFixed(6));
      setLng(defaultLng.toFixed(6));
      setLocationSource('default');
      setGpsAccuracy(null);
      setResolvedDetails(null);
      setPickerViewTarget({
        lat: defaultLat,
        lng: defaultLng,
        zoom: 7,
        nonce: Date.now(),
      });
      // Automatically fetch live device GPS when opening without prior coordinates
      detectGpsInModal({ quietOnError: true });
    }
  }, [
    open,
    initialPin,
    initialAddressDetails,
    userCoords,
    liveLocationDetails,
    defaultLat,
    defaultLng,
    stopCamera,
    applyReverseResult,
    triggerReverseGeocode,
    detectGpsInModal,
  ]);

  // Refresh guest upload policy separately without resetting coordinates
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCheckingPolicy(true);
    apiClient
      .fetchGuestUploadPolicy(session)
      .then((allowed) => {
        if (active) onGuestPolicySyncedRef.current(allowed);
      })
      .catch(() => {
        // Offline or unreachable — keep composer open for offline queue capture
      })
      .finally(() => {
        if (active) setCheckingPolicy(false);
      });
    return () => {
      active = false;
    };
  }, [open, session?.token, session?.role]);

  useEffect(() => stopCamera, [stopCamera]);

  const runPlaceSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearchError(null);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchingPlaces(true);
    setSearchError(null);

    try {
      const results = await apiClient.geocodeSearch(trimmed, 5, controller.signal);
      if (controller.signal.aborted) return;
      setSuggestions(results);
      setShowSuggestions(true);
      if (results.length === 0) {
        setSearchError('No matching places found — try adding street, town, or district.');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof ApiError ? err.message : 'Place search unavailable';
      setSuggestions([]);
      setShowSuggestions(true);
      setSearchError(msg);
    } finally {
      if (searchAbortRef.current === controller) {
        setSearchingPlaces(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (suppressNextSearchEffectRef.current) {
      suppressNextSearchEffectRef.current = false;
      return;
    }
    const trimmed = placeQuery.trim();
    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      setSuggestions([]);
      setShowSuggestions(false);
      setSearchError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void runPlaceSearch(trimmed);
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, placeQuery, runPlaceSearch]);

  function applyPlaceSuggestion(item: GeocodeSuggestion) {
    suppressNextSearchEffectRef.current = true;
    setPlaceQuery(item.short_name);
    setLat(item.lat.toFixed(6));
    setLng(item.lng.toFixed(6));
    setLocationName(item.short_name);
    locationNameAutoFilledRef.current = true;
    setLocationSource('search');
    setGpsAccuracy(null);
    setReverseSuggestion(null);
    setResolvedDetails({
      display_name: item.display_name,
      short_name: item.short_name,
      lat: item.lat,
      lng: item.lng,
      category: item.category,
      place_type: item.place_type,
      address: item.address,
    });
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError(null);
    setPickerViewTarget({
      lat: item.lat,
      lng: item.lng,
      zoom: 15,
      nonce: Date.now(),
    });
  }

  function handleMapPick(pickedLat: number, pickedLng: number) {
    setLat(pickedLat.toFixed(6));
    setLng(pickedLng.toFixed(6));
    setLocationSource('map');
    setShowSuggestions(false);

    if (reverseDebounceRef.current !== null) {
      window.clearTimeout(reverseDebounceRef.current);
    }
    reverseDebounceRef.current = window.setTimeout(() => {
      triggerReverseGeocode(pickedLat, pickedLng);
    }, 250);
  }

  async function handleLocateByLocationName() {
    const query = locationName.trim();
    if (query.length < 2 || locatingName) {
      pushToast({ tone: 'info', title: 'Enter at least 2 characters in Location Name first' });
      return;
    }
    setLocatingName(true);
    try {
      const results = await apiClient.geocodeSearch(query, 5);
      if (results.length === 0) {
        pushToast({
          tone: 'warning',
          title: `No coordinates found for "${query}"`,
          description: 'Try searching a nearby town or click the map directly.',
        });
        return;
      }
      const best = results[0];
      setLat(best.lat.toFixed(6));
      setLng(best.lng.toFixed(6));
      setLocationSource('search');
      setGpsAccuracy(null);
      setResolvedDetails({
        display_name: best.display_name,
        short_name: best.short_name,
        lat: best.lat,
        lng: best.lng,
        category: best.category,
        place_type: best.place_type,
        address: best.address,
      });
      setPickerViewTarget({ lat: best.lat, lng: best.lng, zoom: 15, nonce: Date.now() });

      if (results.length > 1) {
        suppressNextSearchEffectRef.current = true;
        setPlaceQuery(query);
        setSuggestions(results);
        setShowSuggestions(true);
        setSearchError(null);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }

      pushToast({
        tone: 'success',
        title: `Pinned near ${best.short_name}`,
        description:
          results.length > 1
            ? 'Multiple matches found — choose another from the list or drag pin to refine.'
            : `${best.lat.toFixed(5)}, ${best.lng.toFixed(5)}`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Place lookup failed',
        description: err instanceof ApiError ? err.message : 'Unable to geocode location name',
      });
    } finally {
      setLocatingName(false);
    }
  }

  function handleCoordinateEdit(nextLatStr: string, nextLngStr: string) {
    setLat(nextLatStr);
    setLng(nextLngStr);
    const nLat = Number(nextLatStr);
    const nLng = Number(nextLngStr);
    if (
      nextLatStr.trim() !== '' &&
      nextLngStr.trim() !== '' &&
      Number.isFinite(nLat) &&
      Number.isFinite(nLng) &&
      nLat >= -90 &&
      nLat <= 90 &&
      nLng >= -180 &&
      nLng <= 180
    ) {
      setLocationSource('manual');
      setGpsAccuracy(null);
      setPickerViewTarget({ lat: nLat, lng: nLng, nonce: Date.now() });
    }
  }

  async function startCamera() {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera API is unavailable in this browser.');
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      window.requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      setCameraError(`Unable to open camera: ${msg}`);
    }
  }

  function captureLiveFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const maxW = 960;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.7);
    setMediaDataUri(jpegDataUrl);
    setIsLiveCaptured(true);
    stopCamera();
    pushToast({
      tone: 'success',
      title: 'Live camera frame captured',
      description: 'Tagged as LIVE REC for rapid Gemini Vision verification.',
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressFileToJpegDataUrl(file, 960, 0.7);
      setMediaDataUri(compressed);
      setIsLiveCaptured(false);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Invalid image file',
        description: err instanceof Error ? err.message : 'Could not process image',
      });
    }
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setLocationName('');
    locationNameAutoFilledRef.current = true;
    setPlaceQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError(null);
    setReverseSuggestion(null);
    setResolvedDetails(null);
    setGpsAccuracy(null);
    setMediaDataUri(null);
    setIsLiveCaptured(false);
    stopCamera();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      pushToast({ tone: 'error', title: 'Invalid latitude (-90 to 90)' });
      return;
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      pushToast({ tone: 'error', title: 'Invalid longitude (-180 to 180)' });
      return;
    }

    const payload: CreatePostRequest = {
      user_lat: userCoords?.lat,
      user_lng: userCoords?.lng,
      lat: parsedLat,
      lng: parsedLng,
      title: title.trim(),
      description: description.trim(),
      category,
      location_name: locationName.trim(),
      media_base64: mediaDataUri ?? undefined,
      is_live_captured: isLiveCaptured,
    };

    if (!navigator.onLine) {
      const nextQueue = enqueueOfflineReport(payload);
      onQueueUpdated(nextQueue.length);
      pushToast({
        tone: 'warning',
        title: 'Saved to Offline Queue',
        description: 'No internet detected. Report will auto-sync once connectivity returns.',
      });
      resetForm();
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiClient.createPost(payload, session?.token);
      onPostCreated(created);
      pushToast({
        tone: created.verification_status === 'Pending Admin Approval' ? 'info' : 'success',
        title:
          created.verification_status === 'Pending Admin Approval'
            ? 'Submitted to Admin Approval Queue'
            : 'Incident verified & published live',
        description: `AI Trust: ${created.ai_authenticity_score}% · ${created.verification_status}`,
      });
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isNetworkError) {
        const nextQueue = enqueueOfflineReport(payload);
        onQueueUpdated(nextQueue.length);
        pushToast({
          tone: 'warning',
          title: 'Backend unreachable — queued offline',
          description: 'Stored safely in localStorage and ready to sync automatically.',
        });
        resetForm();
        onClose();
      } else {
        const msg = err instanceof ApiError ? err.message : 'Failed to submit report';
        pushToast({ tone: 'error', title: 'Submission rejected', description: msg });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isGuestBlocked = !session && !allowGuestUploads;
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  const validPinLat = Number.isFinite(numericLat) && numericLat >= -90 && numericLat <= 90 ? numericLat : defaultLat;
  const validPinLng = Number.isFinite(numericLng) && numericLng >= -180 && numericLng <= 180 ? numericLng : defaultLng;
  const isCoarseGps = locationSource === 'gps' && gpsAccuracy !== null && gpsAccuracy > 500;

  const addressFields = resolvedDetails?.address
    ? [
        { label: 'Road / Place', value: resolvedDetails.address.road },
        { label: 'Area / Suburb', value: resolvedDetails.address.suburb },
        { label: 'City / Town', value: resolvedDetails.address.city },
        { label: 'District', value: resolvedDetails.address.district },
        { label: 'Province / State', value: resolvedDetails.address.state },
        { label: 'Postcode', value: resolvedDetails.address.postcode },
        { label: 'Country', value: resolvedDetails.address.country },
      ].filter((item): item is { label: string; value: string } => Boolean(item.value))
    : [];

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      maxWidthClass="w-[min(95vw,46rem)]"
      title="Report Live Incident or Trail Condition"
      subtitle="Protected by CivicPulse 4-Layer Zero-Fake Trust Engine (GPS + Gemini Vision + SHA-256)."
    >
      {checkingPolicy ? (
        <p className="mb-4 text-xs font-medium text-slate-500">Checking live upload policy...</p>
      ) : null}

      {isGuestBlocked ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <Lock className="mx-auto h-9 w-9 text-amber-600" aria-hidden="true" />
          <h3 className="mt-3 text-base font-bold text-slate-900">Sign In Required to Report</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Guest uploads are currently disabled by the system administrator. Sign in with a
            registered account to publish directly.
          </p>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAuth();
            }}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800"
          >
            Open Sign In / Register
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!session ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
              <div>
                <span className="font-bold">Guest Mode Active:</span> Your report will run through
                Gemini Vision forensics and enter the{' '}
                <span className="font-semibold">Admin Approval Queue</span> before appearing on the
                public feed.
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={titleId} className="mb-1 block text-xs font-bold text-slate-700">
                Incident Title
              </label>
              <input
                id={titleId}
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Landslide blocking main highway lane"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </div>

            <div>
              <label htmlFor={catId} className="mb-1 block text-xs font-bold text-slate-700">
                Category
              </label>
              <select
                id={catId}
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                <option value="Disaster">Disaster</option>
                <option value="Nature">Nature</option>
                <option value="Tourism">Tourism</option>
                <option value="Road">Road</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={descId} className="mb-1 block text-xs font-bold text-slate-700">
              Description (Sinhala, Tamil, or English — Gemini auto-translates)
            </label>
            <textarea
              id={descId}
              required
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe ground conditions, visibility, water depth, or hazards..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          {/* Exact Location & Interactive Map Pin Picker */}
          <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5">
            <legend className="px-1.5 text-xs font-bold text-slate-800">
              Incident Location &amp; Exact Map Pin
            </legend>

            {/* Place Search + In-Modal GPS */}
            <div className="relative">
              <label htmlFor={searchId} className="mb-1 block text-[11px] font-bold text-slate-600">
                Search street, neighborhood, town, or landmark
              </label>
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id={searchId}
                    type="search"
                    enterKeyHint="search"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        void runPlaceSearch(placeQuery);
                      }
                    }}
                    placeholder="Search street, town, or landmark..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-xs text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  {searchingPlaces ? (
                    <Loader2
                      className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-sky-600"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void runPlaceSearch(placeQuery)}
                  disabled={searchingPlaces || placeQuery.trim().length < 2}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Find</span>
                </button>

                <button
                  type="button"
                  onClick={() => detectGpsInModal()}
                  disabled={detectingGps}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 transition hover:bg-sky-100 disabled:opacity-60"
                >
                  {detectingGps ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" aria-hidden="true" />
                  ) : (
                    <Crosshair className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                  )}
                  <span>{detectingGps ? 'Locating...' : 'Use Live GPS'}</span>
                </button>
              </div>

              {showSuggestions && (suggestions.length > 0 || searchError) ? (
                <div className="absolute left-0 right-0 z-[500] mt-1.5 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-elevated">
                  {suggestions.length > 0 ? (
                    <ul role="listbox" aria-label="Matching locations" className="space-y-0.5">
                      {suggestions.map((item, idx) => (
                        <li key={`${item.lat}-${item.lng}-${idx}`}>
                          <button
                            type="button"
                            onClick={() => applyPlaceSuggestion(item)}
                            className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-sky-50"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-900">
                                {item.short_name}
                              </p>
                              <p className="truncate text-[11px] text-slate-500">
                                {item.display_name}
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] font-semibold text-sky-700">
                              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                            </span>
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

            {/* Embedded Interactive Click / Drag Map */}
            {open ? (
              <LocationPickerMap
                lat={validPinLat}
                lng={validPinLng}
                viewTarget={pickerViewTarget}
                userCoords={userCoords}
                onPick={handleMapPick}
              />
            ) : null}

            {/* Structured Google-Maps-Style Address Breakdown */}
            {addressFields.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-slate-700">Detected Address Details</span>
                  {resolvedDetails?.place_type ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-600">
                      {resolvedDetails.place_type}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-3">
                  {addressFields.map((item) => (
                    <div key={item.label} className="min-w-0 rounded-lg bg-slate-50 px-2 py-1">
                      <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                        {item.label}
                      </span>
                      <span className="block truncate font-semibold text-slate-800">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Live Accuracy / Pin Status Banner */}
            <div role="status" aria-live="polite" className="space-y-1.5">
              {locationSource === 'default' ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <div>
                    <span className="font-bold">Waiting for exact location pin.</span> Search a place
                    above, click the map, or press <span className="font-semibold">Use Live GPS</span>.
                  </div>
                </div>
              ) : isCoarseGps && gpsAccuracy !== null ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <div>
                    <span className="font-bold">
                      Approximate GPS ({formatAccuracyMeters(gpsAccuracy)})
                    </span>{' '}
                    — drag the pin or search the exact place on the map. ·{' '}
                    <span className="font-mono">
                      {validPinLat.toFixed(5)}, {validPinLng.toFixed(5)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-[11px] text-emerald-900">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    Exact pin locked ({SOURCE_LABELS[locationSource]}
                    {locationSource === 'gps' && gpsAccuracy !== null
                      ? ` ${formatAccuracyMeters(gpsAccuracy)}`
                      : ''}
                    ) ·{' '}
                    <span className="font-mono">
                      {validPinLat.toFixed(5)}, {validPinLng.toFixed(5)}
                    </span>
                  </span>
                  {reversingPlace ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Reading address...
                    </span>
                  ) : null}
                </div>
              )}

              {reverseSuggestion ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-900">
                  <span className="truncate">
                    Map address detected: <span className="font-semibold">{reverseSuggestion}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocationName(reverseSuggestion);
                      locationNameAutoFilledRef.current = true;
                      setReverseSuggestion(null);
                    }}
                    className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 font-bold text-white transition hover:bg-sky-700"
                  >
                    Use map place
                  </button>
                </div>
              ) : null}
            </div>

            {/* Location Name + Fine-Tune Latitude/Longitude */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label htmlFor={locId} className="mb-1 block text-xs font-bold text-slate-700">
                  Location Name
                </label>
                <div className="flex gap-1.5">
                  <input
                    id={locId}
                    type="text"
                    required
                    maxLength={200}
                    value={locationName}
                    onChange={(e) => {
                      locationNameAutoFilledRef.current = false;
                      setLocationName(e.target.value);
                    }}
                    placeholder="Resolved place or street"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleLocateByLocationName()}
                    disabled={locatingName || locationName.trim().length < 2}
                    title="Move map pin to this Location Name"
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"
                  >
                    {locatingName ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                    )}
                    <span>Locate</span>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor={latId} className="mb-1 block text-xs font-bold text-slate-700">
                  Latitude
                </label>
                <input
                  id={latId}
                  type="number"
                  step="any"
                  required
                  min={-90}
                  max={90}
                  value={lat}
                  onChange={(e) => handleCoordinateEdit(e.target.value, lng)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor={lngId} className="mb-1 block text-xs font-bold text-slate-700">
                  Longitude
                </label>
                <input
                  id={lngId}
                  type="number"
                  step="any"
                  required
                  min={-180}
                  max={180}
                  value={lng}
                  onChange={(e) => handleCoordinateEdit(lat, e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>
          </fieldset>

          {/* Media Capture Section: Live Camera vs File Upload */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                Visual Evidence (Optional — boosts AI Trust Score)
              </span>
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setMediaMode('camera');
                    startCamera();
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    mediaMode === 'camera'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Live Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setMediaMode('upload');
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    mediaMode === 'upload'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>File Upload</span>
                </button>
              </div>
            </div>

            {mediaMode === 'camera' && !mediaDataUri ? (
              <div className="mt-3">
                {cameraError ? (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {cameraError}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="max-h-56 w-full object-cover"
                    />
                    <div className="flex items-center justify-between bg-slate-900/95 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-400">
                        <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                        {cameraActive ? 'LIVE REC READY' : 'Starting camera...'}
                      </span>
                      <button
                        type="button"
                        disabled={!cameraActive}
                        onClick={captureLiveFrame}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
                      >
                        Capture Live Frame
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {mediaMode === 'upload' && !mediaDataUri ? (
              <div className="mt-3">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 text-center transition hover:border-sky-400 hover:bg-sky-50/40">
                  <Upload className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  <span className="mt-1 text-xs font-semibold text-slate-700">
                    Choose an image file (auto-compressed JPEG)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                </label>
              </div>
            ) : null}

            {mediaDataUri ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <img
                  src={mediaDataUri}
                  alt="Captured evidence preview"
                  className="max-h-52 w-full object-cover"
                />
                <div className="flex items-center justify-between px-3 py-2 text-xs">
                  <span
                    className={`font-bold ${
                      isLiveCaptured ? 'text-rose-700' : 'text-slate-700'
                    }`}
                  >
                    {isLiveCaptured ? 'LIVE REC JPEG Ready' : 'Compressed JPEG Ready'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMediaDataUri(null);
                      setIsLiveCaptured(false);
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {!navigator.onLine ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                Offline: will queue locally
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Analyzed in real time by Rust + Gemini 2.5 Flash
              </span>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="ml-auto inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? 'Analyzing & Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
