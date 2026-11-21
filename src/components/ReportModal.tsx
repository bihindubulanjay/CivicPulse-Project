'use client';

import React, { useState } from 'react';
import { X, Camera, ShieldCheck, MapPin } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: (data: { category: string; location: string; details: string }) => void;
}

export default function ReportModal({ isOpen, onClose, onSubmitSuccess }: ReportModalProps) {
  const [category, setCategory] = useState('Landslide & Rockfall');
  const [location, setLocation] = useState('Ella A23 Pass (Ravana Falls)');
  const [details, setDetails] = useState('Mud and rock debris across both lanes. Pedestrian tea trail safe and dry.');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitSuccess({ category, location, details });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-medium)] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-scale-up">
        {/* Header */}
        <div className="px-6 py-4 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-base font-extrabold text-[var(--text-primary)]">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
            <span>Submit Verified Report (`LIVE REC`)</span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 flex flex-col gap-4">
            {/* Viewfinder Simulation */}
            <div className="relative h-48 bg-[#0A0F18] border border-[var(--border-medium)] rounded-xl overflow-hidden flex flex-col items-center justify-center">
              {/* Grid Lines */}
              <div
                className="absolute inset-0 pointer-events-none opacity-10"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
                  backgroundSize: '33.3% 33.3%',
                }}
              />

              {/* Viewfinder HUD */}
              <div className="absolute top-2.5 left-3 right-3 flex justify-between text-[11px] text-cyan-400 mono">
                <span>● REC [RAW BUFFER 60FPS]</span>
                <span>GPS: 6.9271°N, 79.8612°E (COLOMBO)</span>
              </div>

              {/* Center Crosshair */}
              <div className="w-10 h-10 border border-dashed border-cyan-400/60 rounded-full flex items-center justify-center">
                <Camera className="w-5 h-5 text-cyan-400/80" />
              </div>

              <div className="text-[11px] text-slate-400 mono mt-2 text-center">
                HARDWARE ATTESTATION: READY (CAMERA ID: SONY-IMX-766)
              </div>
            </div>

            {/* Category Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[var(--text-secondary)]">
                Incident Hazard Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-emerald)] rounded-lg text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="Landslide & Rockfall">Highland Landslide & Rockfall (Slope Failure)</option>
                <option value="Riverine Flash Flood">Riverine or Urban Flash Flood</option>
                <option value="Roadblock / Fallen Tree">High-Voltage Line / Fallen Roadblock</option>
                <option value="Coastal Storm Surge">Coastal Wave Surge / Sea Water Ingress</option>
              </select>
            </div>

            {/* Location Input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[var(--text-secondary)]">
                Location / Corridor in Sri Lanka
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-emerald)] rounded-lg text-sm text-[var(--text-primary)] outline-none"
              />
            </div>

            {/* Details */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[var(--text-secondary)]">
                On-the-Ground Observations
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                required
                rows={3}
                className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-emerald)] rounded-lg text-sm text-[var(--text-primary)] outline-none resize-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border-medium)] rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[var(--accent-emerald)] hover:bg-emerald-600 text-white rounded-lg text-xs font-bold tracking-wider transition-all shadow-[var(--shadow-glow)] flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Cryptographically Sign & Post</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
