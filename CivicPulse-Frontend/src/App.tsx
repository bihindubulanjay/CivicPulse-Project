import { useCallback, useEffect, useRef, useState } from 'react';
import { List, Map as MapIcon } from 'lucide-react';
import { AccountModal } from './components/AccountModal';
import { AdminConsole } from './components/AdminConsole';
import { AiAdvisorDrawer } from './components/AiAdvisorDrawer';
import { AuthModal } from './components/AuthModal';
import { LiveFeed } from './components/LiveFeed';
import { LiveMap, type MapFlyTarget } from './components/LiveMap';
import { ReportIncidentModal } from './components/ReportIncidentModal';
import { ToastProvider, useToast } from './components/ToastProvider';
import { TopNavBar } from './components/TopNavBar';
import {
  API_BASE_URL,
  apiClient,
  ApiError,
  loadStoredSession,
  saveStoredSession,
} from './lib/api';
import { formatAccuracyMeters, haversineKm } from './lib/geo';
import { loadOfflineQueue, syncOfflineQueue } from './lib/offlineQueue';
import type {
  AuthSession,
  Category,
  CurrentUser,
  GpsStatus,
  LayoutMode,
  MobileTab,
  Post,
  ReverseGeocodeResponse,
  SortMode,
  UserCoords,
} from './types/civicpulse';

