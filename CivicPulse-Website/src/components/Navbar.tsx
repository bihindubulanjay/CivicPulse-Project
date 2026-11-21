'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon, ArrowUpRight } from 'lucide-react';
import { CONSOLE_URL } from '@/lib/consoleUrl';

interface NavbarProps {
  onOpenReport: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export default function Navbar({ onOpenReport, theme, onToggleTheme }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 80) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-[var(--bg-glass)] backdrop-blur-md border-b border-[var(--border-subtle)] transition-colors duration-300">
      <div className="container flex items-center justify-between h-[72px]">
        {/* Scroll-revealed CivicPulse Vector Logo */}
        <a
          href="#hero"
          className={`flex items-center gap-3 cursor-pointer transition-all duration-300 ${
            isScrolled
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 -translate-y-2 scale-95 pointer-events-none'
          }`}
        >
          <svg className="w-9 h-9 flex-shrink-0" viewBox="0 0 100 100">
            <polygon
              points="50,6 92,26 92,74 50,94 8,74 8,26"
              fill="var(--bg-surface)"
              stroke="var(--accent-emerald)"
              strokeWidth="4"
            />
            <circle
              cx="50"
              cy="50"
              r="32"
              stroke="var(--accent-cyan)"
              strokeWidth="1.5"
              strokeDasharray="4,4"
              fill="none"
            />
            <path
              className="pulse-stroke"
              d="M28,50 L42,50 L47,36 L53,64 L58,50 L72,50"
              stroke="var(--accent-emerald)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              style={{
                strokeDasharray: 60,
                strokeDashoffset: isScrolled ? 0 : 60,
                transition: 'stroke-dashoffset 0.8s ease',
              }}
            />
            <circle cx="50" cy="50" r="4" fill="var(--accent-emerald)" />
          </svg>
          <div className="text-lg font-black tracking-wider text-[var(--text-primary)]">
            CIVIL<span className="text-[var(--accent-emerald)]">+</span>
          </div>
          <span className="badge badge-emerald text-[10px]">ZERO-FAKE</span>
        </a>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-7">
          <a
            href="#hero"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Live Hazard Sim
          </a>
          <a
            href="#engine"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            4-Layer Engine
          </a>
          <a
            href="#feed"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Verified Feed
          </a>
          <a
            href="#mesh"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Offline Mesh
          </a>
          <a
            href="#advisor"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Travel Advisor
          </a>
          <a
            href="#cli"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            `civic-cli`
          </a>
        </nav>

        {/* Right Nav Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Live Node Count Pill */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-secondary)] mono">
            <span className="pulse-dot text-[var(--accent-emerald)]"></span>
            <span>1,428 NODES • LK-GRID</span>
          </div>

          {/* Animated Sun / Moon Theme Toggle */}
          <button
            onClick={onToggleTheme}
            className="w-10 h-10 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-center transition-all hover:border-[var(--border-active)] hover:rotate-12 shadow-sm"
            aria-label="Toggle Tactical Dark / Daylight Field Theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-800" />
            )}
          </button>

          {/* Launch Console CTA */}
          <a
            href={CONSOLE_URL}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-[var(--accent-emerald)] to-[var(--accent-cyan)] text-white rounded-md text-xs font-bold tracking-wider hover:opacity-95 transition-all shadow-[var(--shadow-glow)]"
          >
            <span>Launch Console</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>

          {/* LIVE REC Modal Opener */}
          <button
            onClick={onOpenReport}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-crimson)] text-white rounded-md text-xs font-bold tracking-wider hover:bg-red-600 transition-all shadow-[0_4px_15px_var(--accent-crimson-glow)]"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
            <span>LIVE REC</span>
          </button>
        </div>
      </div>
    </header>
  );
}
