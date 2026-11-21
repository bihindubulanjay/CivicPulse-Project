import React, { useEffect, useId, useState } from 'react';
import { Eye, EyeOff, KeyRound, Shield, User, UserPlus } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import type { AuthSession } from '../types/civicpulse';
import { ModalDialog } from './ModalDialog';
import { useToast } from './ToastProvider';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (session: AuthSession) => void;
}

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
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
    }
  }, [open]);

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  function quickFill(role: 'user' | 'admin') {
    setMode('login');
    setErrorMsg(null);
    if (role === 'admin') {
      setEmail('admin@civicpulse.org');
      setPassword('admin123');
    } else {
      setEmail('user@civicpulse.org');
      setPassword('user123');
    }
  }

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
        title: mode === 'login' ? `Signed in as ${session.name}` : 'Account created & signed in',
        description: `Role: ${session.role.toUpperCase()}`,
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

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={mode === 'login' ? 'Sign In to CivicPulse' : 'Create CivicPulse Account'}
      subtitle="Authenticated reporters publish directly through the 4-Layer Trust Engine."
      maxWidthClass="w-[min(94vw,29rem)]"
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

      {/* 1-Click Demo Quick Fill */}
      {mode === 'login' ? (
        <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
            Quick-Fill Demo Accounts
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => quickFill('user')}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-indigo-50"
            >
              <User className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>Demo User</span>
            </button>
            <button
              type="button"
              onClick={() => quickFill('admin')}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-indigo-50"
            >
              <Shield className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
              <span>Demo Admin</span>
            </button>
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

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === 'register' ? (
          <div>
            <label htmlFor={nameId} className="mb-1 block text-xs font-bold text-slate-700">
              Full Name
            </label>
            <input
              id={nameId}
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kasun Perera"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
        ) : null}

        <div>
          <label htmlFor={emailId} className="mb-1 block text-xs font-bold text-slate-700">
            Email Address
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            required
            spellCheck={false}
            autoComplete={mode === 'login' ? 'username' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@civicpulse.org"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="mb-1 block text-xs font-bold text-slate-700">
            Password
          </label>
          <div className="relative">
            <input
              id={passwordId}
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
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
          {submitting
            ? 'Authenticating...'
            : mode === 'login'
              ? 'Sign In'
              : 'Create Account'}
        </button>
      </form>
    </ModalDialog>
  );
}
