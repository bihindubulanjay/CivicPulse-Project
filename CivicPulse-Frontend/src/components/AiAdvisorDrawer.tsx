import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import type {
  ChatHistoryTurn,
  ChatSourceSummary,
  ReverseGeocodeResponse,
  UserCoords,
} from '../types/civicpulse';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSourceSummary[];
  fallbackUsed?: boolean;
  modelUsed?: string | null;
  isError?: boolean;
}

const WELCOME_MESSAGE: ChatTurn = {
  id: 'welcome',
  role: 'assistant',
  text: 'Ask me about live trail conditions, floods, landslides, or travel advisories across verified real-time CivicPulse reports (English, Sinhala, or Tamil).',
};

interface AiAdvisorDrawerProps {
  userCoords: UserCoords | null;
  liveLocationDetails?: ReverseGeocodeResponse | null;
  geminiConfigured?: boolean;
  geminiModel?: string | null;
  onJumpToPost: (postId: string) => void;
}

export function AiAdvisorDrawer({
  userCoords,
  liveLocationDetails,
  geminiConfigured = false,
  geminiModel,
  onJumpToPost,
}: AiAdvisorDrawerProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([WELCOME_MESSAGE]);

  const scrollEndRef = useRef<HTMLDivElement>(null);

  const quickQuestions = useMemo(() => {
    const place =
      liveLocationDetails?.address?.city ??
      liveLocationDetails?.address?.district ??
      liveLocationDetails?.short_name;

    if (place) {
      return [
        `Any active hazards or road alerts near ${place}?`,
        'Summarize active high-severity alerts',
        'Which reported areas are currently Safe?',
        'Any severe road or landslide advisories right now?',
      ];
    }
    return [
      'Summarize active high-severity alerts',
      'Which reported areas are currently Safe?',
      'Any severe road or flood advisories right now?',
      'Are there any disputed or unverified alerts today?',
    ];
  }, [liveLocationDetails]);

  useEffect(() => {
    if (open) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending, open]);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    const history: ChatHistoryTurn[] = messages
      .filter((m) => m.id !== 'welcome' && !m.isError)
      .slice(-10)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.text,
      }));

    const userMsg: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await apiClient.aiChat(
        trimmed,
        userCoords?.lat,
        userCoords?.lng,
        history,
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          sources: res.sources,
          fallbackUsed: res.fallback_used,
          modelUsed: res.model_used,
        },
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to reach AI advisor';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: `Error: ${msg}`,
          isError: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendQuestion(input);
  }

  return (
    <div className="fixed bottom-4 right-4 z-[900] sm:bottom-5 sm:right-5">
      {open ? (
        <section
          aria-label="Gemini Safety & Travel Advisor"
          className="flex h-[min(78dvh,34rem)] w-[min(94vw,24.5rem)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-elevated backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-slate-900 via-indigo-950 to-sky-900 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Sparkles className="h-4 w-4 text-sky-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-sm font-bold leading-tight">Gemini Safety Advisor</h2>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      geminiConfigured
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-amber-500/20 text-amber-200'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        geminiConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`}
                    />
                    {geminiConfigured ? `Live${geminiModel ? ` · ${geminiModel}` : ''}` : 'Fallback'}
                  </span>
                </div>
                <p className="truncate text-[11px] text-sky-200">
                  Multi-turn chat grounded in live CivicPulse reports
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 1 ? (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setMessages([WELCOME_MESSAGE])}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                  className="rounded-xl p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close AI Advisor"
                className="rounded-xl p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  {m.text}
                </div>

                {m.fallbackUsed ? (
                  <span className="mt-1 text-[10px] font-semibold text-amber-700">
                    Deterministic live-database summary (Gemini unavailable/rate-limited)
                  </span>
                ) : m.role === 'assistant' && m.modelUsed ? (
                  <span className="mt-1 text-[10px] font-medium text-emerald-700">
                    Live Gemini · {m.modelUsed}
                  </span>
                ) : null}

                {m.sources && m.sources.length > 0 ? (
                  <div className="mt-1.5 flex max-w-[92%] flex-wrap gap-1">
                    {m.sources.slice(0, 3).map((src) => (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => onJumpToPost(src.id)}
                        className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800 transition hover:bg-sky-100"
                      >
                        {src.location_name.split(',')[0]} · {src.travel_advisory}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {sending ? (
              <div className="flex w-fit items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                <span className="ml-1 font-medium">Analyzing live alerts...</span>
              </div>
            ) : null}
            <div ref={scrollEndRef} />
          </div>

          {/* Dynamic Suggested Questions */}
          <div className="flex gap-1.5 overflow-x-auto border-t border-slate-100 bg-slate-50/70 px-3 py-2">
            {quickQuestions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={sending}
                onClick={() => sendQuestion(q)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={handleFormSubmit}
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-2.5"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask safety or travel question..."
              aria-label="Ask Gemini Safety Advisor"
              maxLength={2000}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-slate-900 via-indigo-900 to-sky-900 px-4 py-3 text-xs font-bold text-white shadow-elevated transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <Bot className="h-4 w-4 text-sky-300" aria-hidden="true" />
          <span>Gemini Safety Chat</span>
          {geminiConfigured ? (
            <span className="h-2 w-2 rounded-full bg-emerald-400" title="Live Gemini active" />
          ) : null}
        </button>
      )}
    </div>
  );
}
