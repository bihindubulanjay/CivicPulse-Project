import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import type { AuthSession, AuthStatusResponse } from '../types/civicpulse';
import { ModalDialog } from './ModalDialog';
import { useToast } from './ToastProvider';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (session: AuthSession) => void;
}

function evaluatePasswordStrength(pw: string): {
  label: string;
  bars: number;
  barClass: string;
  textClass: string;
} {
  if (!pw) {
    return { label: 'Minimum 6 characters', bars: 0, barClass: 'bg-slate-200', textClass: 'text-slate-500' };
  }
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;

  if (score <= 1) {
    return { label: 'Weak — add length, digits, or symbols', bars: 1, barClass: 'bg-rose-500', textClass: 'text-rose-700' };
  }
  if (score === 2) {
    return { label: 'Fair', bars: 2, barClass: 'bg-amber-500', textClass: 'text-amber-700' };
  }
  if (score === 3) {
    return { label: 'Good', bars: 3, barClass: 'bg-sky-500', textClass: 'text-sky-700' };
  }
  return { label: 'Strong', bars: 4, barClass: 'bg-emerald-500', textClass: 'text-emerald-700' };
}

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setPassword('');
      setShowPassword(false);
      return;
    }

    let active = true;
    apiClient
      .getAuthStatus()
      .then((status) => {
        if (!active) return;
        setAuthStatus(status);
        if (!status.has_admin) {
          setMode('register');
        }
      })
      .catch(() => {
        // Non-fatal if offline or unreachable
      });

    return () => {
      active = false;
    };
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const session =
        mode === 'login'
          ? await apiClient.login(email.trim(), password)
          : await apiClient.register(name.trim(), email.trim(), password);

      onSuccess(session);
      pushToast({
        tone: 'success',
        title:
          mode === 'login'
            ? `Signed in as ${session.name}`
            : session.role === 'admin'
              ? 'Initial Administrator account created'
              : 'Account created & signed in',
        description: `Verified Role: ${session.role.toUpperCase()}`,
      });
      setPassword('');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Authentication failed';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const strength = evaluatePasswordStrength(password);
  const needsAdminBootstrap = authStatus !== null && !authStatus.has_admin;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={
        mode === 'login'
          ? 'Sign In to CivicPulse'
          : needsAdminBootstrap
            ? 'Initialize System Administrator'
            : 'Create CivicPulse Account'
      }
      subtitle="Passwords are hashed with Argon2id and sessions are persisted in SQLite."
      maxWidthClass="w-[min(94vw,29.5rem)]"
    >
      {/* Mode Switcher */}
      <div className="mb-4 grid grid-cols-2 rounded-2xl border border-slate-200 bg-slate-100/80 p-1">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setErrorMsg(null);
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
            mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sign In</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setErrorMsg(null);
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
            mode === 'register'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Register</span>
        </button>
      </div>

      {needsAdminBootstrap ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
          <div>
            <p className="font-bold">Initial Admin Setup</p>
            <p className="mt-0.5 leading-relaxed text-indigo-800">
              No administrator exists yet in the database. The first account registered here is
              automatically granted <span className="font-bold">Admin</span> privileges.
            </p>
          </div>
        </div>
      ) : null}

      {errorMsg ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800"
        >
          {errorMsg}
        </div>
      ) : null}

      {mode === 'login' ? (
        <form id="civicpulse-signin-form" onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="auth-signin-email" className="mb-1 block text-xs font-bold text-slate-700">
              Email Address
            </label>
            <input
              id="auth-signin-email"
              name="email"
              type="email"
              required
              spellCheck={false}
              autoComplete="username"
              enterKeyHint="next"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <div>
            <label htmlFor="auth-signin-password" className="mb-1 block text-xs font-bold text-slate-700">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-signin-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                maxLength={128}
                autoComplete="current-password"
                enterKeyHint="done"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      ) : (
        <form id="civicpulse-signup-form" onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="auth-signup-name" className="mb-1 block text-xs font-bold text-slate-700">
              Full Name
            </label>
            <input
              id="auth-signup-name"
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              enterKeyHint="next"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <div>
            <label htmlFor="auth-signup-email" className="mb-1 block text-xs font-bold text-slate-700">
              Email Address
            </label>
            <input
              id="auth-signup-email"
              name="email"
              type="email"
              required
              spellCheck={false}
              autoComplete="username"
              enterKeyHint="next"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <div>
            <label htmlFor="auth-signup-password" className="mb-1 block text-xs font-bold text-slate-700">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-signup-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
                enterKeyHint="done"
                aria-describedby="auth-signup-pw-strength"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            <div id="auth-signup-pw-strength" className="mt-2 space-y-1">
              <div className="grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition ${
                      strength.bars >= step ? strength.barClass : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
              <p className={`text-[11px] font-semibold ${strength.textClass}`}>{strength.label}</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting
              ? 'Creating Account...'
              : needsAdminBootstrap
                ? 'Create Admin Account'
                : 'Create Account'}
          </button>
        </form>
      )}
    </ModalDialog>
  );
}
