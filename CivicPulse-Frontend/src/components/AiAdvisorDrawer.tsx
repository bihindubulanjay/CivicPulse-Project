import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import type { ChatSourceSummary } from '../types/civicpulse';

const QUICK_QUESTIONS = [
  'Is Ella safe to visit right now?',
  'Summarize active high-severity alerts',
  'Any road flood warnings near Gampaha?',
  'Which trails are Safe today?',
];

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSourceSummary[];
  fallbackUsed?: boolean;
}

interface AiAdvisorDrawerProps {
  userCoords: { lat: number; lng: number } | null;
  onJumpToPost: (postId: string) => void;
}

export function AiAdvisorDrawer({ userCoords, onJumpToPost }: AiAdvisorDrawerProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Ask me about real-time trail conditions, floods, landslides, or travel advisories across live verified CivicPulse alerts (English, Sinhala, or Tamil).',
    },
  ]);

  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending, open]);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await apiClient.aiChat(trimmed, userCoords?.lat, userCoords?.lng);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          sources: res.sources,
          fallbackUsed: res.fallback_used,
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
          <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950 to-sky-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15">
                <Sparkles className="h-4 w-4 text-sky-300" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold leading-tight">Gemini Safety Advisor</h2>
                <p className="text-[11px] text-sky-200">Grounded in live non-quarantined alerts</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close AI Advisor"
              className="rounded-xl p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
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
              <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 w-fit">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                <span className="ml-1 font-medium">Analyzing live alerts...</span>
              </div>
            ) : null}
            <div ref={scrollEndRef} />
          </div>

          {/* Quick Suggested Questions */}
          <div className="flex gap-1.5 overflow-x-auto border-t border-slate-100 bg-slate-50/70 px-3 py-2">
            {QUICK_QUESTIONS.map((q) => (
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
        </button>
      )}
    </div>
  );
}
