'use client';

import React, { useState } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'agent' | 'user';
  text: string;
}

export default function TravelAdvisor() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'agent',
      text: 'Ayubowan! I am your <strong>CivicPulse Safety & Eco-Tourism Advisor</strong>, connected live to 1,428 Sri Lankan sensor nodes, railway alerts, and rainfall gauges. How can I help you navigate safely today?',
    },
  ]);
  const [inputVal, setInputVal] = useState('');

  const advisorKnowledge: Record<string, string> = {
    ella: '⛰️ <strong>Ella Rock & Ravana Falls Advisory:</strong> The main mountain trail is accessible, but due to high monsoon saturation (94.2%), use the southern tea estate ridge detour. Avoid stepping close to Ravana waterfall rocky edge where moss is slick. Tourist Police Emergency: 1912.',
    train:
      '🚆 <strong>Kandy to Badulla Scenic Train Status:</strong> The Main Line is operational between Kandy, Nanu Oya, and Ella. Minor speed restrictions (20 km/h) are enforced at the Great Western embankment due to soil moisture sensors. Trains are running with ~15 min delays.',
    mirissa:
      '🌊 <strong>Mirissa & Weligama Sea Conditions:</strong> South-west monsoon generates moderate swell (1.8m - 2.2m). Whale-watching catamarans with Coast Guard licenses are departing only between 06:30 and 09:30 AM before afternoon wind peaks. Surfers should avoid the reef point during high tide.',
    kelani:
      '🌧️ <strong>Kelani River Flood Telemetry:</strong> The Nagalagam Street gauge in Colombo stands at 6.8m (minor alert). Kolonnawa and Sedawatta lowlands are experiencing shallow drainage backflow. A1 expressway corridor remains clear and open to Colombo Fort.',
  };

  const handleSend = (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputVal('');

    setTimeout(() => {
      const qLower = text.toLowerCase();
      let responseText = '';

      if (qLower.includes('ella')) {
        responseText = advisorKnowledge.ella;
      } else if (
        qLower.includes('train') ||
        qLower.includes('kandy') ||
        qLower.includes('badulla')
      ) {
        responseText = advisorKnowledge.train;
      } else if (
        qLower.includes('mirissa') ||
        qLower.includes('weligama') ||
        qLower.includes('sea') ||
        qLower.includes('whale')
      ) {
        responseText = advisorKnowledge.mirissa;
      } else if (
        qLower.includes('kelani') ||
        qLower.includes('flood') ||
        qLower.includes('colombo')
      ) {
        responseText = advisorKnowledge.kelani;
      } else {
        responseText = `📍 <strong>CivicPulse Verified Advisory:</strong> Current telemetry across Sri Lanka shows active monsoon activity in Western and Sabaragamuwa provinces. For your specific route, stay connected to local DMC repeaters, carry waterproof packs, and dial <strong>117</strong> (Disaster Management) or <strong>1990</strong> (Suwa Seriya Pre-Hospital) in any emergency.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          text: responseText,
        },
      ]);
    }, 500);
  };

  return (
    <section className="py-24 relative bg-[var(--bg-surface)]" id="advisor">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent-emerald)] mb-2 inline-block">
            AI Companion for Hikers & Travelers
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] mb-4 tracking-tight">
            Gemini Safety & Travel Advisor
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Planning a trek to Ella Rock, taking the scenic Kandy-Badulla train, or visiting Mirissa
            beaches? Ask real-time questions grounded in verified Sri Lanka Disaster Management data.
          </p>
        </div>

        <div className="bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-medium)] rounded-2xl overflow-hidden shadow-[var(--shadow-elevation)] flex flex-col h-[500px]">
          {/* Header */}
          <div className="p-4 sm:px-6 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="pulse-dot text-[var(--accent-emerald)]"></span>
              <span className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Gemini Disaster & Travel Assistant
              </span>
              <span className="badge badge-emerald text-[10px]">LIVE GROUNDED</span>
            </div>
            <span className="text-xs text-[var(--text-muted)] mono">MODEL: GEMINI-2.5-FLASH</span>
          </div>

          {/* Messages Viewport */}
          <div className="flex-grow p-4 sm:p-6 overflow-y-auto flex flex-col gap-3.5">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] p-3.5 rounded-xl text-xs sm:text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--accent-emerald)] text-white self-end rounded-br-none shadow-sm'
                    : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] self-start rounded-bl-none shadow-sm'
                }`}
                dangerouslySetInnerHTML={{ __html: m.text }}
              />
            ))}
          </div>

          {/* Prompt Chips */}
          <div className="px-4 py-2.5 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex gap-2 overflow-x-auto">
            <button
              onClick={() => handleSend('Is Ella Rock trail safe to hike today?')}
              className="text-xs px-3 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--accent-emerald)] hover:text-[var(--accent-emerald)] text-[var(--text-secondary)] rounded-full whitespace-nowrap transition-all"
            >
              ⛰️ Is Ella Rock trail safe today?
            </button>
            <button
              onClick={() => handleSend('What is the Kandy to Badulla scenic train status?')}
              className="text-xs px-3 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--accent-emerald)] hover:text-[var(--accent-emerald)] text-[var(--text-secondary)] rounded-full whitespace-nowrap transition-all"
            >
              🚆 Kandy to Badulla train status?
            </button>
            <button
              onClick={() => handleSend('Are Mirissa & Weligama sea conditions safe?')}
              className="text-xs px-3 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--accent-emerald)] hover:text-[var(--accent-emerald)] text-[var(--text-secondary)] rounded-full whitespace-nowrap transition-all"
            >
              🌊 Mirissa & Weligama sea conditions?
            </button>
            <button
              onClick={() => handleSend('Kelani river flood levels near Colombo?')}
              className="text-xs px-3 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--accent-emerald)] hover:text-[var(--accent-emerald)] text-[var(--text-secondary)] rounded-full whitespace-nowrap transition-all"
            >
              🌧️ Kelani river flood levels?
            </button>
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputVal);
            }}
            className="p-3 sm:px-6 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex gap-3"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Ask about any Sri Lanka trail, road, weather, or flood status..."
              className="flex-grow px-3.5 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-emerald)] rounded-lg text-xs sm:text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--accent-emerald)] hover:bg-emerald-600 text-white rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
