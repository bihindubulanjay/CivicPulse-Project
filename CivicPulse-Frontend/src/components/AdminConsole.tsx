import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  MapPin,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react';
import { apiClient, ApiError, resolveMediaUrl } from '../lib/api';
import { formatRelativeTime } from '../lib/geo';
import type { AuthSession, Post } from '../types/civicpulse';
import { useToast } from './ToastProvider';

type PendingFilter = 'all' | 'Pending Admin Approval' | 'Quarantined' | 'Disputed';

interface AdminConsoleProps {
  session: AuthSession;
  allowGuestUploads: boolean;
  onGuestPolicyUpdated: (allowed: boolean) => void;
  onPostModerated: () => void;
  refreshTrigger: number;
}

export function AdminConsole({
  session,
  allowGuestUploads,
  onGuestPolicyUpdated,
  onPostModerated,
  refreshTrigger,
}: AdminConsoleProps) {
  const { pushToast } = useToast();
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingSetting, setTogglingSetting] = useState(false);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PendingFilter>('all');
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, pending] = await Promise.all([
        apiClient.getAdminSettings(session.token),
        apiClient.listAdminPending(session.token),
      ]);
      onGuestPolicyUpdated(settings.allow_guest_uploads);
      setPendingPosts(pending);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load moderation queue';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [session.token, onGuestPolicyUpdated]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, refreshTrigger]);

  async function handleToggleGuestUploads() {
    if (togglingSetting) return;
    setTogglingSetting(true);
    try {
      const updated = await apiClient.updateAdminSettings(session.token, !allowGuestUploads);
      onGuestPolicyUpdated(updated.allow_guest_uploads);
      pushToast({
        tone: 'info',
        title: updated.allow_guest_uploads
          ? 'Guest Uploads Enabled'
          : 'Guest Uploads Disabled',
        description: updated.allow_guest_uploads
          ? 'Guests can submit reports into the Admin Approval Queue.'
          : 'Unauthenticated submissions now require Sign In (HTTP 403).',
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update setting';
      pushToast({ tone: 'error', title: 'Settings update failed', description: msg });
    } finally {
      setTogglingSetting(false);
    }
  }

  async function handleModerate(id: string, action: 'approve' | 'reject') {
    if (moderatingId) return;
    setModeratingId(id);
    try {
      if (action === 'approve') {
        await apiClient.approvePost(session.token, id);
      } else {
        await apiClient.rejectPost(session.token, id);
      }
      setPendingPosts((prev) => prev.filter((p) => p.id !== id));
      onPostModerated();
      pushToast({
        tone: action === 'approve' ? 'success' : 'warning',
        title: action === 'approve' ? 'Post Approved & Published' : 'Post Rejected',
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Moderation failed';
      pushToast({ tone: 'error', title: 'Moderation error', description: msg });
    } finally {
      setModeratingId(null);
    }
  }

  const filtered = pendingPosts.filter((p) =>
    filter === 'all' ? true : p.verification_status === filter,
  );

  return (
    <section aria-label="Admin Moderation Console" className="mx-auto max-w-5xl space-y-5">
      {/* Admin Policy Card */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5 shadow-glass">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
              Admin Moderation &amp; Policy Console
            </h2>
            <p className="text-xs text-slate-500">
              Control guest reporting permissions and review AI-quarantined, disputed, and guest
              submissions.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={allowGuestUploads}
            disabled={togglingSetting}
            onClick={handleToggleGuestUploads}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition ${
              allowGuestUploads
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                : 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
            }`}
          >
            {allowGuestUploads ? (
              <ToggleRight className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-rose-600" aria-hidden="true" />
            )}
            <span>Allow Guest Uploads: {allowGuestUploads ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={loadAdminData}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh Queue</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `All Queue (${pendingPosts.length})` },
            {
              id: 'Pending Admin Approval',
              label: `Guest Pending (${pendingPosts.filter((p) => p.verification_status === 'Pending Admin Approval').length})`,
            },
            {
              id: 'Quarantined',
              label: `AI Quarantined (${pendingPosts.filter((p) => p.verification_status === 'Quarantined').length})`,
            },
            {
              id: 'Disputed',
              label: `Disputed (${pendingPosts.filter((p) => p.verification_status === 'Disputed').length})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
              filter === tab.id
                ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          {error}
        </div>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Shield className="mx-auto h-9 w-9 text-emerald-500" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-slate-800">Moderation queue is clear</p>
          <p className="mt-1 text-xs text-slate-500">
            No Pending Admin Approval, Quarantined, or Disputed reports right now.
          </p>
        </div>
      ) : null}

      {/* Review Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((post) => {
          const mediaSrc = resolveMediaUrl(post.media_url);
          const busy = moderatingId === post.id;

          return (
            <article
              key={post.id}
              className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-glass"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    {post.verification_status}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    {formatRelativeTime(post.created_at)}
                  </span>
                </div>

                <h3 className="mt-2.5 text-base font-extrabold text-slate-900">{post.title}</h3>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                  <span>
                    {post.location_name} ({post.lat.toFixed(4)}, {post.lng.toFixed(4)})
                  </span>
                </p>

                {/* AI Trust Bar */}
                <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="inline-flex items-center gap-1 text-slate-700">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                      Gemini AI Trust Score
                    </span>
                    <span
                      className={
                        post.ai_authenticity_score > 65
                          ? 'text-emerald-700'
                          : post.ai_authenticity_score >= 40
                            ? 'text-amber-700'
                            : 'text-rose-700'
                      }
                    >
                      {post.ai_authenticity_score}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${
                        post.ai_authenticity_score > 65
                          ? 'bg-emerald-500'
                          : post.ai_authenticity_score >= 40
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                      }`}
                      style={{ width: `${post.ai_authenticity_score}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{post.ai_reasoning}</p>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-800">
                  {post.translated_description}
                </p>
                {post.description !== post.translated_description ? (
                  <p className="mt-1 text-xs italic text-slate-500">Original: {post.description}</p>
                ) : null}

                {mediaSrc ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <img
                      src={mediaSrc}
                      alt={post.title}
                      className="max-h-52 w-full object-cover"
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleModerate(post.id, 'approve')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>Approve Public</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleModerate(post.id, 'reject')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span>Reject</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
