import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Flag,
  Fingerprint,
  Languages,
  MapPin,
  MessageSquare,
  Navigation,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UserCheck,
} from 'lucide-react';
import { apiClient, ApiError, resolveMediaUrl } from '../lib/api';
import { formatDistanceKm, formatRelativeTime, haversineKm } from '../lib/geo';
import type {
  AuthSession,
  Category,
  IntegrityVerifyResponse,
  Post,
  TravelAdvisory,
  VerificationStatus,
} from '../types/civicpulse';
import { useToast } from './ToastProvider';

const CATEGORY_PILL: Record<Category, string> = {
  Disaster: 'bg-rose-50 text-rose-700 border-rose-200',
  Nature: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Tourism: 'bg-sky-50 text-sky-700 border-sky-200',
  Road: 'bg-amber-50 text-amber-800 border-amber-200',
};

const ADVISORY_PILL: Record<TravelAdvisory, string> = {
  Safe: 'bg-emerald-100/80 text-emerald-800 border-emerald-300',
  Caution: 'bg-amber-100/80 text-amber-900 border-amber-300',
  Danger: 'bg-rose-100/80 text-rose-800 border-rose-300',
};

const STATUS_PILL: Record<VerificationStatus, string> = {
  'AI Verified': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Community Verified': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Admin Approved': 'bg-sky-50 text-sky-700 border-sky-200',
  'Pending Community Verification': 'bg-amber-50 text-amber-800 border-amber-200',
  'Pending Admin Approval': 'bg-slate-100 text-slate-700 border-slate-300',
  Disputed: 'bg-orange-50 text-orange-800 border-orange-200',
  Quarantined: 'bg-rose-50 text-rose-800 border-rose-200',
  Unverified: 'bg-slate-100 text-slate-600 border-slate-200',
  Rejected: 'bg-rose-100 text-rose-900 border-rose-300',
};

interface PostCardProps {
  post: Post;
  isBelowFold: boolean;
  highlighted: boolean;
  userCoords: { lat: number; lng: number } | null;
  session: AuthSession | null;
  onPostUpdated: (updated: Post) => void;
  onFocusOnMap: (post: Post) => void;
  registerRef: (id: string, node: HTMLElement | null) => void;
}

