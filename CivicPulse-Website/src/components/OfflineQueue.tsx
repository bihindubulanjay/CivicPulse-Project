'use client';

import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, Database, Radio, CheckCircle2 } from 'lucide-react';

export default function OfflineQueue() {
  const [isOffline, setIsOffline] = useState(false);
  const [queue, setQueue] = useState<Array<{ id: string; title: string; time: string }>>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  const handleToggleOffline = () => {
    const nextState = !isOffline;
    setIsOffline(nextState);
    setSyncDone(false);

    if (nextState) {
      // Automatically queue a simulated mountain incident
      const newItem = {
        id: `OFF-${Math.floor(Math.random() * 9000 + 1000)}`,
        title: "Knuckles Mountain Ridge (Corbet's Gap)",
        time: new Date().toLocaleTimeString(),
      };
      setQueue((prev) => [...prev, newItem]);
    }
  };

  const handleManualSync = () => {
    if (queue.length === 0 || isOffline) return;
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setQueue([]);
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 4000);
    }, 1200);
  };

  return (
    <section className="py-24 relative" id="mesh">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent-emerald)] mb-2 inline-block">
            Zero-Connectivity Resiliency
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] mb-4 tracking-tight">
            Offline Low-Signal Queue
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Sri Lanka's central highlands (Knuckles, Adam's Peak, Sinharaja) frequently lose cellular
            coverage. CivicPulse operates entirely offline, batching encrypted telemetry locally and
            bridging across peer mesh repeaters.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Interactive Simulator Box */}
          <div className="bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-medium)] rounded-2xl p-6 sm:p-8 shadow-[var(--shadow-elevation)]">
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-5">
              Interactive Low-Signal Simulation
            </h3>

            {/* Toggle Bar */}
            <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl mb-5">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  Simulate No-Signal Highland Zone
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Knuckles Mountain Range / Deep Forest
                </div>
              </div>

              {/* iOS Style Switch */}
              <button
                onClick={handleToggleOffline}
                className={`w-13 h-7 flex items-center rounded-full p-1 transition-colors duration-300 ${
                  isOffline ? 'bg-amber-500' : 'bg-slate-700'
                }`}
                style={{ width: '52px' }}
                aria-label="Toggle Offline Simulation"
              >
                <div
                  className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 ${
                    isOffline ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Status Indicator */}
            <div className="flex items-center justify-between mb-4 text-xs mono">
              <span className="text-[var(--text-muted)]">NETWORK STATUS:</span>
              <span className={isOffline ? 'badge badge-amber' : 'badge badge-emerald'}>
                {isOffline ? (
                  <>
                    <WifiOff className="w-3 h-3" />
                    <span>OFFLINE (LOCAL STORAGE QUEUE)</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-3 h-3" />
                    <span>ONLINE • 1,428 PEERS</span>
                  </>
                )}
              </span>
            </div>

            {/* Queue Box */}
            <div className="border border-dashed border-[var(--border-medium)] rounded-xl p-4 bg-[var(--bg-surface)] mb-5 flex flex-col gap-2.5">
              <div className="flex justify-between items-center text-xs font-bold text-[var(--text-secondary)]">
                <span>LOCAL DEVICE STORAGE QUEUE:</span>
                <span className="mono text-[var(--accent-amber)]">{queue.length} PENDING REPORTS</span>
              </div>

              <div className="flex flex-col gap-2 min-h-[60px]">
                {queue.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)] italic py-2">
                    {syncDone ? (
                      <span className="text-[var(--accent-emerald)] flex items-center gap-1.5 font-bold">
                        <CheckCircle2 className="w-4 h-4" />
                        All queued reports successfully synced with 1,428 mesh peers!
                      </span>
                    ) : (
                      'No queued offline incidents. Toggle offline mode above to test local queuing.'
                    )}
                  </div>
                ) : (
                  queue.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-xs px-3 py-2 bg-[var(--bg-card)] rounded-md border border-[var(--border-subtle)] mono"
                    >
                      <span>
                        ⏳ [{item.id}] {item.title}
                      </span>
                      <span className="text-amber-400 font-semibold">QUEUED</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Sync Button */}
            <button
              onClick={handleManualSync}
              disabled={queue.length === 0 || isOffline || isSyncing}
              className="w-full py-3 bg-[var(--accent-emerald)] text-white font-bold text-sm rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[var(--shadow-glow)]"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>
                {isSyncing
                  ? 'Executing SHA-256 Mesh Handshake...'
                  : isOffline
                  ? 'Reconnect to Cellular/LoRa to Sync'
                  : 'Sync Queued Telemetry with Mesh'}
              </span>
            </button>
          </div>

          {/* Explanation Cards */}
          <div className="flex flex-col gap-4">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <Database className="w-5 h-5 text-[var(--accent-emerald)]" />
                <h4 className="text-base font-bold text-[var(--text-primary)]">
                  Local-First IndexedDB Store & Forward
                </h4>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Every hazard report captured during blackouts is immediately timestamped, cryptographically
                sealed with the device's public key, and saved into an encrypted browser SQLite/IndexedDB
                store.
              </p>
            </div>

            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <Radio className="w-5 h-5 text-[var(--accent-cyan)]" />
                <h4 className="text-base font-bold text-[var(--text-primary)]">
                  Bluetooth Low Energy & LoRa Repeater Hops
                </h4>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                When cellular towers flood or lose power, CivicPulse packets hop peer-to-peer across hiker
                smartphones, Sri Lanka Telecom LoRa gateways, and rural tea factory antennas until reaching
                an internet-connected node.
              </p>
            </div>

            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="w-5 h-5 text-[var(--accent-amber)]" />
                <h4 className="text-base font-bold text-[var(--text-primary)]">
                  Atomic Re-Sync & Collision Resolution
                </h4>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Upon re-establishing uplink, batch reports execute a zero-conflict SHA-256 handshake.
                Duplicate reports from the same location merge automatically into a consensus certainty
                cluster.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
