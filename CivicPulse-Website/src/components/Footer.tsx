import React from 'react';
import { PhoneCall, ShieldAlert, HeartHandshake, Shield, AlertCircle } from 'lucide-react';
import { CONSOLE_URL } from '@/lib/consoleUrl';

export default function Footer() {
  return (
    <footer className="bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] pt-16 pb-8 text-[var(--text-secondary)]">
      <div className="container">
        {/* Sri Lanka Emergency Hotlines Bar */}
        <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-5 sm:p-6 mb-14 flex flex-wrap items-center justify-between gap-5">
          <div className="text-sm sm:text-base font-extrabold text-[var(--accent-crimson)] flex items-center gap-2">
            <PhoneCall className="w-5 h-5" />
            <span>Sri Lanka Emergency Direct Hotlines</span>
          </div>

          <div className="flex flex-wrap gap-3 mono">
            <a
              href="tel:117"
              className="bg-[var(--bg-card)] border border-red-500/25 hover:bg-[var(--accent-crimson)] hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 transition-all shadow-sm"
            >
              <span className="text-[var(--accent-crimson)] font-black">117</span> Disaster Management Centre
            </a>
            <a
              href="tel:1990"
              className="bg-[var(--bg-card)] border border-red-500/25 hover:bg-[var(--accent-crimson)] hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 transition-all shadow-sm"
            >
              <span className="text-[var(--accent-emerald)] font-black">1990</span> Suwa Seriya Ambulance
            </a>
            <a
              href="tel:1912"
              className="bg-[var(--bg-card)] border border-red-500/25 hover:bg-[var(--accent-crimson)] hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 transition-all shadow-sm"
            >
              <span className="text-[var(--accent-cyan)] font-black">1912</span> Tourist Police Emergency
            </a>
            <a
              href="tel:119"
              className="bg-[var(--bg-card)] border border-red-500/25 hover:bg-[var(--accent-crimson)] hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 transition-all shadow-sm"
            >
              <span className="text-[var(--accent-amber)] font-black">119</span> Sri Lanka Police Operations
            </a>
          </div>
        </div>

        {/* Footer Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <svg className="w-7 h-7" viewBox="0 0 100 100">
                <polygon
                  points="50,6 92,26 92,74 50,94 8,74 8,26"
                  fill="var(--bg-surface)"
                  stroke="var(--accent-emerald)"
                  strokeWidth="4"
                />
                <path
                  d="M28,50 L42,50 L47,36 L53,64 L58,50 L72,50"
                  stroke="var(--accent-emerald)"
                  strokeWidth="6"
                  fill="none"
                />
              </svg>
              <span className="text-xl font-black text-[var(--text-primary)]">
                CIVIL<span className="text-[var(--accent-emerald)]">+</span>
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-sm">
              CivicPulse is an open-source, decentralized community resilience protocol built to
              eliminate fake panic and safeguard lives across Sri Lanka's monsoonal floodplains,
              highland slopes, and coastal corridors.
            </p>
          </div>

          <div>
            <h5 className="text-xs font-extrabold text-[var(--text-primary)] tracking-wider uppercase mb-4">
              Core Engine
            </h5>
            <ul className="flex flex-col gap-2.5 text-xs">
              <li>
                <a href="#engine" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Haversine Geofencing
                </a>
              </li>
              <li>
                <a href="#engine" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Rust SHA-256 Edge Enclave
                </a>
              </li>
              <li>
                <a href="#engine" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Gemini Vision Verifier
                </a>
              </li>
              <li>
                <a href="#mesh" className="hover:text-[var(--accent-emerald)] transition-colors">
                  IndexedDB Mesh Sync
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h5 className="text-xs font-extrabold text-[var(--text-primary)] tracking-wider uppercase mb-4">
              Eco-Tourism & Safety
            </h5>
            <ul className="flex flex-col gap-2.5 text-xs">
              <li>
                <a href="#advisor" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Ella & Highland Trails
                </a>
              </li>
              <li>
                <a href="#advisor" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Scenic Train Line Watch
                </a>
              </li>
              <li>
                <a href="#advisor" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Southern Coast Swell
                </a>
              </li>
              <li>
                <a href="#feed" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Kelani River Basin
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h5 className="text-xs font-extrabold text-[var(--text-primary)] tracking-wider uppercase mb-4">
              Open Source Stack
            </h5>
            <ul className="flex flex-col gap-2.5 text-xs">
              <li>
                <a
                  href={CONSOLE_URL}
                  className="font-semibold text-[var(--accent-emerald)] hover:underline transition-colors"
                >
                  Launch Live Console
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bihindubulanjay/CivicPulse-Project"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--accent-emerald)] transition-colors"
                >
                  GitHub Repository
                </a>
              </li>
              <li>
                <a href="#cli" className="hover:text-[var(--accent-emerald)] transition-colors">
                  `civic-cli` Documentation
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-[var(--accent-emerald)] transition-colors">
                  MIT Open Source License
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-[var(--accent-emerald)] transition-colors">
                  Bug Bounty & Disclosure
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div className="pt-6 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--text-muted)] mono">
          <div>© 2026 CivicPulse Open-Source Project. Licensed under MIT. Engineered for Sri Lanka.</div>
          <div className="flex gap-4 items-center">
            <span className="text-[var(--accent-emerald)]">● LK-MESH: 1,428 NODES OPERATIONAL</span>
            <span>LATENCY: 14ms (COLOMBO EDGE)</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
