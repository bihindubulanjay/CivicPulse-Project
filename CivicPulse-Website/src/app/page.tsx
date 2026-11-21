'use client';

import React, { useState, useEffect } from 'react';
import Preloader from '@/components/Preloader';
import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import TrustEngine from '@/components/TrustEngine';
import LiveFeed from '@/components/LiveFeed';
import OfflineQueue from '@/components/OfflineQueue';
import TravelAdvisor from '@/components/TravelAdvisor';
import TerminalCLI from '@/components/TerminalCLI';
import ReportModal from '@/components/ReportModal';
import Footer from '@/components/Footer';

export default function Home() {
  const [showPreloader, setShowPreloader] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const saved = localStorage.getItem('civicpulse-theme');
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('light');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('civicpulse-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleReportSuccess = (data: { category: string; location: string; details: string }) => {
    alert(`Report cryptographically signed with Rust SHA-256 and pushed to Sri Lanka's 1,428 node mesh!\n\nCategory: ${data.category}\nLocation: ${data.location}`);
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] transition-colors duration-300">
      {/* Cinematic Disaster Intro Preloader */}
      {showPreloader && (
        <Preloader onComplete={() => setShowPreloader(false)} />
      )}

      {/* Sticky Glassmorphic Navbar */}
      <Navbar
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenReport={() => setIsReportModalOpen(true)}
      />

      <main>
        {/* Hero Section with Live Hazard Canvas */}
        <HeroSection theme={theme} />

        {/* 4-Layer Zero-Fake Trust Engine */}
        <TrustEngine />

        {/* Verified Community Feed & Fake Simulation */}
        <LiveFeed />

        {/* Zero-Connectivity Offline Mesh Queue */}
        <OfflineQueue />

        {/* Gemini Safety & Travel Advisor */}
        <TravelAdvisor />

        {/* Responder Terminal CLI */}
        <TerminalCLI />
      </main>

      {/* Incident Report Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmitSuccess={handleReportSuccess}
      />

      {/* Emergency Hotlines & Open-Source Footer */}
      <Footer />
    </div>
  );
}
