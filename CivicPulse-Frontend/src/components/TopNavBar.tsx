import {
  CloudOff,
  Compass,
  Crosshair,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { QUICK_JUMP_LOCATIONS } from '../lib/geo';
import type {
  AuthSession,
  Category,
  LayoutMode,
  QuickLocation,
  SortMode,
} from '../types/civicpulse';

const CATEGORIES: Array<'All' | Category> = ['All', 'Disaster', 'Nature', 'Tourism', 'Road'];

const CATEGORY_ACTIVE_STYLES: Record<'All' | Category, string> = {
  All: 'bg-slate-900 text-white border-slate-900 shadow-sm',
  Disaster: 'bg-rose-600 text-white border-rose-600 shadow-sm',
  Nature: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
  Tourism: 'bg-sky-600 text-white border-sky-600 shadow-sm',
  Road: 'bg-amber-500 text-white border-amber-500 shadow-sm',
};

interface TopNavBarProps {
  search: string;
  onSearchChange: (val: string) => void;
  category: 'All' | Category;
  onCategoryChange: (cat: 'All' | Category) => void;
  verifiedOnly: boolean;
  onVerifiedOnlyChange: (val: boolean) => void;
  sortMode: SortMode;
  onSortModeChange: (sort: SortMode) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  userCoords: { lat: number; lng: number } | null;
  gpsLoading: boolean;
  onRequestGps: () => void;
  onClearGps: () => void;
  selectedQuickJumpId: string;
  onQuickJump: (loc: QuickLocation) => void;
  offlineQueueCount: number;
  isSyncingOffline: boolean;
  onSyncOffline: () => void;
  backendOnline: boolean;
  sseConnected: boolean;
  session: AuthSession | null;
  adminViewActive: boolean;
  onToggleAdminView: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenReport: () => void;
}

export function TopNavBar({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  verifiedOnly,
  onVerifiedOnlyChange,
  sortMode,
  onSortModeChange,
  layoutMode,
  onLayoutModeChange,
  userCoords,
  gpsLoading,
  onRequestGps,
  onClearGps,
  selectedQuickJumpId,
  onQuickJump,
  offlineQueueCount,
  isSyncingOffline,
  onSyncOffline,
  backendOnline,
  sseConnected,
  session,
  adminViewActive,
  onToggleAdminView,
  onOpenAuth,
  onLogout,
  onOpenReport,
}: TopNavBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto max-w-[1600px] px-3 py-2.5 sm:px-5">
        {/* Primary Row: Branding, Search, GPS, Auth & Report CTA */}
        <div className="flex flex-wrap items-center gap-2.5 lg:gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 pr-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 via-sky-500 to-indigo-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-slate-900">
                  CivicPulse
                </span>
                <span
                  title={
                    backendOnline
                      ? sseConnected
                        ? 'Live SSE Connected'
                        : 'Backend Online'
                      : 'Backend Unreachable'
                  }
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    backendOnline
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {backendOnline ? (sseConnected ? 'Live' : 'Online') : 'Offline'}
                </span>
              </div>
              <p className="hidden text-[11px] font-medium text-slate-500 sm:block">
                Zero-Fake Safety &amp; Eco-Tourism Console
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[200px] flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              enterKeyHint="search"
              placeholder="Search Ella, landslide, flood, Sinhala or English..."
              aria-label="Search incident location or keywords"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {/* Use My Location + Quick Jump */}
          <div className="flex items-center gap-1.5">
            {userCoords ? (
              <div className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 text-xs font-semibold text-sky-800">
                <button
                  type="button"
                  onClick={onRequestGps}
                  disabled={gpsLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 transition hover:bg-sky-100/70 rounded-l-xl"
                  title={`GPS Active: ${userCoords.lat.toFixed(4)}, ${userCoords.lng.toFixed(4)}`}
                >
                  <Crosshair className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                  <span className="hidden sm:inline">GPS Locked</span>
                </button>
                <button
                  type="button"
                  onClick={onClearGps}
                  aria-label="Clear GPS location"
                  className="border-l border-sky-200 px-2 py-2 text-sky-600 hover:bg-sky-100/70 rounded-r-xl"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onRequestGps}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-50/60 hover:text-sky-700 disabled:opacity-60"
              >
                <Crosshair
                  className={`h-3.5 w-3.5 ${gpsLoading ? 'animate-spin text-sky-600' : 'text-slate-500'}`}
                  aria-hidden="true"
                />
                <span>{gpsLoading ? 'Locating...' : 'Use My Location'}</span>
              </button>
            )}

            <div className="relative flex items-center">
              <Compass
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <select
                aria-label="Quick Jump Location"
                value={selectedQuickJumpId}
                onChange={(e) => {
                  const found = QUICK_JUMP_LOCATIONS.find((l) => l.id === e.target.value);
                  if (found) onQuickJump(found);
                }}
                className="rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-7 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                {QUICK_JUMP_LOCATIONS.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right Controls: Offline Queue, Auth, Admin, Report CTA */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {offlineQueueCount > 0 ? (
              <button
                type="button"
                onClick={onSyncOffline}
                disabled={isSyncingOffline}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                title="Queued offline reports waiting to sync"
              >
                {isSyncingOffline ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Offline Queue ({offlineQueueCount})</span>
              </button>
            ) : null}

            {session ? (
              <div className="flex items-center gap-1.5">
                {session.role === 'admin' ? (
                  <button
                    type="button"
                    onClick={onToggleAdminView}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      adminViewActive
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{adminViewActive ? 'Exit Admin' : 'Admin Console'}</span>
                  </button>
                ) : null}

                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                  <UserCheck
                    className={`h-3.5 w-3.5 ${
                      session.role === 'admin' ? 'text-indigo-600' : 'text-emerald-600'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="hidden leading-tight xl:block">
                    <div className="font-semibold text-slate-800">{session.name}</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      {session.role} · Rep {session.reputation_score}
                    </div>
                  </div>
                  <span className="font-semibold capitalize text-slate-700 xl:hidden">
                    {session.role}
                  </span>
                  <button
                    type="button"
                    onClick={onLogout}
                    aria-label="Sign out"
                    title="Sign out"
                    className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-rose-600"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-700"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Guest · Sign In</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenReport}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-900 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:from-slate-800 hover:to-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Report Incident</span>
            </button>
          </div>
        </div>

        {/* Secondary Row: Category Pills, Verified Only, Sort & Desktop Layout Toggle */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onCategoryChange(cat)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? CATEGORY_ACTIVE_STYLES[cat]
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {cat}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => onVerifiedOnlyChange(!verifiedOnly)}
              aria-pressed={verifiedOnly}
              className={`ml-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                verifiedOnly
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Verified Only</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="hidden sm:inline">Sort:</span>
              <select
                value={sortMode}
                onChange={(e) => onSortModeChange(e.target.value as SortMode)}
                aria-label="Sort reports"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 focus:border-sky-500 focus:outline-none"
              >
                <option value="newest">Newest</option>
                <option value="priority">Priority Risk</option>
                <option value="severity">Highest Severity</option>
                {userCoords ? <option value="nearest">Nearest GPS</option> : null}
              </select>
            </label>

            {/* Desktop Split / Map / Feed Toggle */}
            <div
              role="group"
              aria-label="Workspace layout"
              className="hidden items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 lg:inline-flex"
            >
              {(
                [
                  { id: 'split', label: 'Split', icon: LayoutGrid },
                  { id: 'map', label: 'Full Map', icon: MapIcon },
                  { id: 'feed', label: 'Feed Focus', icon: List },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = layoutMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onLayoutModeChange(id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
