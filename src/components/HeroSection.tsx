'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ShieldCheck, Layers, Activity, AlertTriangle, Compass } from 'lucide-react';

interface HeroSectionProps {
  theme: 'dark' | 'light';
}

type HazardMode = 'landslide' | 'flood' | 'cyclone' | 'intercept';

export default function HeroSection({ theme }: HeroSectionProps) {
  const [activeMode, setActiveMode] = useState<HazardMode>('landslide');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const simDetails = {
    landslide: {
      badge: 'MODE 1: HIGHLAND LANDSLIDE',
      loc: 'Ella A23 Pass (Ravana Falls • Namunukula Ridge)',
      risk: 'Soil Saturation 94.2% • Debris Runoff Active',
      detour: 'Safe Reroute via Bandarawela (B52 Ridge Trail)',
    },
    flood: {
      badge: 'MODE 2: RIVERINE FLOOD',
      loc: 'Kelani Basin • Nagalagam St. & Hanwella Reach',
      risk: 'River Crest +3.8m • Lowland Kolonnawa Ingress',
      detour: 'Avoid Baseline Road • Divert to Kandy Expressway (E04)',
    },
    cyclone: {
      badge: 'MODE 3: CYCLONE & SURGE',
      loc: 'Bay of Bengal • Trincomalee & Batticaloa Coast',
      risk: 'Central Pressure 984 hPa • Gale Winds 85 km/h',
      detour: 'Evacuate Coastal Sector 3 to High School Shelters',
    },
    intercept: {
      badge: 'MODE 4: TRUST ENGINE INTERCEPT',
      loc: 'Sri Lanka Coastal Radar & Global Ingest Mesh',
      risk: 'Recycled 2004 Panic Video Intercepted in Galle',
      detour: 'Auto-Quarantine Applied (99.7% Synthetic Mismatch)',
    },
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Particle states
    const rocks: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
    }> = [];
    for (let i = 0; i < 45; i++) {
      rocks.push({
        x: Math.random() * width * 0.5 + width * 0.45,
        y: Math.random() * height * 0.6 + 50,
        vx: -(Math.random() * 2 + 1.5),
        vy: Math.random() * 3 + 2,
        radius: Math.random() * 5 + 2,
        color: Math.random() > 0.5 ? '#8C6F56' : '#5E4B3C',
      });
    }

    const floodWaves: Array<{
      phase: number;
      speed: number;
      amplitude: number;
    }> = [];
    for (let i = 0; i < 5; i++) {
      floodWaves.push({
        phase: (Math.PI * 2 * i) / 5,
        speed: 0.02 + i * 0.005,
        amplitude: 25 + i * 8,
      });
    }

    let cycloneAngle = 0;
    let radarAngle = 0;

    const interceptReports = [
      { x: 0.35, y: 0.45, status: 'verified', label: 'Ratnapura Gem Mines: Valid', code: 'SHA: 4E19C...' },
      { x: 0.65, y: 0.38, status: 'verified', label: 'Ella Gap: Trail Stable', code: 'SHA: 8D32B...' },
      { x: 0.52, y: 0.68, status: 'fake', label: 'Galle Tsunami Wave: RECYCLED FAKE', code: 'QUARANTINED' },
      { x: 0.78, y: 0.62, status: 'verified', label: 'Mirissa Swell: 1.8m Normal', code: 'SHA: 1C44F...' },
    ];

    let animId: number;
    function render(time: number) {
      ctx.clearRect(0, 0, width, height);

      const isDark = theme === 'dark';
      const primaryTextColor = isDark ? '#F1F5F9' : '#0F172A';
      const gridColor = isDark ? 'rgba(6, 182, 212, 0.05)' : 'rgba(2, 132, 199, 0.06)';
      const contourColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(71, 85, 105, 0.14)';

      // 1. Grid
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const gridSize = 60;
      ctx.beginPath();
      for (let x = 0; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // 2. Active Sim Mode
      if (activeMode === 'landslide') {
        // Highland contours
        ctx.strokeStyle = contourColor;
        ctx.lineWidth = 1.5;
        for (let c = 0; c < 7; c++) {
          ctx.beginPath();
          const yOffset = height * 0.25 + c * 50;
          ctx.moveTo(width * 0.3, yOffset);
          ctx.bezierCurveTo(
            width * 0.5,
            yOffset - 80 + Math.sin(time * 0.001 + c) * 10,
            width * 0.75,
            yOffset + 60,
            width,
            yOffset - 30
          );
          ctx.stroke();
        }

        // Red Hazard Perimeter
        ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(width * 0.58, height * 0.28);
        ctx.lineTo(width * 0.88, height * 0.32);
        ctx.lineTo(width * 0.78, height * 0.75);
        ctx.lineTo(width * 0.48, height * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Falling boulders
        rocks.forEach((r) => {
          r.x += r.vx;
          r.y += r.vy;
          if (r.y > height * 0.75 || r.x < width * 0.45) {
            r.x = width * 0.75 + Math.random() * 120;
            r.y = height * 0.25 + Math.random() * 50;
          }
          ctx.fillStyle = r.color;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
          ctx.fill();
        });

        // Glowing Green Safe Detour Trail
        ctx.strokeStyle = isDark ? '#10B981' : '#059669';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(width * 0.35, height * 0.72);
        ctx.quadraticCurveTo(width * 0.42, height * 0.45, width * 0.52, height * 0.22);
        ctx.stroke();

        // Trail Markers
        ctx.fillStyle = isDark ? '#34D399' : '#10B981';
        [0.1, 0.45, 0.85].forEach((t) => {
          const px =
            Math.pow(1 - t, 2) * (width * 0.35) +
            2 * (1 - t) * t * (width * 0.42) +
            Math.pow(t, 2) * (width * 0.52);
          const py =
            Math.pow(1 - t, 2) * (height * 0.72) +
            2 * (1 - t) * t * (height * 0.45) +
            Math.pow(t, 2) * (height * 0.22);
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
        });

        // Annotations
        ctx.fillStyle = isDark ? 'rgba(13, 20, 31, 0.88)' : 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.15)';
        ctx.lineWidth = 1;
        const boxX = width * 0.62;
        const boxY = height * 0.38;
        ctx.fillRect(boxX, boxY, 210, 68);
        ctx.strokeRect(boxX, boxY, 210, 68);

        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillStyle = '#EF4444';
        ctx.fillText('⚠ HIGH-RISK SOIL SLIPPAGE', boxX + 12, boxY + 22);
        ctx.fillStyle = primaryTextColor;
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('SATURATION: 94.2% [CRITICAL]', boxX + 12, boxY + 40);
        ctx.fillStyle = '#10B981';
        ctx.fillText('SAFE ECO-TRAIL: ACTIVE', boxX + 12, boxY + 56);
      } else if (activeMode === 'flood') {
        // Waves
        floodWaves.forEach((wave, i) => {
          wave.phase += wave.speed;
          ctx.beginPath();
          ctx.moveTo(0, height * 0.55);
          for (let x = 0; x <= width; x += 40) {
            const y = height * 0.58 + Math.sin(x * 0.004 + wave.phase) * wave.amplitude + i * 22;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fillStyle =
            i === 0
              ? 'rgba(125, 107, 87, 0.45)'
              : isDark
              ? 'rgba(6, 182, 212, 0.08)'
              : 'rgba(2, 132, 199, 0.09)';
          ctx.fill();
        });

        // Crimson Roadblocks
        [
          { x: width * 0.42, y: height * 0.52, name: 'Hanwella Crossing' },
          { x: width * 0.68, y: height * 0.64, name: 'Nagalagam St Bridge' },
        ].forEach((rb) => {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          const rRadius = 14 + Math.sin(time * 0.005) * 6;
          ctx.beginPath();
          ctx.arc(rb.x, rb.y, rRadius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(rb.x, rb.y, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.font = 'bold 10px ui-monospace, monospace';
          ctx.fillStyle = primaryTextColor;
          ctx.fillText(rb.name + ' [CLOSED]', rb.x + 14, rb.y + 4);
        });
      } else if (activeMode === 'cyclone') {
        cycloneAngle -= 0.008;
        const cx = width * 0.68;
        const cy = height * 0.48;

        // Isobars
        ctx.strokeStyle = isDark ? 'rgba(6, 182, 212, 0.25)' : 'rgba(2, 132, 199, 0.3)';
        ctx.lineWidth = 1.5;
        [70, 130, 200, 280].forEach((r) => {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Spirals
        ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.7)' : 'rgba(2, 132, 199, 0.75)';
        ctx.lineWidth = 2;
        for (let a = 0; a < 6; a++) {
          ctx.beginPath();
          const startAngle = cycloneAngle + (Math.PI * 2 * a) / 6;
          for (let r = 25; r < 260; r += 8) {
            const theta = startAngle + r * 0.015;
            const x = cx + Math.cos(theta) * r;
            const y = cy + Math.sin(theta) * r;
            if (r === 25) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        ctx.fillStyle = isDark ? '#060A0F' : '#F4F7FA';
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#06B6D4';
        ctx.stroke();

        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillStyle = primaryTextColor;
        ctx.fillText('984 hPa EYE', cx - 32, cy + 36);
      } else if (activeMode === 'intercept') {
        radarAngle += 0.012;
        const rx = width * 0.58;
        const ry = height * 0.5;
        const maxR = 260;

        ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(5, 150, 105, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rx, ry, maxR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.8)' : 'rgba(5, 150, 105, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + Math.cos(radarAngle) * maxR, ry + Math.sin(radarAngle) * maxR);
        ctx.stroke();

        interceptReports.forEach((rep) => {
          const px = width * rep.x;
          const py = height * rep.y;

          if (rep.status === 'verified') {
            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = 'bold 10px ui-monospace, monospace';
            ctx.fillStyle = isDark ? '#34D399' : '#059669';
            ctx.fillText('✔ ' + rep.label, px + 12, py);
          } else {
            ctx.fillStyle = '#EF4444';
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fill();
            const pulseR = 16 + Math.sin(time * 0.008) * 4;
            ctx.strokeStyle = '#EF4444';
            ctx.beginPath();
            ctx.arc(px, py, pulseR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = 'bold 10px ui-monospace, monospace';
            ctx.fillStyle = '#EF4444';
            ctx.fillText('🛡️ ' + rep.label, px + 15, py);
          }
        });
      }

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
    };
  }, [activeMode, theme]);

  return (
    <section className="relative min-h-screen flex flex-col justify-center pt-28 pb-16 overflow-hidden" id="hero">
      {/* Full-bleed Canvas */}
      <canvas ref={canvasRef} id="hero-sim-canvas" className="absolute inset-0 w-full h-full z-0 pointer-events-none" />

      {/* Hero Vignette */}
      <div
        className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, transparent 40%, var(--bg-base) 92%), linear-gradient(to bottom, var(--bg-base) 0%, transparent 20%, transparent 80%, var(--bg-base) 100%)',
        }}
      />

      <div className="container relative z-20 max-w-4xl">
        {/* Brand Vector Emblem & Zero-Fake Tag */}
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-11 h-11 flex-shrink-0" viewBox="0 0 100 100">
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
              d="M28,50 L42,50 L47,36 L53,64 L58,50 L72,50"
              stroke="var(--accent-emerald)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="4" fill="var(--accent-emerald)" />
          </svg>
          <div>
            <div className="text-xl font-black tracking-wider text-[var(--text-primary)] flex items-center gap-2">
              CIVIL<span className="text-[var(--accent-emerald)]">+</span>
              <span className="badge badge-emerald text-[11px]">ZERO-FAKE PROTOCOL</span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mono tracking-wider">
              SRI LANKA COMMUNITY CRISIS & NATURE SAFETY NETWORK
            </div>
          </div>
        </div>

        {/* Pre-badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--tag-bg)] border border-[var(--border-medium)] text-xs font-semibold text-[var(--accent-emerald)] mono mb-4">
          <span className="pulse-dot"></span>
          <span>ACTIVE MONITORING: SOUTH-WEST MONSOON & HIGHLAND CORRIDORS</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1] text-[var(--text-primary)] mb-5">
          Sri Lanka's Real-Time <br />
          <span className="bg-gradient-to-r from-[var(--accent-emerald)] to-[var(--accent-cyan)] bg-clip-text text-transparent">
            Crisis & Nature Safety
          </span>{' '}
          Network
        </h1>

        <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed mb-7 max-w-2xl">
          Engineered to eradicate fake panic and protect 22M residents & international travelers.
          Combines live GPS hazard telemetry, Rust SHA-256 edge verification, and Google Gemini
          multilingual authenticity quarantine across monsoons, landslides, and eco-trails.
        </p>

        {/* Dual CTAs */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <a
            href="#feed"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[var(--accent-emerald)] to-emerald-600 text-white rounded-lg font-bold text-sm shadow-[var(--shadow-glow)] hover:-translate-y-0.5 transition-all"
          >
            <span>Explore Live Hazard Grid</span>
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="#engine"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--bg-card)] backdrop-blur-md text-[var(--text-primary)] border border-[var(--border-medium)] rounded-lg font-semibold text-sm hover:border-[var(--accent-emerald)] hover:-translate-y-0.5 transition-all"
          >
            <ShieldCheck className="w-4 h-4 text-[var(--accent-emerald)]" />
            <span>How Zero-Fake Works</span>
          </a>
        </div>

        {/* Sri Lanka Disaster Simulation Switcher Card */}
        <div className="bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-medium)] rounded-xl p-5 shadow-[var(--shadow-elevation)]">
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs font-bold tracking-wider text-[var(--text-muted)] uppercase flex items-center gap-2 mono">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>SRI LANKA HAZARD SIMULATION ENGINE (CANVAS 60FPS)</span>
            </div>
            <span className="badge badge-emerald">{simDetails[activeMode].badge}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <button
              onClick={() => setActiveMode('landslide')}
              className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                activeMode === 'landslide'
                  ? 'bg-[var(--accent-emerald-glow)] border-[var(--accent-emerald)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              }`}
            >
              <div className="text-xs font-bold text-[var(--text-primary)] flex justify-between items-center">
                <span>1. Highland Landslide</span>
                <span className="badge badge-amber text-[9px]">SAT 94%</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Ella • Ratnapura • Nuwara Eliya</div>
            </button>

            <button
              onClick={() => setActiveMode('flood')}
              className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                activeMode === 'flood'
                  ? 'bg-[var(--accent-emerald-glow)] border-[var(--accent-emerald)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              }`}
            >
              <div className="text-xs font-bold text-[var(--text-primary)] flex justify-between items-center">
                <span>2. Monsoon River Flood</span>
                <span className="badge badge-crimson text-[9px]">+3.8m CREST</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Kelani • Kalu • Nilwala Basins</div>
            </button>

            <button
              onClick={() => setActiveMode('cyclone')}
              className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                activeMode === 'cyclone'
                  ? 'bg-[var(--accent-emerald-glow)] border-[var(--accent-emerald)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              }`}
            >
              <div className="text-xs font-bold text-[var(--text-primary)] flex justify-between items-center">
                <span>3. Cyclone & Surge</span>
                <span className="badge badge-cyan text-[9px]">984 hPa</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Trincomalee • Batticaloa • Jaffna</div>
            </button>

            <button
              onClick={() => setActiveMode('intercept')}
              className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                activeMode === 'intercept'
                  ? 'bg-[var(--accent-emerald-glow)] border-[var(--accent-emerald)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              }`}
            >
              <div className="text-xs font-bold text-[var(--text-primary)] flex justify-between items-center">
                <span>4. Trust Intercept</span>
                <span className="badge badge-emerald text-[9px]">ZERO-FAKE</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Coastal Radar • Fake Post Filter</div>
            </button>
          </div>

          {/* Dynamic Telemetry Strip */}
          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between text-xs text-[var(--text-secondary)] gap-3 mono">
            <div>
              <span className="text-[var(--text-muted)]">LOCATION: </span>
              <strong className="text-[var(--text-primary)]">{simDetails[activeMode].loc}</strong>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">ACTIVE RISK: </span>
              <strong className="text-[var(--accent-amber)]">{simDetails[activeMode].risk}</strong>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">DETOUR: </span>
              <strong className="text-[var(--accent-emerald)]">{simDetails[activeMode].detour}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
