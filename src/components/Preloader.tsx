'use client';

import React, { useEffect, useRef, useState } from 'react';

interface PreloaderProps {
  onComplete: () => void;
}

export default function Preloader({ onComplete }: PreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('INITIALIZING SRI LANKA CRISIS MESH...');
  const [isThermalFLIR, setIsThermalFLIR] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const bootMessages = [
    'INITIALIZING SRI LANKA CRISIS MESH...',
    'AUTHENTICATING 1,428 DUAL-BAND EDGE NODES...',
    'LOCKING ON SENSORS: ELLA A23 & KELANI BASIN...',
    'CALIBRATING GEMINI MULTILINGUAL HARMONIZATION...',
    'ZERO-FAKE CONSENSUS SECURED • ALL NODES SYNCED',
  ];

  // 1. Boot Progress Timer (3.8s)
  useEffect(() => {
    const startTime = performance.now();
    const duration = 3800;

    let active = true;
    const updateProgress = (now: number) => {
      if (!active) return;
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.floor((elapsed / duration) * 100));
      setProgress(pct);

      const msgIdx = Math.min(
        bootMessages.length - 1,
        Math.floor((pct / 100) * bootMessages.length)
      );
      setStatusMsg(bootMessages[msgIdx]);

      if (pct >= 100) {
        handleFinish();
      } else {
        requestAnimationFrame(updateProgress);
      }
    };

    const anim = requestAnimationFrame(updateProgress);
    return () => {
      active = false;
      cancelAnimationFrame(anim);
    };
  }, []);

  const handleFinish = () => {
    setIsFadingOut(true);
    document.body.classList.remove('preloader-active');
    setTimeout(() => {
      onComplete();
    }, 750);
  };

  // Keyboard shortcut listener: ESC to skip, T for Thermal FLIR
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleFinish();
      } else if (e.key === 't' || e.key === 'T') {
        setIsThermalFLIR((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 2. Realistic Disaster Animation Canvas Engine (60fps)
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

    // Particle Systems
    // A. Rain Particles (300 drops)
    const rainDrops: Array<{
      x: number;
      y: number;
      len: number;
      speed: number;
      depth: number;
    }> = [];
    for (let i = 0; i < 300; i++) {
      rainDrops.push({
        x: Math.random() * (width + 300),
        y: Math.random() * height,
        len: Math.random() * 24 + 16,
        speed: Math.random() * 14 + 18,
        depth: Math.random() * 0.7 + 0.3,
      });
    }

    // B. Rain Impact Splashes
    const splashes: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    }> = [];

    // C. Camera Lens Droplets (40 droplets)
    const lensDroplets: Array<{
      x: number;
      y: number;
      r: number;
      alpha: number;
      vy: number;
      trailLen: number;
    }> = [];
    for (let i = 0; i < 40; i++) {
      lensDroplets.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 4 + 2,
        alpha: Math.random() * 0.45 + 0.3,
        vy: Math.random() > 0.6 ? Math.random() * 0.6 + 0.1 : 0,
        trailLen: 0,
      });
    }

    // D. Highland Landslide Boulders (16 boulders)
    const boulders: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      rot: number;
      rotSpeed: number;
      color: string;
    }> = [];
    for (let i = 0; i < 16; i++) {
      boulders.push({
        x: width * 0.75 + Math.random() * (width * 0.25),
        y: height * 0.18 + Math.random() * 100,
        vx: -(Math.random() * 2 + 1.2),
        vy: Math.random() * 2,
        r: Math.random() * 5 + 3,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        color: Math.random() > 0.5 ? '#6E553F' : '#453526',
      });
    }

    // E. Electrical Sparks from Snapped High-Voltage Line
    const sparks: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      maxLife: number;
      color: string;
    }> = [];

    // F. Lightning System
    let lightningActive = false;
    let lightningAlpha = 0;
    let lightningBolts: Array<Array<{ x: number; y: number }>> = [];
    let nextLightningTime = performance.now() + 1000;

    function generateLightningBranch(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      depth: number
    ): Array<{ x: number; y: number }> {
      const points = [{ x: x1, y: y1 }];
      const segments = 7;
      let currX = x1;
      let currY = y1;
      const dx = (x2 - x1) / segments;
      const dy = (y2 - y1) / segments;

      for (let s = 1; s < segments; s++) {
        currX += dx + (Math.random() - 0.5) * 45;
        currY += dy + (Math.random() - 0.5) * 20;
        points.push({ x: currX, y: currY });

        // Branch off
        if (depth > 0 && Math.random() > 0.65) {
          const branchTargetX = currX + (Math.random() - 0.5) * 120;
          const branchTargetY = currY + 80 + Math.random() * 60;
          lightningBolts.push(
            generateLightningBranch(currX, currY, branchTargetX, branchTargetY, depth - 1)
          );
        }
      }
      points.push({ x: x2, y: y2 });
      return points;
    }

    function triggerLightningStrike(now: number) {
      lightningActive = true;
      lightningAlpha = 1.0;
      lightningBolts = [];

      const startX = width * (0.2 + Math.random() * 0.6);
      const startY = height * 0.05;
      const targetX = startX + (Math.random() - 0.5) * 220;
      const targetY = height * 0.65;

      lightningBolts.push(generateLightningBranch(startX, startY, targetX, targetY, 2));

      // Atmospheric flash overlay
      if (flashRef.current) {
        flashRef.current.style.opacity = '0.9';
        setTimeout(() => {
          if (flashRef.current) flashRef.current.style.opacity = '0.2';
          setTimeout(() => {
            if (flashRef.current) flashRef.current.style.opacity = '0.6';
            setTimeout(() => {
              if (flashRef.current) flashRef.current.style.opacity = '0';
            }, 60);
          }, 50);
        }, 50);
      }

      // Camera Concussion Shake
      if (containerRef.current) {
        const shakeX = (Math.random() - 0.5) * 14;
        const shakeY = (Math.random() - 0.5) * 10;
        containerRef.current.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
        setTimeout(() => {
          if (containerRef.current) containerRef.current.style.transform = 'translate(0, 0)';
        }, 90);
      }

      nextLightningTime = now + Math.random() * 1800 + 1200;
    }

    // Mathematical Hydrodynamic Flood Surface
    function getWaterY(x: number, time: number) {
      const base = height * 0.62;
      const w1 = Math.sin(x * 0.0035 + time * 0.0022) * 20;
      const w2 = Math.sin(x * 0.008 - time * 0.0035) * 13;
      const w3 = Math.sin(x * 0.018 + time * 0.005) * 7;
      const w4 = Math.cos(x * 0.0015 + time * 0.001) * 16;

      // Obstacle wave / hydraulic jump around fractured bridge pier
      const distPier = Math.abs(x - width * 0.32);
      const pierSurge =
        distPier < 140
          ? Math.sin(distPier * 0.055 - time * 0.009) * (18 * (1 - distPier / 140))
          : 0;

      return base + w1 + w2 + w3 + w4 + pierSurge;
    }

    function getWaterSlope(x: number, time: number) {
      const dx = 5;
      const y1 = getWaterY(x - dx, time);
      const y2 = getWaterY(x + dx, time);
      return Math.atan2(y2 - y1, dx * 2);
    }

    function getSlopeY(x: number) {
      const relX = (x - width * 0.6) / (width * 0.4);
      return height * 0.2 + Math.pow(Math.max(0, relX), 1.25) * (height * 0.52);
    }

    // Animation Loop
    function render(time: number) {
      ctx.clearRect(0, 0, width, height);

      // Check lightning trigger
      if (time > nextLightningTime) {
        triggerLightningStrike(time);
      }
      if (lightningActive) {
        lightningAlpha *= 0.88;
        if (lightningAlpha < 0.05) {
          lightningActive = false;
        }
      }

      // --- 1. SKY & CLOUDS ---
      const isThermal = isThermalFLIR;
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.65);
      if (isThermal) {
        skyGrad.addColorStop(0, '#060012');
        skyGrad.addColorStop(0.6, '#120428');
        skyGrad.addColorStop(1, '#1A0838');
      } else {
        skyGrad.addColorStop(0, '#04070B');
        skyGrad.addColorStop(0.5, '#0B131E');
        skyGrad.addColorStop(1, '#152132');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Procedural Rolling Clouds
      for (let c = 0; c < 4; c++) {
        const cloudX = ((time * 0.02 * (c + 1) + c * 350) % (width + 600)) - 300;
        const cloudY = height * 0.15 + Math.sin(time * 0.001 + c) * 30;
        const grad = ctx.createRadialGradient(
          cloudX,
          cloudY,
          20,
          cloudX,
          cloudY,
          220 + c * 50
        );
        const cloudAlpha = isThermal ? 0.35 : 0.28 + (lightningActive ? lightningAlpha * 0.3 : 0);
        grad.addColorStop(0, isThermal ? `rgba(40, 15, 70, ${cloudAlpha})` : `rgba(20, 32, 48, ${cloudAlpha})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cloudX, cloudY, 240 + c * 40, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- 2. DISTANT SILHOUETTES (Colombo Lotus Tower & Wind-bent Palms) ---
      ctx.save();
      ctx.fillStyle = isThermal ? '#1F0B3D' : '#0B121C';

      // Lotus Tower
      const towerX = width * 0.22;
      const towerBaseY = height * 0.58;
      // Stem
      ctx.fillRect(towerX - 3, towerBaseY - 220, 6, 220);
      // Lotus Petal Bulb
      ctx.beginPath();
      ctx.ellipse(towerX, towerBaseY - 170, 16, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      // Observation deck & Mast
      ctx.fillRect(towerX - 8, towerBaseY - 195, 16, 8);
      ctx.fillRect(towerX - 1.5, towerBaseY - 260, 3, 65);
      // Red Aviation Strobe
      if (Math.sin(time * 0.006) > 0.4) {
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(towerX, towerBaseY - 262, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isThermal ? '#1F0B3D' : '#0B121C';
      }

      // Bending Coconut Palms along riverbank
      const gust = Math.sin(time * 0.004) * 15;
      [0.08, 0.16, 0.72, 0.78].forEach((rel) => {
        const px = width * rel;
        const py = height * 0.58;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + 15 + gust, py - 60, px + 40 + gust * 1.5, py - 110);
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = isThermal ? '#1F0B3D' : '#0B121C';
        ctx.stroke();

        // Palm fronds fluttering
        for (let f = 0; f < 5; f++) {
          ctx.beginPath();
          ctx.moveTo(px + 40 + gust * 1.5, py - 110);
          ctx.lineTo(
            px + 60 + gust * 1.8 + f * 10,
            py - 100 + Math.sin(time * 0.01 + f) * 8
          );
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
      ctx.restore();

      // --- 3. HIGHLAND LANDSLIDE MOUNTAIN SLOPE (Right side) ---
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(width * 0.6, height * 0.65);
      for (let x = width * 0.6; x <= width; x += 20) {
        ctx.lineTo(x, getSlopeY(x));
      }
      ctx.lineTo(width, height);
      ctx.lineTo(width * 0.6, height);
      ctx.closePath();
      const mountainGrad = ctx.createLinearGradient(width * 0.6, 0, width, height);
      if (isThermal) {
        mountainGrad.addColorStop(0, '#2A114D');
        mountainGrad.addColorStop(1, '#1A0833');
      } else {
        mountainGrad.addColorStop(0, '#2E2218');
        mountainGrad.addColorStop(0.5, '#453324');
        mountainGrad.addColorStop(1, '#1E1610');
      }
      ctx.fillStyle = mountainGrad;
      ctx.fill();

      // Landslide Scar Fissure
      ctx.beginPath();
      ctx.moveTo(width * 0.72, getSlopeY(width * 0.72));
      ctx.lineTo(width * 0.88, getSlopeY(width * 0.88) - 40);
      ctx.lineTo(width * 0.84, getSlopeY(width * 0.84) + 60);
      ctx.closePath();
      ctx.fillStyle = isThermal ? '#4D1D7A' : '#1A120A';
      ctx.fill();

      // Snapped High-Voltage Pole & Power Lines
      const poleX = width * 0.76;
      const poleY = getSlopeY(poleX);
      ctx.save();
      ctx.translate(poleX, poleY);
      ctx.rotate(0.65); // Tilted snapped pole
      ctx.fillStyle = isThermal ? '#3D2066' : '#334155';
      ctx.fillRect(-4, -60, 8, 60);
      ctx.fillRect(-18, -55, 36, 5); // Crossarm
      ctx.restore();

      // Procedural Electric Arc between wire ends
      if (Math.random() > 0.3) {
        const wire1X = poleX + 18;
        const wire1Y = poleY - 25;
        const wire2X = wire1X + 14 + (Math.random() - 0.5) * 8;
        const wire2Y = wire1Y + 22 + (Math.random() - 0.5) * 8;

        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(wire1X, wire1Y);
        ctx.lineTo((wire1X + wire2X) / 2 + (Math.random() - 0.5) * 12, (wire1Y + wire2Y) / 2);
        ctx.lineTo(wire2X, wire2Y);
        ctx.stroke();

        // Emit falling glowing sparks
        if (sparks.length < 35) {
          sparks.push({
            x: wire1X,
            y: wire1Y,
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 2 + 1,
            life: 1.0,
            maxLife: Math.random() * 40 + 20,
            color: Math.random() > 0.5 ? '#FBBF24' : '#EF4444',
          });
        }
      }

      // Render Electric Sparks
      for (let s = sparks.length - 1; s >= 0; s--) {
        const sp = sparks[s];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.22; // gravity
        sp.life -= 1 / sp.maxLife;

        ctx.fillStyle = isThermal ? '#FFFFFF' : sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, Math.max(1, sp.life * 2.5), 0, Math.PI * 2);
        ctx.fill();

        if (sp.life <= 0 || sp.y > height) {
          sparks.splice(s, 1);
        }
      }

      // Cascading Boulders Physics
      boulders.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.26; // Gravity
        b.rot += b.rotSpeed;

        const slopeLimit = getSlopeY(b.x);
        if (b.x >= width * 0.6 && b.y >= slopeLimit) {
          b.y = slopeLimit;
          b.vy = -Math.abs(b.vy) * 0.42; // Bounce
          b.vx = -(Math.random() * 1.5 + 1.2);
        }

        const waterLimit = getWaterY(b.x, time);
        if (b.y >= waterLimit) {
          // Splash and reset
          if (splashes.length < 50) {
            for (let k = 0; k < 3; k++) {
              splashes.push({
                x: b.x,
                y: waterLimit,
                vx: (Math.random() - 0.5) * 3,
                vy: -(Math.random() * 3 + 1.5),
                life: 1.0,
              });
            }
          }
          b.x = width * 0.78 + Math.random() * (width * 0.2);
          b.y = height * 0.16 + Math.random() * 60;
          b.vy = 0;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = isThermal ? '#FFAA00' : b.color;
        ctx.beginPath();
        ctx.arc(0, 0, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      ctx.restore();

      // --- 4. COLLAPSED HIGHWAY OVERPASS (A1 Corridor Realism) ---
      ctx.save();
      const bridgeDeckY = height * 0.48;
      const fractureX = width * 0.26;
      const plungeEndX = width * 0.42;
      const plungeEndY = height * 0.68;

      // Intact West Span
      ctx.fillStyle = isThermal ? '#2A1845' : '#334155';
      ctx.fillRect(0, bridgeDeckY, fractureX, 18);
      // Asphalt top
      ctx.fillStyle = isThermal ? '#1A0E2E' : '#1E293B';
      ctx.fillRect(0, bridgeDeckY - 4, fractureX, 4);
      // White highway line
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(0, bridgeDeckY - 2);
      ctx.lineTo(fractureX - 10, bridgeDeckY - 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Bridge Pier Column 1 (Intact)
      ctx.fillStyle = isThermal ? '#331B54' : '#1E293B';
      ctx.fillRect(width * 0.14 - 15, bridgeDeckY + 18, 30, height * 0.35);

      // Fractured Fallen Slab plunging into river
      ctx.beginPath();
      ctx.moveTo(fractureX, bridgeDeckY);
      ctx.lineTo(plungeEndX, plungeEndY);
      ctx.lineTo(plungeEndX - 8, plungeEndY + 18);
      ctx.lineTo(fractureX, bridgeDeckY + 22);
      ctx.closePath();
      ctx.fillStyle = isThermal ? '#3D2066' : '#1E293B';
      ctx.fill();

      // Exposed Twisted Rebar Steel Rods
      ctx.strokeStyle = isThermal ? '#FFAA00' : '#CBD5E1';
      ctx.lineWidth = 2;
      for (let r = 0; r < 4; r++) {
        ctx.beginPath();
        ctx.moveTo(fractureX, bridgeDeckY + 4 + r * 4);
        ctx.lineTo(fractureX + 12 + r * 3, bridgeDeckY + 2 + r * 5);
        ctx.lineTo(fractureX + 16, bridgeDeckY + 10 + r * 4);
        ctx.stroke();
      }

      // Hydraulic Jump Churn where slab hits flood
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.arc(
          plungeEndX - 10 + Math.sin(time * 0.008 + j) * 12,
          plungeEndY - 4 + Math.cos(time * 0.01 + j) * 6,
          8 + j * 3,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();

      // --- 5. TURBULENT MUDDY FLOODWATER HYDRODYNAMICS ---
      ctx.save();
      // Wave Base Layer
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 15) {
        ctx.lineTo(x, getWaterY(x, time));
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      const floodGrad = ctx.createLinearGradient(0, height * 0.58, 0, height);
      if (isThermal) {
        floodGrad.addColorStop(0, '#190A33');
        floodGrad.addColorStop(0.5, '#0E041F');
        floodGrad.addColorStop(1, '#060010');
      } else {
        floodGrad.addColorStop(0, '#7D6B57');
        floodGrad.addColorStop(0.35, '#5E4E3E');
        floodGrad.addColorStop(1, '#3D3126');
      }
      ctx.fillStyle = floodGrad;
      ctx.fill();

      // White-water Foam Crests
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isThermal ? 'rgba(160, 210, 255, 0.45)' : 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      for (let x = 0; x <= width; x += 25) {
        const y = getWaterY(x, time);
        const slope = getWaterSlope(x, time);
        if (Math.abs(slope) > 0.08) {
          ctx.moveTo(x - 12, y);
          ctx.lineTo(x + 12, y + 2);
        }
      }
      ctx.stroke();
      ctx.restore();

      // --- 6. ACTIVE RESCUE ZODIAC BOAT (#EF5B25) WITH WAVE PHYSICS ---
      ctx.save();
      const boatX = width * 0.52 + Math.sin(time * 0.0006) * 30;
      const boatY = getWaterY(boatX, time);
      const boatAngle = getWaterSlope(boatX, time);

      ctx.translate(boatX, boatY);
      ctx.rotate(boatAngle);

      // Inflatable Sponson Tube (Safety Orange)
      ctx.fillStyle = isThermal ? '#FFAA00' : '#EF5B25';
      ctx.beginPath();
      ctx.ellipse(0, 0, 48, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner Deck
      ctx.fillStyle = isThermal ? '#CC6600' : '#D94814';
      ctx.beginPath();
      ctx.ellipse(0, -2, 38, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // Black Outboard Motor at Stern
      ctx.fillStyle = isThermal ? '#FFFFFF' : '#0F172A'; // Blazing thermal white
      ctx.fillRect(-48, -12, 12, 22);

      // Responders (High-Vis immersion suits + reflective gear)
      // Rescuer 1 (Pilot at helm)
      ctx.fillStyle = isThermal ? '#FFFFFF' : '#FBBF24'; // Helmet
      ctx.beginPath();
      ctx.arc(-24, -18, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isThermal ? '#FF8800' : '#EF5B25';
      ctx.fillRect(-30, -12, 12, 12);

      // Rescuer 2 (Bow Navigator reaching out)
      ctx.fillStyle = isThermal ? '#FFFFFF' : '#FBBF24';
      ctx.beginPath();
      ctx.arc(18, -18, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isThermal ? '#FF8800' : '#EF5B25';
      ctx.fillRect(12, -12, 12, 12);

      // Rescued Civilian with Flotation Vest
      ctx.fillStyle = isThermal ? '#FFCC88' : '#F8FAFC';
      ctx.beginPath();
      ctx.arc(38, 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F59E0B'; // Flotation vest
      ctx.fillRect(34, 7, 8, 8);

      // Volumetric Sweeping Halogen Searchlight
      const beamAngle = -0.22 + Math.sin(time * 0.0022) * 0.35;
      const beamLength = 320;
      ctx.save();
      ctx.translate(28, -12);
      ctx.rotate(beamAngle);

      const lightGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, beamLength);
      if (isThermal) {
        lightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
        lightGrad.addColorStop(0.4, 'rgba(0, 255, 255, 0.2)');
        lightGrad.addColorStop(1, 'rgba(0, 255, 255, 0)');
      } else {
        lightGrad.addColorStop(0, 'rgba(255, 255, 220, 0.65)');
        lightGrad.addColorStop(0.35, 'rgba(255, 255, 200, 0.22)');
        lightGrad.addColorStop(1, 'rgba(255, 255, 200, 0)');
      }

      ctx.fillStyle = lightGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(beamLength, -70);
      ctx.lineTo(beamLength, 70);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.restore();

      // --- 7. BRANCHING PROCEDURAL FRACTAL LIGHTNING BOLTS ---
      if (lightningActive && lightningBolts.length > 0) {
        ctx.save();
        lightningBolts.forEach((branch) => {
          if (branch.length < 2) return;

          // Pass 1: Wide Cyan Glow Aura
          ctx.strokeStyle = `rgba(56, 189, 248, ${lightningAlpha * 0.45})`;
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.moveTo(branch[0].x, branch[0].y);
          for (let p = 1; p < branch.length; p++) {
            ctx.lineTo(branch[p].x, branch[p].y);
          }
          ctx.stroke();

          // Pass 2: Electric Core
          ctx.strokeStyle = `rgba(186, 230, 253, ${lightningAlpha * 0.85})`;
          ctx.lineWidth = 5;
          ctx.stroke();

          // Pass 3: Pure White Plasma Filament
          ctx.strokeStyle = `rgba(255, 255, 255, ${lightningAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        });
        ctx.restore();
      }

      // --- 8. TROPICAL WIND-DRIVEN RAIN PARTICLES ---
      ctx.save();
      const windAngle = 0.32 + Math.sin(time * 0.001) * 0.08;
      ctx.strokeStyle = isThermal ? 'rgba(120, 180, 255, 0.35)' : 'rgba(190, 225, 255, 0.5)';

      rainDrops.forEach((d) => {
        ctx.lineWidth = d.depth * 1.8;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * windAngle, d.y + d.len);
        ctx.stroke();

        d.y += d.speed;
        d.x -= d.speed * windAngle;

        // Ground / Water impact detection
        const waterY = getWaterY(d.x, time);
        if (d.y >= waterY) {
          if (splashes.length < 40 && Math.random() > 0.85) {
            splashes.push({
              x: d.x,
              y: waterY,
              vx: (Math.random() - 0.5) * 3,
              vy: -(Math.random() * 2.5 + 1),
              life: 1.0,
            });
          }
          d.y = -20;
          d.x = Math.random() * (width + 300);
        }
      });

      // Render rain splashes
      for (let sp = splashes.length - 1; sp >= 0; sp--) {
        const s = splashes[sp];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.25;
        s.life -= 0.06;

        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, s.life * 0.6)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
        ctx.fill();

        if (s.life <= 0) splashes.splice(sp, 1);
      }
      ctx.restore();

      // --- 9. CAMERA LENS WATER DROPLETS (CINEMATIC IMMERSION FX) ---
      ctx.save();
      lensDroplets.forEach((drop) => {
        drop.y += drop.vy;
        if (drop.y > height + 20) {
          drop.y = -10;
          drop.x = Math.random() * width;
        }

        // Drop shadow / meniscus rim
        ctx.fillStyle = `rgba(0, 0, 0, ${drop.alpha * 0.4})`;
        ctx.beginPath();
        ctx.arc(drop.x + 1, drop.y + 1, drop.r, 0, Math.PI * 2);
        ctx.fill();

        // Droplet body (translucent lens refraction)
        ctx.fillStyle = `rgba(255, 255, 255, ${drop.alpha * 0.15})`;
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight crescent
        ctx.fillStyle = `rgba(255, 255, 255, ${drop.alpha * 0.85})`;
        ctx.beginPath();
        ctx.arc(drop.x - drop.r * 0.35, drop.y - drop.r * 0.35, drop.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isThermalFLIR]);

  return (
    <aside
      ref={containerRef}
      id="civicpulse-preloader"
      className={`fixed inset-0 w-screen h-screen bg-[#04070B] z-[999999] flex flex-col justify-between overflow-hidden transition-all duration-700 ${
        isFadingOut ? 'opacity-0 scale-[1.035] pointer-events-none' : 'opacity-100'
      }`}
      style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      aria-label="Crisis Mesh Boot Simulation"
    >
      {/* Lightning Flash Screen Overlay */}
      <div
        ref={flashRef}
        className="absolute inset-0 w-full h-full bg-white opacity-0 pointer-events-none z-10 transition-opacity duration-75"
      />

      {/* 60fps Dynamic Disaster Simulation Canvas */}
      <canvas
        ref={canvasRef}
        id="preloader-canvas"
        className="absolute inset-0 w-full h-full z-0 pointer-events-none"
      />

      {/* Top Preloader HUD Bar with Tactical Sensors & Skip */}
      <header className="relative z-20 flex justify-between items-center p-6 sm:px-8">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0D141F]/80 backdrop-blur-md rounded border border-white/10 text-xs tracking-wider text-slate-300 mono">
          <span className="pulse-dot bg-cyan-400"></span>
          <span>
            {isThermalFLIR
              ? 'SAR THERMAL FLIR 8-14μm • SENSOR FEED ONLINE'
              : 'CRISIS RADAR STREAM • SRI LANKA DEFENSE SECTOR 4'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsThermalFLIR((prev) => !prev)}
            className={`px-3 py-1.5 bg-[#0D141F]/80 backdrop-blur-md rounded text-xs font-semibold tracking-wider transition-all mono flex items-center gap-2 border ${
              isThermalFLIR
                ? 'border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.35)]'
                : 'border-cyan-500/40 text-cyan-400 hover:border-cyan-400'
            }`}
            title="Toggle SAR Thermal FLIR Vision [Shortcut: T]"
          >
            <span className={`pulse-dot ${isThermalFLIR ? 'bg-red-500' : 'bg-cyan-400'}`}></span>
            <span>{isThermalFLIR ? 'OPTICAL CAM [T]' : 'THERMAL FLIR [T]'}</span>
          </button>

          <button
            onClick={handleFinish}
            className="px-4 py-1.5 bg-[#0D141F]/85 backdrop-blur-md border border-white/20 hover:border-red-500 hover:bg-red-500 hover:text-white text-slate-200 rounded text-xs font-semibold tracking-wider transition-all mono flex items-center gap-2 shadow-lg"
          >
            <span>SKIP INTRO [ESC]</span>
            <span className="opacity-60">▶</span>
          </button>
        </div>
      </header>

      {/* Tactical HUD Overlay: Radar & Telemetry Reticles */}
      <div className="absolute inset-0 w-full h-full z-10 pointer-events-none">
        {/* Animated Circular Radar Sweep */}
        <div className="absolute top-[22%] right-[10%] w-56 h-56 rounded-full border border-cyan-400/35 shadow-[inset_0_0_30px_rgba(6,182,212,0.15)] overflow-hidden">
          <div
            className="absolute top-1/2 left-1/2 w-28 h-28 origin-top-left radar-sweep-anim"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(6, 182, 212, 0.55) 0deg, transparent 65deg)',
            }}
          />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border border-dashed border-cyan-400/25" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full border border-dashed border-cyan-400/25" />
        </div>

        {/* Telemetry Lock-On Tags */}
        <div className="absolute top-[46%] left-[16%] px-3 py-1.5 bg-[#060A0F]/90 backdrop-blur-md border-l-4 border-red-500 text-red-400 text-xs font-semibold rounded-r shadow-2xl mono hud-flicker">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border border-red-400 bg-red-400/40"></span>
            <span>[BRIDGE COLLAPSE • A1 CORRIDOR • VERIFIED]</span>
          </div>
          <div className="text-[10px] opacity-80 mt-0.5">
            LAT: 6.9421°N | LNG: 80.1245°E | RESCUE BOATS: 3 ACTIVE
          </div>
        </div>

        <div className="absolute top-[34%] left-[54%] px-3 py-1.5 bg-[#060A0F]/90 backdrop-blur-md border-l-4 border-amber-500 text-amber-400 text-xs font-semibold rounded-r shadow-2xl mono hud-flicker">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border border-amber-400 bg-amber-400/40"></span>
            <span>[LANDSLIDE WATCH • ELLA A23 • SATURATION 94%]</span>
          </div>
          <div className="text-[10px] opacity-80 mt-0.5">
            DOWNED HIGH-VOLTAGE LINE • DEBRIS EVAC: IN PROGRESS
          </div>
        </div>

        <div className="absolute bottom-[24%] left-[36%] px-3 py-1.5 bg-[#060A0F]/90 backdrop-blur-md border-l-4 border-emerald-500 text-emerald-400 text-xs font-semibold rounded-r shadow-2xl mono hud-flicker">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border border-emerald-400 bg-emerald-400/40"></span>
            <span>[SHA-256: 9F84C2... AUTHENTIC]</span>
          </div>
          <div className="text-[10px] opacity-80 mt-0.5">
            RUST-EDGE HASH SIGNED • GEMINI VISION VERIFIED 99.4%
          </div>
        </div>
      </div>

      {/* Bottom Glassmorphic Boot Bar */}
      <footer className="relative z-20 bg-[#0D141F]/85 backdrop-blur-xl border-t border-white/10 p-5 sm:px-8 grid grid-cols-[auto_1fr_auto] items-center gap-6">
        <div className="flex items-center gap-3">
          {/* CivicPulse Emblem */}
          <svg width="36" height="36" viewBox="0 0 100 100">
            <polygon
              points="50,6 92,26 92,74 50,94 8,74 8,26"
              fill="#0D1F17"
              stroke="#10B981"
              strokeWidth="4"
            />
            <path
              d="M28,50 L42,50 L47,36 L53,64 L58,50 L72,50"
              stroke="#10B981"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <line x1="50" y1="28" x2="50" y2="40" stroke="#06B6D4" strokeWidth="4" />
            <line x1="50" y1="60" x2="50" y2="72" stroke="#06B6D4" strokeWidth="4" />
          </svg>
          <div>
            <div className="text-lg font-black tracking-wider text-white">
              CIVIL<span className="text-emerald-500">+</span>
            </div>
            <div className="text-[10px] text-cyan-400 tracking-widest mono">
              SRI LANKA CRISIS MESH
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-slate-400 mono">
            <span>{statusMsg}</span>
            <span className="hidden sm:inline">SRI LANKA DUAL-BAND NODES</span>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden relative">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-400 to-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="text-xl font-bold text-emerald-400 min-w-[55px] text-right mono">
          {progress}%
        </div>
      </footer>
    </aside>
  );
}
