'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Play } from 'lucide-react';

export default function TerminalCLI() {
  const [output, setOutput] = useState<string>(
`CivicPulse Disaster Command Terminal [v2.4.0-LK]
Type \`help\` or click shortcut chips above to run responder routines.
All cryptographic handshakes authenticated via local hardware enclave.

$ civic-cli status
[OK] Connected to LK-GRID node mesh (1,428 active peers)
[OK] SHA-256 WebAssembly accelerator: active
[OK] Gemini Multilingual Harmonizer: online (latency 18ms)
Ready for dispatcher input.`
  );
  const [inputVal, setInputVal] = useState('');
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const runCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    let newOutput = `${output}\n\n$ ${trimmed}\n`;

    if (trimmed === 'clear') {
      setOutput('CivicPulse Terminal cleared.\nReady for dispatcher input.');
      setInputVal('');
      return;
    }

    if (trimmed === 'help') {
      newOutput += 
`Available civic-cli commands:
  civic-cli stream --region <LK-REGION>   Stream live sensor telemetry from regional mesh
  civic-cli verify --hash <SHA-256>       Perform cryptographic node attestation on a report hash
  civic-cli quarantine --list             Inspect currently isolated malicious / fake panic posts
  civic-cli mesh-sync --peers <COUNT>     Initiate zero-conflict edge sync handshake
  clear                                   Clear terminal screen
  help                                    Display this command reference`;
    } else if (trimmed.includes('stream')) {
      newOutput += 
`[2026-11-21T08:19:42Z] CONNECTED TO LK-CENTRAL REGION
Node 0x9F4A (Ella A23): Soil moisture sensor 94.2% [ALERT]
Node 0x3C12 (Nuwara Eliya): Barometric pressure 1012 hPa [NORMAL]
Node 0x88F1 (Ratnapura): Rainfall rate 38 mm/hr [HEAVY]
Stream active: 3 nodes transmitting 60fps telemetry.`;
    } else if (trimmed.includes('verify')) {
      newOutput += 
`[HASH VERIFICATION] SHA-256: 9F84C2E4A7102D8B...
Origin: Camera hardware attestation valid (WebAssembly module)
Haversine Delta: 0.18 km from Ella repeater tower
Gemini Vision Multimodal Score: 0.994 (AUTHENTIC)
STATUS: VERIFIED & BROADCAST TO 1,428 PEERS`;
    } else if (trimmed.includes('quarantine')) {
      newOutput += 
`[QUARANTINE VAULT] 1 Active Intercept:
ID: Q-9041 | Category: Fake Tsunami Video
Flag: Haversine distance 3,420 km (overseas spoof) + 2018 Palu media match
Status: Sealed in isolation chamber. 0 downstream broadcasts.`;
    } else if (trimmed.includes('mesh-sync')) {
      newOutput += 
`[MESH-SYNC] Handshaking with 1,428 peers...
Packet loss: 0.00% | Latency: 14ms (Colombo Edge)
Cryptographic signatures verified: 100%
All local IndexedDB stores in sync.`;
    } else {
      newOutput += `Unknown command: '${trimmed}'. Type 'help' to see valid dispatcher options.`;
    }

    setOutput(newOutput);
    setInputVal('');
  };

  return (
    <section className="py-24 relative" id="cli">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent-emerald)] mb-2 inline-block">
            Command Line Operations for SAR & Technologists
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] mb-4 tracking-tight">
            Interactive `civic-cli` Terminal
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            CivicPulse includes a zero-dependency Rust CLI compiled for embedded repeaters, Linux
            servers, and field laptops. Test live commands below to stream telemetry, inspect hashes, or
            check quarantine states.
          </p>
        </div>

        <div className="bg-[#06090E] border border-white/15 rounded-2xl overflow-hidden shadow-2xl mono">
          {/* Window Top Bar */}
          <div className="bg-[#0D131D] px-5 py-3 flex items-center justify-between border-b border-white/10">
            <div className="flex gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            </div>
            <div className="text-xs text-slate-400">civic-cli v2.4.0 — rust-edition (sri-lanka-mesh)</div>
            <div className="text-xs text-emerald-400">STATUS: 0 ERRORS</div>
          </div>

          {/* Shortcuts Bar */}
          <div className="px-5 py-3 bg-[#090E16] border-b border-white/5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">RUN:</span>
            <button
              onClick={() => runCommand('civic-cli stream --region LK-CENTRAL')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              civic-cli stream --region LK-CENTRAL
            </button>
            <button
              onClick={() => runCommand('civic-cli verify --hash 9f84c2')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              civic-cli verify --hash 9f84c2
            </button>
            <button
              onClick={() => runCommand('civic-cli quarantine --list')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              civic-cli quarantine --list
            </button>
            <button
              onClick={() => runCommand('civic-cli mesh-sync --peers 1428')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              civic-cli mesh-sync --peers 1428
            </button>
            <button
              onClick={() => runCommand('help')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              help
            </button>
            <button
              onClick={() => runCommand('clear')}
              className="text-xs px-2.5 py-1 bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400 text-cyan-400 hover:text-white rounded transition-all"
            >
              clear
            </button>
          </div>

          {/* Terminal Output */}
          <div
            ref={outputRef}
            className="p-5 h-[320px] overflow-y-auto text-xs text-slate-200 leading-relaxed whitespace-pre-wrap"
          >
            {output}
          </div>

          {/* Terminal Command Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runCommand(inputVal);
            }}
            className="px-5 py-3 bg-[#090E16] border-t border-white/10 flex items-center gap-2"
          >
            <span className="text-emerald-400 font-bold text-xs">civil@mesh:~$</span>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="type command (e.g. civic-cli stream, help)..."
              className="flex-grow bg-transparent border-none text-white text-xs outline-none"
              spellCheck={false}
            />
          </form>
        </div>
      </div>
    </section>
  );
}
