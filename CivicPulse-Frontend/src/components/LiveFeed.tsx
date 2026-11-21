import { AlertTriangle, Download, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../lib/api';
import type { AuthSession, Post } from '../types/civicpulse';
import { PostCard } from './PostCard';

interface LiveFeedProps {
  posts: Post[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  highlightedPostId: string | null;
  userCoords: { lat: number; lng: number } | null;
  session: AuthSession | null;
  onRetry: () => void;
  onResetFilters: () => void;
  onPostUpdated: (updated: Post) => void;
  onFocusOnMap: (post: Post) => void;
  registerPostRef: (id: string, node: HTMLElement | null) => void;
}

export function LiveFeed({
  posts,
  totalCount,
  loading,
  error,
  highlightedPostId,
  userCoords,
  session,
  onRetry,
  onResetFilters,
  onPostUpdated,
  onFocusOnMap,
  registerPostRef,
}: LiveFeedProps) {
  const verifiedCount = posts.filter(
    (p) =>
      p.verification_status === 'AI Verified' ||
      p.verification_status === 'Community Verified' ||
      p.verification_status === 'Admin Approved',
  ).length;
  const highSeverityActive = posts.filter((p) => !p.is_resolved && p.severity >= 7).length;

  return (
    <section aria-label="Live Safety Feed" className="flex flex-col gap-4">
      {/* Live Dynamic Stats Header */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-3xl px-4 py-3 shadow-glass">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="font-medium text-slate-500">Showing </span>
            <span className="font-extrabold text-slate-900">{posts.length}</span>
            <span className="text-slate-400"> / {totalCount}</span>
          </div>
          <div className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{verifiedCount} Verified</span>
          </div>
          <div className="inline-flex items-center gap-1 font-semibold text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{highSeverityActive} High-Risk Active</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`${API_BASE_URL}/api/export/geojson`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>GeoJSON</span>
          </a>
          <button
            type="button"
            onClick={onRetry}
            aria-label="Refresh feed"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error Recovery Banner */}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <div>
            <p className="font-bold">Could not load live alerts from backend</p>
            <p className="text-xs text-rose-700">{error}</p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      ) : null}

      {/* Loading Skeletons */}
      {loading && posts.length === 0 ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading live alerts">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="animate-pulse rounded-3xl border border-slate-200 bg-white p-5 shadow-glass"
            >
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-slate-200" />
                <div className="h-5 w-20 rounded-full bg-slate-200" />
                <div className="h-5 w-24 rounded-full bg-slate-100" />
              </div>
              <div className="mt-3 h-5 w-3/4 rounded-lg bg-slate-200" />
              <div className="mt-2 h-3.5 w-1/2 rounded-lg bg-slate-100" />
              <div className="mt-4 h-20 rounded-2xl bg-slate-100" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty State */}
      {!loading && posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/80 px-6 py-14 text-center">
          <p className="text-base font-bold text-slate-800">No live reports match your current filters</p>
          <p className="mt-1 text-xs text-slate-500">
            Try clearing your search, disabling Verified Only, or switching category to All.
          </p>
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        </div>
      ) : null}

      {/* Live Feed Cards */}
      <div className="space-y-4">
        {posts.map((post, idx) => (
          <PostCard
            key={post.id}
            post={post}
            isBelowFold={idx >= 3}
            highlighted={post.id === highlightedPostId}
            userCoords={userCoords}
            session={session}
            onPostUpdated={onPostUpdated}
            onFocusOnMap={onFocusOnMap}
            registerRef={registerPostRef}
          />
        ))}
      </div>
    </section>
  );
}
