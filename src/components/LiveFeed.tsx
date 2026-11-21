'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ShieldAlert, Video } from 'lucide-react';

type Lang = 'en' | 'si' | 'ta' | 'de' | 'ja';

export default function LiveFeed() {
  const [lang, setLang] = useState<Lang>('en');
  const [hasFakePost, setHasFakePost] = useState(false);

  const translations = {
    en: {
      post1:
        'A23 Ella-Wellawaya Pass rockfall confirmed near 21st km post. Mud and small boulders blocking both lanes. Road development authority loaders on site. Safe pedestrian bypass open through Ella-Bandarawela tea estate trail.',
      post2:
        'Kelani River crest gauge reached +3.8m above minor flood threshold at Hanwella. Low-lying access roads in Kolonnawa and Sedawatta receiving backflow. 1990 Pre-Hospital ambulances staged at Grandpass flyover.',
      post3:
        "World's End trail open. Dense cloud mist with 45 km/h ridge gusts. Baker's Falls wooden bridge clear and stable. Hikers advised to bring thermal rain covers and stay on marked track.",
      badge_alert: 'HIGH ALERT',
      badge_surge: 'CRITICAL SURGE',
      badge_clear: 'CLEAR TRAIL',
    },
    si: {
      post1:
        'ඇල්ල-වැල්ලවාය A23 මාර්ගයේ 21 වන කිලෝමීටර් කණුව අසල පස් සහ ගල් පෙරළීමක් තහවුරු විය. මංතීරු දෙකම අවහිර වී ඇත. මාර්ග සංවර්ධන අධිකාරී යන්ත්‍ර ක්‍රියාත්මකයි. ඇල්ල-බණ්ඩාරවෙල තේ වතු මාර්ගය හරහා ආරක්ෂිත පදික මාවත විවෘතයි.',
      post2:
        'කැළණි ගඟේ ජල මට්ටම හංවැල්ල ප්‍රදේශයේදී සුළු ගංවතුර මට්ටමට වඩා මීටර් +3.8 කින් ඉහළ ගොස් ඇත. කොලොන්නාව සහ සේදවත්ත පහත්බිම් මාර්ග ජලයෙන් යටවේ. 1990 සුවසැරිය ගිලන්රථ ග්‍රෑන්ඩ්පාස් ගුවන් පාලම අසල සූදානමින් පවතී.',
      post3:
        'හෝර්ටන් තැන්න ලෝකාන්ත මාර්ගය විවෘතයි. ඝන මීදුම සහ පැයට කිලෝමීටර් 45 ක තද සුළං පවතී. බේකර්ස් ඇල්ල ලී පාලම සුරක්ෂිතයි. සංචාරකයින් වැසි ආවරණ රැගෙන සලකුණු කළ මාර්ගයේ පමණක් ගමන් කරන්න.',
      badge_alert: 'අධි අවදානම්',
      badge_surge: 'ගංවතුර අවදානම',
      badge_clear: 'මාර්ගය විවෘතයි',
    },
    ta: {
      post1:
        'எல்ல-வெல்லவாய A23 பாதையில் 21வது கி.மீ கம்பம் அருகில் மண்சரிவு மற்றும் பாறை வீழ்ச்சி உறுதிப்படுத்தப்பட்டது. இரு பாதைகளும் மூடப்பட்டுள்ளன. எல்ல-பண்டாரவளை தேயிலைத் தோட்டப் பாதை வழியாக பாதுகாப்பான மாற்றுப்பாதை திறக்கப்பட்டுள்ளது.',
      post2:
        'களனி கங்கையின் நீர்மட்டம் ஹங்வெல்ல பகுதியில் வெள்ள எச்சரிக்கை அளவை விட +3.8 மீ உயர்ந்துள்ளது. கொலன்னாவ மற்றும் சேதவத்த தாழ்நிலப் பாதைகள் நீரில் மூழ்கியுள்ளன. 1990 அவசர அம்புலன்ஸ் சேவைகள் தயாராக உள்ளன.',
      post3:
        'ஹோர்ட்டன் சமவெளி உலக முடிவுப் பாதை திறக்கப்பட்டுள்ளது. கடும் மூடுபனி மற்றும் பலத்த காற்று வீசுகிறது. பேக்கர்ஸ் நீர்வீழ்ச்சி பாலம் பாதுகாப்பானது. பயணிகள் உரிய பாதையில் செல்லுமாறு அறிவுறுத்தப்படுகிறார்கள்.',
      badge_alert: 'உயர் எச்சரிக்கை',
      badge_surge: 'தீவிர வெள்ளம்',
      badge_clear: 'பாதை தெளிவு',
    },
    de: {
      post1:
        'Steinschlag auf der A23 Ella-Wellawaya-Passhöhe nahe KM 21 bestätigt. Schlamm und Felsbrocken blockieren beide Spuren. Sicherer Fußgänger-Bypass über den Ella-Bandarawela Teeplantagen-Pfad ist begehbar.',
      post2:
        'Kelani-Flusspegel bei Hanwella liegt +3,8 m über Hochwassermarke. Tiefliegende Zufahrtsstraßen in Kolonnawa überflutet. 1990-Rettungswagen an der Grandpass-Überführung postiert.',
      post3:
        "World's End Wanderweg geöffnet. Dichter Nebel mit 45 km/h Böen. Die Holzbrücke der Baker's Falls ist intakt. Wanderer sollten wetterfeste Ponchos tragen und auf den Pfaden bleiben.",
      badge_alert: 'HOHE WARNUNG',
      badge_surge: 'KRITISCHE FLUT',
      badge_clear: 'PFAD OFFEN',
    },
    ja: {
      post1:
        'エッラ〜ウェッラワヤA23号線21kmポスト付近で落石・土砂崩れを確認。両車線封鎖中。エッラ〜バンダラウェラ間の茶畑迂回トレイルは徒歩通行可能です。',
      post2:
        'ケラニ川の水位がハンウェッラ観測所で警戒水準+3.8mに到達。コロンナワおよびセダワッタの低地道路で冠水発生中。1990救急車がスタンバイしています。',
      post3:
        'ホートン・プレインズのワールズ・エンド遊歩道は開放中。濃霧および最大風速45km/h。ベイカーズ滝の木橋は安全です。指定されたトレイルから外れないでください。',
      badge_alert: '高警戒警報',
      badge_surge: '洪水警戒',
      badge_clear: '通行可能',
    },
  };

  const currentDict = translations[lang] || translations.en;

  return (
    <section className="py-24 relative bg-[var(--bg-surface)]" id="feed">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold tracking-widest uppercase text-[var(--accent-emerald)] mb-2 inline-block">
            Real-Time Community Feed
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] mb-4 tracking-tight">
            Verified Sri Lanka Hazard Stream
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Toggle languages dynamically or simulate an incoming fake panic post to witness the
            4-Layer Zero-Fake Trust Engine isolate and quarantine malicious misinformation.
          </p>
        </div>

        <div className="bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-medium)] rounded-2xl p-6 sm:p-8 shadow-[var(--shadow-elevation)]">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--border-subtle)]">
            {/* Language Switcher */}
            <div className="flex items-center gap-1.5 p-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg">
              <span className="text-xs text-[var(--text-muted)] px-2 mono">LANG:</span>
              {(['en', 'si', 'ta', 'de', 'ja'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                    lang === l
                      ? 'bg-[var(--accent-emerald)] text-white shadow-[0_0_10px_var(--accent-emerald-glow)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {l === 'en'
                    ? 'EN'
                    : l === 'si'
                    ? 'සිංහල'
                    : l === 'ta'
                    ? 'தமிழ்'
                    : l === 'de'
                    ? 'DE'
                    : 'JA'}
                </button>
              ))}
            </div>

            {/* Fake Panic Simulation Trigger */}
            <button
              onClick={() => setHasFakePost(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/40 text-[var(--accent-crimson)] rounded-lg text-xs font-bold tracking-wider hover:bg-red-500 hover:text-white transition-all shadow-sm"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Simulate Fake Panic Post</span>
            </button>
          </div>

          {/* Posts List */}
          <div className="flex flex-col gap-5">
            {/* Simulated Quarantined Fake Post */}
            {hasFakePost && (
              <article className="bg-red-500/5 border-2 border-[var(--accent-crimson)] rounded-xl p-5 animate-bounce-short transition-all">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center text-sm font-bold text-red-500">
                      🚨
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[var(--text-primary)]">
                        Viral Panic Forward (WhatsApp Reshare)
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mono">
                        Just Now • Alleged: Southern Coast / Galle
                      </div>
                    </div>
                  </div>
                  <span className="badge badge-crimson">AUTO-QUARANTINED</span>
                </div>

                <div className="text-sm font-semibold text-red-400 mb-4 leading-relaxed">
                  "🚨 BREAKING: 15-meter tsunami confirmed striking Galle Fort and Weligama beach right
                  now! Entire southern expressway blocked! Evacuate immediately to Colombo!"
                </div>

                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-xs flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold text-red-400 mono">
                    <ShieldAlert className="w-4 h-4" />
                    <span>ZERO-FAKE TRUST ENGINE INTERCEPT • SPREAD HALTED</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 mono text-[11px]">
                    <div>❌ <strong>HAVERSINE GPS:</strong> Pinged from 3,420 km away (overseas VPN spoof).</div>
                    <div>❌ <strong>SHA-256 HASH:</strong> Video signature matches 2018 Palu tsunami archive.</div>
                    <div>❌ <strong>GEMINI VISION:</strong> Mismatch detected. Galle Port sensor is calm (0.3m tide, 28°C sunny).</div>
                    <div>🛡️ <strong>STATUS:</strong> Quarantined from 1,428 community feeds before panic propagation.</div>
                  </div>
                </div>
              </article>
            )}

            {/* Post 1 */}
            <article className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] rounded-xl p-5 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--tag-bg)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-bold text-[var(--accent-emerald)]">
                    EP
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      Ella Eco-Rescue Team (Post 04)
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mono">
                      12 mins ago • Ella Rock / Ravana Corridor
                    </div>
                  </div>
                </div>
                <span className="badge badge-amber">{currentDict.badge_alert}</span>
              </div>

              <div className="text-sm text-[var(--text-primary)] leading-relaxed mb-4">
                {currentDict.post1}
              </div>

              <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs mono">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  <Video className="w-3 h-3" />
                  LIVE REC IN-APP
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  HAVERSINE: 0.18 km
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  SHA-256: 9F84C2E4...
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  GEMINI VISION: 99.4% AUTHENTIC
                </span>
              </div>
            </article>

            {/* Post 2 */}
            <article className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] rounded-xl p-5 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--tag-bg)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-bold text-[var(--accent-emerald)]">
                    CM
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      Colombo DMC Volunteer Mesh
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mono">
                      24 mins ago • Nagalagam Street Basin
                    </div>
                  </div>
                </div>
                <span className="badge badge-crimson">{currentDict.badge_surge}</span>
              </div>

              <div className="text-sm text-[var(--text-primary)] leading-relaxed mb-4">
                {currentDict.post2}
              </div>

              <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs mono">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  <Video className="w-3 h-3" />
                  LIVE REC IN-APP
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  HAVERSINE: 0.32 km
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  SHA-256: 4A7D1EB9...
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  GEMINI VISION: 98.8% AUTHENTIC
                </span>
              </div>
            </article>

            {/* Post 3 */}
            <article className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] rounded-xl p-5 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--tag-bg)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-bold text-[var(--accent-emerald)]">
                    HP
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      Horton Plains Highland Ranger
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mono">
                      1 hour ago • World's End Escarpment
                    </div>
                  </div>
                </div>
                <span className="badge badge-emerald">{currentDict.badge_clear}</span>
              </div>

              <div className="text-sm text-[var(--text-primary)] leading-relaxed mb-4">
                {currentDict.post3}
              </div>

              <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs mono">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  <Video className="w-3 h-3" />
                  LIVE REC IN-APP
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  HAVERSINE: 0.12 km
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] text-[11px]">
                  SHA-256: 7C12AA3F...
                </span>
                <span className="px-2.5 py-1 bg-[var(--tag-bg)] border border-[var(--border-subtle)] rounded text-[var(--accent-emerald)] text-[11px]">
                  GEMINI VISION: 99.7% AUTHENTIC
                </span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
