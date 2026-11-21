import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  ThumbsUp,
  UserCheck,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { formatRelativeTime } from '../lib/geo';
import type { AuthSession, CurrentUser } from '../types/civicpulse';
import { ModalDialog } from './ModalDialog';
import { useToast } from './ToastProvider';

interface AccountModalProps {
  open: boolean;
  session: AuthSession | null;
  onClose: () => void;
  onProfileSynced: (user: CurrentUser) => void;
  onLogout: () => void;
}

export function AccountModal({
  open,
  session,
  onClose,
  onProfileSynced,
  onLogout,
}: AccountModalProps) {
  const { pushToast } = useToast();
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!session?.token) return;
    setLoadingProfile(true);
    try {
      const user = await apiClient.me(session.token);
      setProfile(user);
      onProfileSynced(user);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to load account details';
      pushToast({ tone: 'error', title: 'Profile load failed', description: msg });
    } finally {
      setLoadingProfile(false);
    }
  }, [session?.token, onProfileSynced, pushToast]);

  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setNewPassword('');
      setShowCurrentPw(false);
      setShowNewPw(false);
      return;
    }
    void loadProfile();
  }, [open, loadProfile]);

  async function handleCopyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      pushToast({ tone: 'info', title: 'User ID', description: id });
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.token || updatingPassword) return;
    setUpdatingPassword(true);
    try {
      await apiClient.changePassword(session.token, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      pushToast({
        tone: 'success',
        title: 'Password updated',
        description: 'Other active sessions have been signed out automatically.',
      });
      await loadProfile();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Password update failed';
      pushToast({ tone: 'error', title: 'Unable to update password', description: msg });
    } finally {
      setUpdatingPassword(false);
    }
  }

  async function handleLogoutOthers() {
    if (!session?.token || revokingSessions) return;
    setRevokingSessions(true);
    try {
      const res = await apiClient.logoutAllOtherSessions(session.token);
      pushToast({
        tone: 'success',
        title:
          res.revoked_sessions > 0
            ? `Signed out ${res.revoked_sessions} other ${res.revoked_sessions === 1 ? 'session' : 'sessions'}`
            : 'No other active sessions found',
      });
      await loadProfile();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to revoke sessions';
      pushToast({ tone: 'error', title: 'Session revoke error', description: msg });
    } finally {
      setRevokingSessions(false);
    }
  }

  if (!session) return null;

  const displayName = profile?.name ?? session.name;
  const displayEmail = profile?.email ?? session.email;
  const displayRole = profile?.role ?? session.role;
  const displayRep = profile?.reputation_score ?? session.reputation_score;
  const displayId = profile?.user_id ?? session.user_id ?? '';
  const displayExpires = profile?.expires_at ?? session.expires_at;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Account & Security Details"
      subtitle="Live profile statistics and session controls stored in SQLite."
      maxWidthClass="w-[min(95vw,38rem)]"
    >
      <div className="space-y-5">
        {/* Identity Summary Card */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm ${
                  displayRole === 'admin' ? 'bg-indigo-600' : 'bg-emerald-600'
                }`}
              >
                {displayRole === 'admin' ? (
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <UserCheck className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-extrabold text-slate-900">{displayName}</h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                      displayRole === 'admin'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {displayRole}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{displayEmail}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void loadProfile()}
              disabled={loadingProfile}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingProfile ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>

          {displayId ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-slate-500">Account ID: </span>
                <span className="break-all font-mono text-[11px] text-slate-800">{displayId}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyId(displayId)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                {copiedId ? (
                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{copiedId ? 'Copied' : 'Copy ID'}</span>
              </button>
            </div>
          ) : null}

          {/* Live DB Metrics */}
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <Award className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Reputation</span>
              </div>
              <p className="mt-1 text-base font-extrabold text-slate-900">{displayRep}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <FileText className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                <span>Reports</span>
              </div>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {profile?.reports_submitted ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                <span>Votes Cast</span>
              </div>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {profile?.votes_cast ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <Smartphone className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <span>Sessions</span>
              </div>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {profile?.active_sessions_count ?? '—'}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Joined: {profile?.created_at ? formatRelativeTime(profile.created_at) : '—'}
            </span>
            <span>Session expires: {formatRelativeTime(displayExpires)}</span>
          </div>
        </div>

        {/* Change Password Form */}
        <form
          onSubmit={handleChangePassword}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-700" aria-hidden="true" />
            <h4 className="text-sm font-bold text-slate-900">Update Password</h4>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="account-current-password"
                className="mb-1 block text-xs font-bold text-slate-700"
              >
                Current Password
              </label>
              <div className="relative">
                <input
                  id="account-current-password"
                  name="current-password"
                  type={showCurrentPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw((p) => !p)}
                  aria-pressed={showCurrentPw}
                  aria-label={showCurrentPw ? 'Hide current password' : 'Show current password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showCurrentPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="account-new-password"
                className="mb-1 block text-xs font-bold text-slate-700"
              >
                New Password (min 6 chars)
              </label>
              <div className="relative">
                <input
                  id="account-new-password"
                  name="new-password"
                  type={showNewPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw((p) => !p)}
                  aria-pressed={showNewPw}
                  aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showNewPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={updatingPassword || !currentPassword || newPassword.length < 6}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {updatingPassword ? 'Updating...' : 'Save New Password'}
          </button>
        </form>

        {/* Session Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-3">
          <button
            type="button"
            disabled={revokingSessions}
            onClick={() => void handleLogoutOthers()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
          >
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{revokingSessions ? 'Revoking...' : 'Sign Out Other Devices'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