export function PostCard({
  post,
  isBelowFold,
  highlighted,
  userCoords,
  session,
  onPostUpdated,
  onFocusOnMap,
  registerRef,
}: PostCardProps) {
  const { pushToast } = useToast();
  const [showTranslated, setShowTranslated] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentText, setCommentText] = useState('');
  const [busyAction, setBusyAction] = useState<'verify' | 'flag' | 'resolve' | 'comment' | null>(null);
  const [integrityResult, setIntegrityResult] = useState<IntegrityVerifyResponse | null>(null);
  const [verifyingHash, setVerifyingHash] = useState(false);
  const [mediaBroken, setMediaBroken] = useState(false);

  // Sync guest author input cleanly when signing in/out
  useEffect(() => {
    setCommentAuthor(session?.name ?? '');
  }, [session?.user_id, session?.name]);

  const hasTranslationDiff =
    post.description.trim() !== post.translated_description.trim() &&
    post.translated_description.trim().length > 0;

  const displayedDescription =
    showTranslated || !hasTranslationDiff ? post.translated_description : post.description;

  const mediaSrc = mediaBroken ? null : resolveMediaUrl(post.media_url);
  const distKm =
    userCoords !== null ? haversineKm(userCoords.lat, userCoords.lng, post.lat, post.lng) : null;

  const isOwnPost = Boolean(
    session?.user_id && post.author_id && session.user_id === post.author_id,
  );
  const canResolve = Boolean(session && (session.role === 'admin' || isOwnPost));
  const viewerVote = post.viewer_vote ?? null;
  const isVotingLocked =
    post.verification_status === 'Pending Admin Approval' ||
    post.verification_status === 'Quarantined' ||
    post.verification_status === 'Rejected';

  const confirmDisabled =
    busyAction !== null || isOwnPost || viewerVote !== null || isVotingLocked || post.is_resolved;
  const flagDisabled = busyAction !== null || isOwnPost || viewerVote !== null || isVotingLocked;

  const confirmTooltip = isOwnPost
    ? 'You cannot confirm your own report'
    : viewerVote === 'verify'
      ? 'You already confirmed this report'
      : viewerVote === 'flag'
        ? 'You already flagged this report'
        : isVotingLocked
          ? `Voting is disabled while status is ${post.verification_status}`
          : post.is_resolved
            ? 'Resolved reports cannot receive new confirmations'
            : 'Confirm this incident is active';

  const flagTooltip = isOwnPost
    ? 'You cannot flag your own report'
    : viewerVote === 'flag'
      ? 'You already flagged this report'
      : viewerVote === 'verify'
        ? 'You already confirmed this report'
        : isVotingLocked
          ? `Flagging is disabled while status is ${post.verification_status}`
          : 'Flag inaccurate or misleading information';

  const aiScoreTone =
    post.ai_authenticity_score > 65
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : post.ai_authenticity_score >= 40
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';

  async function handleAction(kind: 'verify' | 'flag' | 'resolve') {
    if (busyAction) return;
    setBusyAction(kind);
    try {
      const token = session?.token ?? null;
      const updated =
        kind === 'verify'
          ? await apiClient.verifyPost(post.id, token)
          : kind === 'flag'
            ? await apiClient.flagPost(post.id, token)
            : await apiClient.toggleResolve(post.id, token);

      onPostUpdated(updated);
      pushToast({
        tone: kind === 'flag' ? 'warning' : 'success',
        title:
          kind === 'verify'
            ? 'Confirmation recorded'
            : kind === 'flag'
              ? 'Report flagged for review'
              : updated.is_resolved
                ? 'Marked as Resolved / Safe'
                : 'Reopened as Active Alert',
        description: `Status: ${updated.verification_status}`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Action failed';
      pushToast({ tone: 'error', title: 'Unable to update report', description: msg });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || busyAction) return;
    setBusyAction('comment');
    try {
      const updated = await apiClient.addComment(
        post.id,
        session ? undefined : commentAuthor.trim() || undefined,
        commentText.trim(),
        session?.token ?? null,
      );
      onPostUpdated(updated);
      setCommentText('');
      pushToast({ tone: 'success', title: 'Comment posted' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to post comment';
      pushToast({ tone: 'error', title: 'Comment error', description: msg });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifyHashClick() {
    if (verifyingHash) return;
    setVerifyingHash(true);
    try {
      await navigator.clipboard?.writeText(post.integrity_hash).catch(() => undefined);
      const result = await apiClient.verifyIntegrity(post.id);
      setIntegrityResult(result);
      pushToast({
        tone: result.valid ? 'success' : 'error',
        title: result.valid ? 'SHA-256 Integrity Verified' : 'Integrity Mismatch Detected',
        description: `Hash copied: ${post.integrity_hash.slice(0, 18)}…`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to verify hash';
      pushToast({ tone: 'error', title: 'Hash verification failed', description: msg });
    } finally {
      setVerifyingHash(false);
    }
  }

  return (
    <article
      ref={(node) => registerRef(post.id, node)}
      className={`${isBelowFold ? 'feed-card-deferred' : ''} group rounded-3xl border bg-white p-4 shadow-glass transition duration-200 sm:p-5 ${
        highlighted
          ? 'border-sky-500 ring-4 ring-sky-500/15'
          : 'border-slate-200/90 hover:border-slate-300'
      } ${post.is_resolved ? 'opacity-85' : ''}`}
    >
      {/* Top Meta Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${CATEGORY_PILL[post.category]}`}
          >
            {post.category}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${ADVISORY_PILL[post.travel_advisory]}`}
          >
            {post.travel_advisory === 'Danger' ? (
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {post.travel_advisory}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
            Severity {post.severity}/10
          </span>
          {isOwnPost ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
              <UserCheck className="h-3 w-3" aria-hidden="true" />
              Your Report
            </span>
          ) : null}
          {post.is_resolved ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Resolved / Safe
            </span>
          ) : null}
        </div>

        <time
          dateTime={post.created_at}
          title={post.created_at}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-400"
        >
          <Clock className="h-3 w-3" aria-hidden="true" />
          {formatRelativeTime(post.created_at)}
        </time>
      </div>

      {/* Title & Location */}
      <h3 className="mt-2.5 text-base font-extrabold leading-snug tracking-tight text-slate-900 sm:text-lg">
        {post.title}
      </h3>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => onFocusOnMap(post)}
          className="inline-flex items-center gap-1 font-medium text-slate-600 transition hover:text-sky-600"
        >
          <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
          <span>{post.location_name}</span>
        </button>
        {distKm !== null ? (
          <span className="font-semibold text-sky-700">{formatDistanceKm(distKm)}</span>
        ) : null}
      </div>

      {/* 4-Layer Trust Badges */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {post.is_live_captured ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
            <Radio className="h-3 w-3" aria-hidden="true" />
            LIVE REC
          </span>
        ) : null}

        {post.is_on_site ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">
            <Navigation className="h-3 w-3" aria-hidden="true" />
            ON-SITE GPS
          </span>
        ) : null}

        <span
          title={post.ai_reasoning}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${aiScoreTone}`}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          AI Trust: {post.ai_authenticity_score}%
        </span>

        <span
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[post.verification_status]}`}
        >
          {post.verification_status === 'Disputed' || post.verification_status === 'Quarantined' ? (
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          )}
          {post.verification_status}
        </span>

        {/* Clickable SHA-256 Integrity Hash */}
        <button
          type="button"
          onClick={handleVerifyHashClick}
          disabled={verifyingHash}
          title={
            integrityResult
              ? `${integrityResult.valid ? 'Cryptographically Verified' : 'Hash Mismatch'}: ${post.integrity_hash}`
              : `Click to copy & verify SHA-256: ${post.integrity_hash}`
          }
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-[11px] font-medium transition ${
            integrityResult
              ? integrityResult.valid
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-rose-300 bg-rose-50 text-rose-700'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'
          }`}
        >
          <Fingerprint className="h-3 w-3" aria-hidden="true" />
          <span>{post.integrity_hash.slice(0, 10)}…</span>
          <Copy className="h-2.5 w-2.5 opacity-70" aria-hidden="true" />
          {integrityResult ? (
            <span className="font-sans font-bold">
              {integrityResult.valid ? '✓ Valid' : '✗ Invalid'}
            </span>
          ) : null}
        </button>
      </div>

      {/* Original / English Translation Toggle + Body */}
      <div className="mt-3.5 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
        {hasTranslationDiff ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
              <Languages className="h-3.5 w-3.5" aria-hidden="true" />
              {showTranslated ? 'English AI Translation' : 'Original Reporter Language'}
            </span>
            <button
              type="button"
              onClick={() => setShowTranslated((prev) => !prev)}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-50"
            >
              {showTranslated ? 'Show Original' : 'Show English'}
            </button>
          </div>
        ) : null}

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {displayedDescription}
        </p>

        {post.ai_reasoning ? (
          <p className="mt-2 border-t border-slate-200/70 pt-2 text-[11px] leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-700">AI Forensics:</span> {post.ai_reasoning}
          </p>
        ) : null}
      </div>

      {/* Media Preview */}
      {mediaSrc ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
          <img
            src={mediaSrc}
            alt={`Evidence for ${post.title}`}
            loading="lazy"
            onError={() => setMediaBroken(true)}
            className="max-h-72 w-full object-cover"
          />
        </div>
      ) : null}

      {/* Action Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={confirmDisabled}
            aria-pressed={viewerVote === 'verify'}
            title={confirmTooltip}
            onClick={() => handleAction('verify')}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              viewerVote === 'verify'
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                : 'border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-55'
            }`}
          >
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{viewerVote === 'verify' ? 'Confirmed' : 'Confirm'}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[11px] font-extrabold ${
                viewerVote === 'verify'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-emerald-700'
              }`}
            >
              {post.confirmations}
            </span>
          </button>

          <button
            type="button"
            disabled={flagDisabled}
            aria-pressed={viewerVote === 'flag'}
            title={flagTooltip}
            onClick={() => handleAction('flag')}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              viewerVote === 'flag'
                ? 'border-rose-600 bg-rose-600 text-white shadow-sm'
                : 'border-rose-200 bg-rose-50/70 text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-55'
            }`}
          >
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{viewerVote === 'flag' ? 'Flagged' : 'Flag Fake'}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[11px] font-extrabold ${
                viewerVote === 'flag' ? 'bg-rose-700 text-white' : 'bg-white text-rose-700'
              }`}
            >
              {post.false_flags}
            </span>
          </button>

          {canResolve ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => handleAction('resolve')}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
                post.is_resolved
                  ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{post.is_resolved ? 'Reopen' : 'Mark Resolved'}</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setCommentsOpen((prev) => !prev)}
          aria-expanded={commentsOpen}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
        >
          <MessageSquare className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          <span>{post.comments.length} Comments</span>
          {commentsOpen ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Expandable Comments Section */}
      {commentsOpen ? (
        <div className="mt-3 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
          {post.comments.length === 0 ? (
            <p className="text-xs text-slate-500">
              No community updates yet. Share an on-the-ground observation below.
            </p>
          ) : (
            <ul className="space-y-2">
              {post.comments.map((c, idx) => (
                <li
                  key={`${c.created_at}-${idx}`}
                  className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">{c.author}</span>
                    <span className="text-[11px] text-slate-400">
                      {formatRelativeTime(c.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-slate-700">{c.text}</p>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCommentSubmit} className="flex flex-col gap-2 sm:flex-row">
            {session ? (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                <span className="truncate max-w-[140px]">As {session.name}</span>
              </div>
            ) : (
              <input
                type="text"
                value={commentAuthor}
                onChange={(e) => setCommentAuthor(e.target.value)}
                placeholder="Your name (optional)"
                aria-label="Comment author"
                maxLength={100}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none sm:w-36"
              />
            )}
            <div className="flex flex-1 gap-2">
              <input
                type="text"
                required
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a live ground update..."
                aria-label="Comment text"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busyAction === 'comment' || !commentText.trim()}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Send</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}
