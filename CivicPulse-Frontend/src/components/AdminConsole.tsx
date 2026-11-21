import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Database,
  MapPin,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { apiClient, ApiError, resolveMediaUrl } from '../lib/api';
import { formatRelativeTime } from '../lib/geo';
import type {
  AdminDatabaseOverview,
  AdminUserSummary,
  AuthSession,
  Post,
  UserRole,
} from '../types/civicpulse';
import { useToast } from './ToastProvider';

type AdminTab = 'moderation' | 'users' | 'database';
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
  const [activeTab, setActiveTab] = useState<AdminTab>('moderation');
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [overview, setOverview] = useState<AdminDatabaseOverview | null>(null);
  const [allPosts, setAllPosts] = useState<Post[]>([]);

  const [loading, setLoading] = useState(true);
  const [togglingSetting, setTogglingSetting] = useState(false);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PendingFilter>('all');
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, pending, dbOverview, userList, feedPaged] = await Promise.all([
        apiClient.getAdminSettings(session.token),
        apiClient.listAdminPending(session.token),
        apiClient.getAdminOverview(session.token),
        apiClient.listAdminUsers(session.token),
        apiClient.listPosts({ limit: 100 }, session.token),
      ]);
      onGuestPolicyUpdated(settings.allow_guest_uploads);
      setPendingPosts(pending);
      setOverview(dbOverview);
      setUsers(userList);
      setAllPosts(feedPaged.posts);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load admin telemetry';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [session.token, onGuestPolicyUpdated]);

  useEffect(() => {
    void loadAdminData();
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

  async function handleModerate(id: string, action: 'approve' | 'reject' | 'delete') {
    if (busyPostId) return;
    setBusyPostId(id);
    try {
      if (action === 'approve') {
        await apiClient.approvePost(session.token, id);
      } else if (action === 'reject') {
        await apiClient.rejectPost(session.token, id);
      } else {
        await apiClient.deletePostAsAdmin(session.token, id);
      }
      await loadAdminData();
      onPostModerated();
      pushToast({
        tone: action === 'approve' ? 'success' : 'warning',
        title:
          action === 'approve'
            ? 'Post Approved & Published'
            : action === 'reject'
              ? 'Post Rejected'
              : 'Report permanently deleted from SQLite',
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Moderation failed';
      pushToast({ tone: 'error', title: 'Action failed', description: msg });
    } finally {
      setBusyPostId(null);
    }
  }

  async function handleRoleChange(user: AdminUserSummary, nextRole: UserRole) {
    if (busyUserId) return;
    setBusyUserId(user.id);
    try {
      const updated = await apiClient.updateUserRole(session.token, user.id, nextRole);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      pushToast({
        tone: 'success',
        title: `Updated ${updated.name} to ${updated.role.toUpperCase()}`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Role update failed';
      pushToast({ tone: 'error', title: 'Unable to update role', description: msg });
    } finally {
      setBusyUserId(null);
    }
  }

  const filteredPending = pendingPosts.filter((p) =>
    filter === 'all' ? true : p.verification_status === filter,
  );
  const adminsCount = users.filter((u) => u.role === 'admin').length;

  return (
    <section aria-label="Admin Moderation Console" className="mx-auto max-w-6xl space-y-5">
      {/* Admin Policy Header Card */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5 shadow-glass">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
              Admin Operations, Users &amp; Database Console
            </h2>
            <p className="text-xs text-slate-500">
              Manage moderation queues, SQLite accounts/roles, and live database tables with zero
              mock data.
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
            onClick={() => void loadAdminData()}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh Live DB</span>
          </button>
        </div>
      </div>

      {/* Console Sub-Navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('moderation')}
          className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2 text-xs font-bold transition ${
            activeTab === 'moderation'
              ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Moderation Queue ({pendingPosts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2 text-xs font-bold transition ${
            activeTab === 'users'
              ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Users &amp; Roles ({users.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('database')}
          className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2 text-xs font-bold transition ${
            activeTab === 'database'
              ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Database className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Database Overview ({overview?.counts.total_posts ?? allPosts.length} Posts)</span>
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          {error}
        </div>
      ) : null}

      {/* TAB 1: Moderation Queue */}
      {activeTab === 'moderation' ? (
        <div className="space-y-4">
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

          {!loading && filteredPending.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <Shield className="mx-auto h-9 w-9 text-emerald-500" aria-hidden="true" />
              <p className="mt-2 text-sm font-bold text-slate-800">Moderation queue is clear</p>
              <p className="mt-1 text-xs text-slate-500">
                No Pending Admin Approval, Quarantined, or Disputed reports right now.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {filteredPending.map((post) => {
              const mediaSrc = resolveMediaUrl(post.media_url);
              const busy = busyPostId === post.id;

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
                        {post.location_name} ({post.lat.toFixed(5)}, {post.lng.toFixed(5)})
                      </span>
                    </p>

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
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">
                        {post.ai_reasoning}
                      </p>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-slate-800">
                      {post.translated_description}
                    </p>
                    {post.description !== post.translated_description ? (
                      <p className="mt-1 text-xs italic text-slate-500">
                        Original: {post.description}
                      </p>
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

                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleModerate(post.id, 'approve')}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleModerate(post.id, 'reject')}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleModerate(post.id, 'delete')}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* TAB 2: Users & Roles */}
      {activeTab === 'users' ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-glass">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Rep</th>
                  <th className="px-4 py-3">Posts</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const isSoleAdmin = u.role === 'admin' && adminsCount <= 1;
                  const nextRole: UserRole = u.role === 'admin' ? 'user' : 'admin';
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{u.name}</div>
                        <div className="text-[11px] text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                            u.role === 'admin'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          <UserCheck className="h-3 w-3" aria-hidden="true" />
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800">{u.reputation_score}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{u.posts_count}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {u.active_sessions_count}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatRelativeTime(u.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={busyUserId === u.id || isSoleAdmin}
                          onClick={() => void handleRoleChange(u, nextRole)}
                          title={
                            isSoleAdmin
                              ? 'Cannot demote the last remaining administrator'
                              : `Switch role to ${nextRole}`
                          }
                          className={`rounded-xl border px-3 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            u.role === 'admin'
                              ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          {u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TAB 3: Live Database Overview & Report Deletion */}
      {activeTab === 'database' ? (
        <div className="space-y-4">
          {overview ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-glass">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {overview.database_engine} — Schema v{overview.counts.schema_version}
                  </h3>
                  <p className="font-mono text-[11px] text-slate-500">{overview.database_path}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    Strict Unique Voters: {overview.strict_unique_voters ? 'ON' : 'OFF'}
                  </span>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">
                    Geofence: {overview.geofence_radius_km} km
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      overview.gemini_configured
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    Gemini AI: {overview.gemini_configured ? 'Connected' : 'Fallback Mode'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { label: 'Total Posts', val: overview.counts.total_posts },
                  { label: 'Verified Posts', val: overview.counts.verified_posts },
                  { label: 'Total Users', val: overview.counts.total_users },
                  { label: 'Active Sessions', val: overview.counts.active_sessions_count },
                  { label: 'Votes Recorded', val: overview.counts.total_votes },
                  { label: 'Audit Logs', val: overview.counts.total_audit_logs },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-3"
                  >
                    <p className="text-[11px] font-semibold text-slate-500">{stat.label}</p>
                    <p className="mt-1 text-lg font-extrabold text-slate-900">{stat.val}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-glass">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                Public Reports Table ({allPosts.length})
              </h3>
            </div>
            {allPosts.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                No reports stored in SQLite right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Title &amp; Place</th>
                      <th className="px-4 py-2.5">Coordinates</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Votes</th>
                      <th className="px-4 py-2.5 text-right">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allPosts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-slate-900">{p.title}</div>
                          <div className="text-[11px] text-slate-500">{p.location_name}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                          {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-slate-700">
                          {p.verification_status}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          +{p.confirmations} / -{p.false_flags}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            disabled={busyPostId === p.id}
                            onClick={() => void handleModerate(p.id, 'delete')}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