function CivicPulseWorkspace() {
  const { pushToast } = useToast();

  // Auth & Policy State
  const [session, setSession] = useState<AuthSession | null>(() => loadStoredSession());
  const [allowGuestUploads, setAllowGuestUploads] = useState<boolean>(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // Feed, Filters & Map State
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<'All' | Category>('All');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split');
  const [mobileTab, setMobileTab] = useState<MobileTab>('feed');
  const [adminViewActive, setAdminViewActive] = useState(false);
  const [adminRefreshNonce, setAdminRefreshNonce] = useState(0);

  // Live GPS & Google-Maps-Style Address State
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [gpsTracking, setGpsTracking] = useState(false);
  const [liveLocationDetails, setLiveLocationDetails] = useState<ReverseGeocodeResponse | null>(
    null,
  );
  const [flyTarget, setFlyTarget] = useState<MapFlyTarget | null>(null);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [reportInitialPin, setReportInitialPin] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [reportInitialAddress, setReportInitialAddress] =
    useState<ReverseGeocodeResponse | null>(null);

  // Connectivity & Offline Queue
  const [backendOnline, setBackendOnline] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [geminiModel, setGeminiModel] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(() => loadOfflineQueue().length);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);

  const postRefs = useRef<Map<string, HTMLElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);
  const fetchSeqRef = useRef(0);
  const isSyncingOfflineRef = useRef(false);
  const lastGeocodedGpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveReverseAbortRef = useRef<AbortController | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const registerPostRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) {
      postRefs.current.set(id, node);
    } else {
      postRefs.current.delete(id);
    }
  }, []);

  // Debounce search input cleanly
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Reverse-geocode live GPS coords only when moving > 50m (avoids redundant requests)
  const resolveLiveLocationDetails = useCallback((coords: UserCoords) => {
    const prev = lastGeocodedGpsRef.current;
    if (prev && haversineKm(prev.lat, prev.lng, coords.lat, coords.lng) < 0.05) {
      return;
    }
    lastGeocodedGpsRef.current = { lat: coords.lat, lng: coords.lng };
    liveReverseAbortRef.current?.abort();
    const controller = new AbortController();
    liveReverseAbortRef.current = controller;

    apiClient
      .geocodeReverse(coords.lat, coords.lng, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setLiveLocationDetails(res);
        }
      })
      .catch(() => {
        // Non-fatal if Nominatim or backend is unreachable
      });
  }, []);

  // Apply fresh GPS coordinates consistently across map & address state
  const applyLiveCoords = useCallback(
    (coords: UserCoords, opts?: { centerMap?: boolean; sortNearest?: boolean }) => {
      setUserCoords(coords);
      setGpsStatus('live');
      resolveLiveLocationDetails(coords);

      if (opts?.sortNearest) {
        setSortMode('nearest');
      }
      if (opts?.centerMap) {
        const coarse = coords.accuracy !== undefined && coords.accuracy > 500;
        setFlyTarget({
          lat: coords.lat,
          lng: coords.lng,
          zoom: coarse ? 13 : 15,
          nonce: Date.now(),
        });
      }
    },
    [resolveLiveLocationDetails],
  );

  // Sync restored auth session against live SQLite session/user row
  const handleProfileSynced = useCallback((user: CurrentUser) => {
    setSession((prev) => {
      if (!prev) return null;
      const next: AuthSession = {
        ...prev,
        user_id: user.user_id,
        role: user.role,
        name: user.name,
        email: user.email,
        reputation_score: user.reputation_score,
        expires_at: user.expires_at,
      };
      saveStoredSession(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!session?.token) return;
    apiClient
      .me(session.token)
      .then(handleProfileSynced)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          saveStoredSession(null);
          setSession(null);
        }
      });
  }, [session?.token, handleProfileSynced]);

  // Load posts from live backend
  const fetchPosts = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoadingPosts(true);
    setPostsError(null);
    try {
      const res = await apiClient.listPosts(
        {
          category,
          verified_only: verifiedOnly,
          search: debouncedSearch,
          sort: sortMode,
          lat: sortMode === 'nearest' && userCoords ? userCoords.lat : undefined,
          lng: sortMode === 'nearest' && userCoords ? userCoords.lng : undefined,
          limit: 100,
        },
        session?.token,
      );
      if (seq !== fetchSeqRef.current) return;
      setPosts(res.posts);
      setTotalCount(res.totalCount);
      setBackendOnline(true);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      if (err instanceof ApiError && err.status === 401 && session?.token) {
        saveStoredSession(null);
        setSession(null);
        return;
      }
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch reports';
      setPostsError(msg);
      if (err instanceof ApiError && err.isNetworkError) {
        setBackendOnline(false);
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoadingPosts(false);
      }
    }
  }, [category, verifiedOnly, debouncedSearch, sortMode, userCoords, session?.token]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Auto-fetch initial live GPS once on startup
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('unavailable');
      return;
    }
    setGpsStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined;
        applyLiveCoords(
          { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy },
          { centerMap: true },
        );
      },
      (err) => {
        setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
    return () => {
      liveReverseAbortRef.current?.abort();
    };
  }, [applyLiveCoords]);

  // Continuous live GPS watch when toggled ON
  useEffect(() => {
    if (!gpsTracking) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setGpsTracking(false);
      setGpsStatus('unavailable');
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined;
        applyLiveCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy });
      },
      (err) => {
        setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setGpsTracking(false);
        pushToast({
          tone: 'warning',
          title: 'Live GPS tracking paused',
          description: err.message,
        });
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [gpsTracking, applyLiveCoords, pushToast]);

  // Sync live guest upload policy & AI health status on mount & role changes
  useEffect(() => {
    apiClient
      .getHealth()
      .then((health) => {
        setGeminiConfigured(Boolean(health.gemini_configured));
        setGeminiModel(health.gemini_model ?? null);
        if (session?.role !== 'admin') {
          setAllowGuestUploads(health.allow_guest_uploads);
        }
        setBackendOnline(true);
      })
      .catch(() => {
        // Keep optimistic current value when offline
      });

    if (session?.role === 'admin') {
      apiClient
        .getAdminSettings(session.token)
        .then((settings) => {
          setAllowGuestUploads(settings.allow_guest_uploads);
          setBackendOnline(true);
        })
        .catch(() => {
          // Keep optimistic current value when offline
        });
    }
  }, [session]);

  // Offline Queue Sync Handler
  const handleSyncOfflineQueue = useCallback(async () => {
    if (isSyncingOfflineRef.current || loadOfflineQueue().length === 0) return;
    isSyncingOfflineRef.current = true;
    setIsSyncingOffline(true);
    try {
      const result = await syncOfflineQueue(session?.token);
      setOfflineQueueCount(result.remaining.length);

      if (result.syncedCount > 0) {
        setBackendOnline(true);
        await fetchPosts();
        pushToast({
          tone: 'success',
          title: `Synced ${result.syncedCount} offline ${
            result.syncedCount === 1 ? 'report' : 'reports'
          }`,
        });
      }

      if (result.blockedByAuth) {
        pushToast({
          tone: 'warning',
          title: 'Sign in needed to sync queued report',
          description: result.lastError ?? 'Guest uploads are disabled by admin.',
          action: { label: 'Sign In', onClick: () => setAuthModalOpen(true) },
        });
      } else if (result.remaining.length > 0 && result.lastError) {
        pushToast({
          tone: 'warning',
          title: 'Offline queue waiting for connection',
          description: result.lastError,
        });
      }
    } finally {
      isSyncingOfflineRef.current = false;
      setIsSyncingOffline(false);
    }
  }, [fetchPosts, pushToast, session?.token]);

  // Auto-sync offline queue when connectivity returns
  useEffect(() => {
    const onOnline = () => {
      setBackendOnline(true);
      handleSyncOfflineQueue();
    };
    const onOffline = () => {
      setBackendOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (navigator.onLine && loadOfflineQueue().length > 0) {
      handleSyncOfflineQueue();
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [handleSyncOfflineQueue]);

  // Real-time Server-Sent Events subscription (`GET /api/events`) with debounce
  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/api/events`);
    let refreshTimer: number | null = null;

    const scheduleRefresh = () => {
      setBackendOnline(true);
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        fetchPosts();
        if (session?.role === 'admin') {
          setAdminRefreshNonce((n) => n + 1);
        }
      }, 250);
    };

    es.onopen = () => {
      setSseConnected(true);
      setBackendOnline(true);
    };
    es.onerror = () => {
      setSseConnected(false);
    };

    const eventNames = [
      'post_created',
      'post_verified',
      'post_flagged',
      'post_resolved',
      'comment_added',
      'post_approved',
      'post_rejected',
      'post_deleted',
      'post_ai_updated',
      'admin_queue_updated',
    ];
    for (const name of eventNames) {
      es.addEventListener(name, scheduleRefresh);
    }

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      es.close();
    };
  }, [fetchPosts, session?.role]);

  // Explicit Live GPS Request (button / map FAB)
  function handleRequestGps() {
    if (!navigator.geolocation) {
      setGpsStatus('unavailable');
      pushToast({ tone: 'error', title: 'Geolocation is unsupported in this browser' });
      return;
    }
    setGpsStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined;
        const coords: UserCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy,
        };
        const coarse = accuracy !== undefined && accuracy > 500;
        const accLabel = accuracy !== undefined ? formatAccuracyMeters(accuracy) : null;
        applyLiveCoords(coords, { centerMap: true, sortNearest: true });
        pushToast({
          tone: coarse ? 'warning' : 'success',
          title: coarse
            ? `Approximate live location detected (${accLabel})`
            : 'Live GPS locked & sorting nearest alerts',
          description: coarse
            ? 'Desktop Wi-Fi/IP location may be broad — pin exact spots on the map when reporting.'
            : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}${accLabel ? ` (${accLabel})` : ''}`,
        });
      },
      (err) => {
        setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        pushToast({
          tone: 'warning',
          title: 'Live location unavailable',
          description: `${err.message}. Search an address on the map instead.`,
        });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  function handleClearGps() {
    setGpsTracking(false);
    setUserCoords(null);
    setLiveLocationDetails(null);
    lastGeocodedGpsRef.current = null;
    setGpsStatus('idle');
    if (sortMode === 'nearest') {
      setSortMode('newest');
    }
  }

  const jumpToPost = useCallback((postId: string) => {
    setAdminViewActive(false);
    setMobileTab('feed');
    setLayoutMode((prev) => (prev === 'map' ? 'split' : prev));
    setHighlightedPostId(postId);

    window.setTimeout(() => {
      const node = postRefs.current.get(postId);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 90);

    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedPostId(null);
    }, 3200);
  }, []);

  function focusPostOnMap(post: Post) {
    setHighlightedPostId(post.id);
    setFlyTarget({ lat: post.lat, lng: post.lng, zoom: 14, nonce: Date.now() });
    setMobileTab('map');
    if (layoutMode === 'feed') {
      setLayoutMode('split');
    }
  }

  function handlePostUpdated(updated: Post) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handlePostCreated(created: Post) {
    if (created.verification_status !== 'Pending Admin Approval') {
      setPosts((prev) => [created, ...prev]);
      setTotalCount((c) => c + 1);
      setHighlightedPostId(created.id);
      setFlyTarget({ lat: created.lat, lng: created.lng, zoom: 15, nonce: Date.now() });
    } else if (session?.role === 'admin') {
      setAdminRefreshNonce((n) => n + 1);
    }
  }

  function handleAuthSuccess(newSession: AuthSession) {
    saveStoredSession(newSession);
    setSession(newSession);
    if (newSession.role !== 'admin') {
      setAdminViewActive(false);
    }
  }

  async function handleLogout() {
    if (session?.token) {
      await apiClient.logout(session.token).catch(() => undefined);
    }
    saveStoredSession(null);
    setSession(null);
    setAccountModalOpen(false);
    setAdminViewActive(false);
    setMobileTab('feed');
    pushToast({ tone: 'info', title: 'Signed out cleanly' });
  }

  const liveLocationLabel =
    liveLocationDetails?.address?.city ??
    liveLocationDetails?.address?.suburb ??
    liveLocationDetails?.short_name ??
    null;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-slate-50 to-emerald-50/40">
      <TopNavBar
        search={search}
        onSearchChange={setSearch}
        category={category}
        onCategoryChange={setCategory}
        verifiedOnly={verifiedOnly}
        onVerifiedOnlyChange={setVerifiedOnly}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        layoutMode={layoutMode}
        onLayoutModeChange={(m) => {
          setAdminViewActive(false);
          setLayoutMode(m);
        }}
        userCoords={userCoords}
        gpsStatus={gpsStatus}
        gpsTracking={gpsTracking}
        liveLocationLabel={liveLocationLabel}
        onRequestGps={handleRequestGps}
        onToggleGpsTracking={() => setGpsTracking((prev) => !prev)}
        onClearGps={handleClearGps}
        offlineQueueCount={offlineQueueCount}
        isSyncingOffline={isSyncingOffline}
        onSyncOffline={handleSyncOfflineQueue}
        backendOnline={backendOnline}
        sseConnected={sseConnected}
        session={session}
        adminViewActive={adminViewActive}
        onToggleAdminView={() => setAdminViewActive((prev) => !prev)}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenAccount={() => setAccountModalOpen(true)}
        onLogout={handleLogout}
        onOpenReport={() => {
          setReportInitialPin(null);
          setReportInitialAddress(null);
          setReportModalOpen(true);
        }}
      />

      {/* Mobile Tab Switcher */}
      {!adminViewActive ? (
        <div className="mx-auto max-w-[1600px] px-3 pt-3 lg:hidden">
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setMobileTab('feed')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                mobileTab === 'feed' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              <List className="h-4 w-4" aria-hidden="true" />
              <span>Live Feed ({posts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('map')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                mobileTab === 'map' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              <MapIcon className="h-4 w-4" aria-hidden="true" />
              <span>Live Map</span>
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5 sm:py-5">
        {adminViewActive && session?.role === 'admin' ? (
          <AdminConsole
            session={session}
            allowGuestUploads={allowGuestUploads}
            onGuestPolicyUpdated={setAllowGuestUploads}
            onPostModerated={fetchPosts}
            refreshTrigger={adminRefreshNonce}
          />
        ) : (
          <div
            className={`grid gap-5 ${
              layoutMode === 'split' ? 'lg:grid-cols-12' : 'lg:grid-cols-1'
            }`}
          >
            {/* Interactive Leaflet Map Pane */}
            <div
              className={`${
                layoutMode === 'feed'
                  ? 'hidden'
                  : layoutMode === 'map'
                    ? 'lg:col-span-12 lg:h-[calc(100dvh-10.5rem)]'
                    : 'lg:sticky lg:top-[8.25rem] lg:col-span-6 lg:h-[calc(100dvh-9.75rem)]'
              } ${mobileTab === 'map' ? 'block h-[72dvh]' : 'hidden lg:block'}`}
            >
              <LiveMap
                posts={posts}
                userCoords={userCoords}
                gpsStatus={gpsStatus}
                gpsTracking={gpsTracking}
                liveLocationDetails={liveLocationDetails}
                selectedPostId={highlightedPostId}
                flyTarget={flyTarget}
                layoutTrigger={`${layoutMode}-${mobileTab}`}
                onRequestGps={handleRequestGps}
                onToggleGpsTracking={() => setGpsTracking((prev) => !prev)}
                onJumpToPost={jumpToPost}
                onPickLocationToReport={(lat, lng, details) => {
                  setReportInitialPin({ lat, lng });
                  setReportInitialAddress(details ?? null);
                  setReportModalOpen(true);
                }}
              />
            </div>

            {/* Live Social Feed Pane */}
            <div
              className={`${
                layoutMode === 'map'
                  ? 'hidden'
                  : layoutMode === 'feed'
                    ? 'mx-auto w-full max-w-3xl'
                    : 'lg:col-span-6'
              } ${mobileTab === 'feed' ? 'block' : 'hidden lg:block'}`}
            >
              <LiveFeed
                posts={posts}
                totalCount={totalCount}
                loading={loadingPosts}
                error={postsError}
                highlightedPostId={highlightedPostId}
                userCoords={userCoords}
                session={session}
                onRetry={fetchPosts}
                onResetFilters={() => {
                  setSearch('');
                  setDebouncedSearch('');
                  setCategory('All');
                  setVerifiedOnly(false);
                }}
                onPostUpdated={handlePostUpdated}
                onFocusOnMap={focusPostOnMap}
                registerPostRef={registerPostRef}
              />
            </div>
          </div>
        )}
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      <AccountModal
        open={accountModalOpen}
        session={session}
        onClose={() => setAccountModalOpen(false)}
        onProfileSynced={handleProfileSynced}
        onLogout={handleLogout}
      />

      <ReportIncidentModal
        open={reportModalOpen}
        session={session}
        allowGuestUploads={allowGuestUploads}
        userCoords={userCoords}
        liveLocationDetails={liveLocationDetails}
        defaultLat={userCoords?.lat ?? 7.8731}
        defaultLng={userCoords?.lng ?? 80.7718}
        initialPin={reportInitialPin}
        initialAddressDetails={reportInitialAddress}
        onGpsDetected={(coords) => applyLiveCoords(coords)}
        onClose={() => {
          setReportModalOpen(false);
          setReportInitialPin(null);
          setReportInitialAddress(null);
        }}
        onOpenAuth={() => setAuthModalOpen(true)}
        onPostCreated={handlePostCreated}
        onQueueUpdated={setOfflineQueueCount}
        onGuestPolicySynced={setAllowGuestUploads}
      />

      <AiAdvisorDrawer
        userCoords={userCoords}
        liveLocationDetails={liveLocationDetails}
        geminiConfigured={geminiConfigured}
        geminiModel={geminiModel}
        onJumpToPost={jumpToPost}
      />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <CivicPulseWorkspace />
    </ToastProvider>
  );
}

export default App;
