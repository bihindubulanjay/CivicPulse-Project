import React from 'react';
import { Globe, Lock, Brain, Languages } from 'lucide-react';

export default function TrustEngine() {
  const layers = [
    {
      index: 'LAYER 01 • PROXIMITY',
      title: 'Haversine GPS Geofencing',
      icon: Globe,
      accent: 'var(--accent-cyan)',
      desc: 'Reports must originate within a strict physical radius (<800m) of Sri Lankan cell towers, GPS constellations, or LoRa repeaters. Overseas VPN or spoofed coordinates are flagged instantly.',
      code: 'haversine(device_coord, incident_node) < 0.8 km',
    },
    {
      index: 'LAYER 02 • INTEGRITY',
      title: 'Rust SHA-256 Edge Hashing',
      icon: Lock,
      accent: 'var(--accent-emerald)',
      desc: 'Every in-browser `LIVE REC` camera frame is hashed at capture time in WebAssembly/Rust. Prevents file tampering, recycled historical flood media (e.g., 2004 or 2016 archives), and deepfakes.',
      code: 'sha256::digest(raw_buffer) -> 9f84c2...',
    },
    {
      index: 'LAYER 03 • MULTIMODAL AI',
      title: 'Gemini Vision Auto-Quarantine',
      icon: Brain,
      accent: 'var(--accent-amber)',
      desc: 'Google Gemini Vision analyzes the incident video stream against official Sri Lanka Dept. of Meteorology radar and hydrological gauges. Outlier panic claims are isolated into a quarantine sandbox.',
      code: 'gemini.verify(stream, sensor_context) >= 0.95',
    },
    {
      index: 'LAYER 04 • COMMUNITY HARMONIZATION',
      title: 'Real-Time Multilingual Translation',
      icon: Languages,
      accent: 'var(--accent-crimson)',
      desc: 'Synchronizes verified updates instantaneously across Sinhala, Tamil, and English for residents, plus German and Japanese for eco-tourists in Ella, Sigiriya, and Mirissa.',
      code: 'translate([SI, TA, EN, DE, JA], stream)',
    },
  ];

  return (
    <section className="py-24 relative" id="engine">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent-emerald)] mb-2 inline-block">
            Cryptographic Truth & Verification
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] mb-4 tracking-tight">
            The 4-Layer Zero-Fake Trust Engine
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            During disasters, recycled WhatsApp rumors and false tsunami alarms cause deadly stampedes.
            CivicPulse filters out false reports in milliseconds through four uncompromising hardware &
            AI checkpoints.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {layers.map((layer, idx) => {
            const IconComponent = layer.icon;
            return (
              <div
                key={idx}
                className="bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-subtle)] hover:border-[var(--border-medium)] rounded-xl p-6 transition-all duration-300 hover:-translate-y-1 shadow-[var(--shadow-elevation)] flex flex-col relative overflow-hidden"
              >
                <div
                  className="absolute top-0 left-0 w-full h-[3px]"
                  style={{
                    background: `linear-gradient(90deg, ${layer.accent}, transparent)`,
                  }}
                />

                <div
                  className="text-[11px] font-extrabold tracking-wider uppercase mb-3 mono"
                  style={{ color: layer.accent }}
                >
                  {layer.index}
                </div>

                <div
                  className="w-12 h-12 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center mb-5"
                  style={{ color: layer.accent }}
                >
                  <IconComponent className="w-6 h-6" />
                </div>

                <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">
                  {layer.title}
                </h3>

                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-5 flex-grow">
                  {layer.desc}
                </p>

                <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[11px] text-[var(--text-muted)] mono truncate">
                  {layer.code}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
