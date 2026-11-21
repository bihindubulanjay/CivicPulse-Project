# CivicPulse — Sri Lanka Community Crisis & Nature Safety Network

An open-source, real-time community crisis, nature, and eco-tourism safety network engineered to eliminate fake panic and protect both local residents and international travelers across Sri Lanka's monsoons, landslides, and coastal hazards.

---

## 🚀 Quick Start (Next.js App Router)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to experience the application.

---

## 🎬 Realistic Disaster Loading Animation (`Preloader.tsx`)

When the application boots, a high-performance 60fps HTML5 Canvas realistic disaster VFX engine plays for 3.8 seconds:
- **Volumetric Storm Atmosphere:** Procedural multi-layer cumulonimbus storm clouds with dynamic internal lightning bloom.
- **Procedural Branching Fractal Lightning:** Recursive fractal leader strokes and return discharges with concussive camera vibration.
- **Hydrodynamic Flood Torrent:** Mathematical multi-octave wave synthesis simulating the raging muddy river with white-water foam crests.
- **Physically-Accurate Buoyant Rescue Boat:** High-vis orange inflatable Zodiac boat (`#EF5B25`) that pitches and rolls with the wave normal `atan2(dy, dx)`.
- **Volumetric Halogen Searchlight:** Luminous conical beam sweeping across the river, scattering through rain and mist.
- **Highland Landslide & Boulder Physics:** Mountain slope with tumbling boulders bouncing under gravity, kicking up mud spray, and splashing into the water.
- **Snapped High-Voltage Power Line:** Snapped utility pole with high-voltage electric plasma arcs and showers of spark embers.
- **Collapsed Highway Overpass:** Sheared concrete pier and roadway slab plunging into the river with exposed twisted rebar and hydraulic spray.
- **Camera Lens Water Droplets:** 3D refractive raindrops beading up and sliding down the screen.
- **Tactical SAR Thermal FLIR Mode:** Press `T` or click `[THERMAL FLIR]` in the top-right HUD to switch between optical camera and infrared sensor false-color mode!

---

## 📁 Project Architecture

```
civicpulse/
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with dual-theme setup & metadata
│   │   ├── globals.css        # Design tokens, theme variables, radar keyframes
│   │   └── page.tsx           # Main application assembler
│   └── components/
│       ├── Preloader.tsx      # Realistic disaster animation & Thermal FLIR sensor
│       ├── Navbar.tsx         # Sticky glassmorphic navbar with scroll-revealed logo
│       ├── HeroSection.tsx    # Live simulation canvas with 4 Sri Lanka hazard modes
│       ├── TrustEngine.tsx    # 4-layer Zero-Fake architecture breakdown
│       ├── LiveFeed.tsx       # Multilingual verified feed & fake panic quarantine demo
│       ├── OfflineQueue.tsx   # Zero-connectivity highland mesh queue
│       ├── TravelAdvisor.tsx  # Interactive Gemini Disaster & Travel Assistant
│       ├── TerminalCLI.tsx    # Interactive `civic-cli` responder console
│       ├── ReportModal.tsx    # In-browser `LIVE REC` camera attestation modal
│       └── Footer.tsx         # Official Sri Lanka emergency hotlines (117, 1990, 1912, 119)
├── index.html                 # Self-contained zero-install preview
├── next.config.mjs            # Next.js configuration
├── tailwind.config.js         # Tailwind styling tokens
├── tsconfig.json              # TypeScript configuration
└── package.json               # Scripts and dependencies
```
