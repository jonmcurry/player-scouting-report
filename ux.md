Mobile UX Implementation GuideStep 1: Mobile UX Strategy & ArchitectureTo optimize the Softball/Baseball Swing Scouting Reports app for field use, the mobile design prioritizes high-contrast visibility, thumb-first ergonomics, and clear AI vs. coach data verification.  Core Ergonomic PrinciplesThumb-First Target Sizing: All key interactive elements maintain a minimum target size of $48\text{px} \times 48\text{px}$ to facilitate easy one-handed operation while standing behind a backstop or holding a phone on the field.  Sunlight-Optimized Contrast: Utilizes a dark slate background (#121418) paired with high-contrast clay/terracotta primary accents (#C2593F) and sand text (#F4EFEA) to ensure legibility in direct sunlight.  Instant Confirmation Flows: Score updates require a single tap on a numeric stepper rather than opening dropdowns or navigating sub-menus.  Explicit AI Statuses: Visual badges explicitly distinguish unreviewed AI drafts (🤖 AI Draft) from verified observations (✓ Coach Reviewed).  Step 2: Information Architecture & Mobile NavigationThe mobile layout shifts from dense desktop tables to a mobile-friendly layout anchored by a Sticky App Header and a Bottom Navigation Bar.+-------------------------------------------------------+
|  [#10 Emily C. ▼]   Latham Lady Bison 10U   [ ☀️/🌙 ]  |  <-- Sticky App Bar
+-------------------------------------------------------+
|                                                       |
|                     MAIN CONTENT                      |
|             (Roster / Report / Log View)              |
|                                                       |
+-------------------------------------------------------+
|  [ ⚾ Roster ]      [ 📊 Report ]      [ ➕ Log AB ]  |  <-- Sticky Bottom Nav
+-------------------------------------------------------+
Key Navigation Routes⚾ Team Roster: Fast player switcher, roster confirmation progress (e.g., "9/11 Confirmed"), and overall team-wide trend filters.📊 Scouting Report: Interactive player breakdown with card-based checklist items, trend banners, and pitch outcome correlations.➕ Quick Log & AB Capture: Rapid-entry modal featuring a 9-zone touch strike zone for logging pitch locations and game outcomes.Step 3: Interactive Component WireframesA. Single-Tap Checkpoint CardConverts tabular checklist items into standalone mobile cards.+-------------------------------------------------------+
| CHECKPOINT 03                         [ 🤖 AI Draft ] |
| Hip-Shoulder Separation                               |
|-------------------------------------------------------|
| Score:  [ 1 ]  ( 2 )  [ 3 ]      (Selected: 2)        |
|                                                       |
| Notes: "Hips opening early on middle-in pitches."     |
| Cites: AB#2, AB#4                                     |
|-------------------------------------------------------|
| [ 📐 View 3D Skeleton ]          [ Confirm Score ]    |
+-------------------------------------------------------+
B. 9-Zone Strike Zone PickerAllows fast pitch location logging without typing.              [ Pitch Location ]
             +---+---+---+
             | 1 | 2 | 3 |  (High)
             +---+---+---+
             | 4 | 5 | 6 |  (Middle)
             +---+---+---+
             | 7 | 8 | 9 |  (Low)
             +---+---+---+
          [ In ]  [ Mid ]  [ Out ]

      Outcome: ( Take )  [ Foul ]  ( Ball in Play )
Step 4: Standalone HTML5/Tailwind Mobile UX PrototypeHTML<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Swing Scouting - Mobile UX Prototype</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #121418; color: #F4EFEA; }
    .font-display { font-family: 'Oswald', sans-serif; }
    .bg-clay { background-color: #C2593F; }
    .text-clay { color: #C2593F; }
    .border-clay { border-color: #C2593F; }
    .bg-card { background-color: #1E2229; }
    .touch-target { min-height: 48px; min-width: 48px; }
  </style>
</head>
<body class="pb-24 select-none">

  <!-- STICKY TOP APP BAR -->
  <header class="sticky top-0 z-30 bg-[#121418]/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-10 h-10 rounded-full bg-clay text-white flex items-center justify-center font-display text-xl font-bold border-2 border-[#F4EFEA]/20 shadow-md">
        10
      </div>
      <div>
        <div class="flex items-center space-x-1">
          <h1 class="font-display text-lg tracking-wide uppercase font-bold text-white leading-tight">Emily C.</h1>
          <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>
        <p class="text-xs text-gray-400">Latham Lady Bison 10U</p>
      </div>
    </div>
    
    <div class="flex items-center space-x-2">
      <span class="text-xs bg-emerald-950 text-emerald-400 border border-emerald-700/50 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
        <span>✓</span> 9/11 Confirmed
      </span>
    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <main class="p-4 space-y-4 max-w-md mx-auto">

    <!-- ALERT BANNER: TRENDING UP -->
    <div class="bg-emerald-900/30 border border-emerald-500/40 rounded-xl p-3 flex items-start space-x-3">
      <div class="text-emerald-400 text-lg">📈</div>
      <div class="text-xs">
        <span class="font-bold text-emerald-300 uppercase tracking-wider block font-display">Trending Up</span>
        <span class="text-gray-300">Checkpoint <strong class="text-white">Load Mechanics</strong> improved from <span class="line-through text-gray-400">1</span> → <strong class="text-emerald-400 font-bold">2</strong> since last session!</span>
      </div>
    </div>

    <!-- QUICK STATS ROW -->
    <div class="grid grid-cols-3 gap-2">
      <div class="bg-card p-3 rounded-xl border border-gray-800 text-center">
        <span class="text-xs text-gray-400 block uppercase font-display tracking-wider">Logged ABs</span>
        <span class="text-xl font-bold font-display text-white">4</span>
      </div>
      <div class="bg-card p-3 rounded-xl border border-gray-800 text-center">
        <span class="text-xs text-gray-400 block uppercase font-display tracking-wider">Team Avg</span>
        <span class="text-xl font-bold font-display text-clay">2.2</span>
      </div>
      <div class="bg-card p-3 rounded-xl border border-gray-800 text-center">
        <span class="text-xs text-gray-400 block uppercase font-display tracking-wider">Status</span>
        <span class="text-xs font-bold font-display text-emerald-400 block mt-1">PATTERN READY</span>
      </div>
    </div>

    <!-- CHECKPOINT LIST TITLE -->
    <div class="flex justify-between items-center pt-2">
      <h2 class="font-display text-lg uppercase tracking-wider text-gray-200">Swing Checklist</h2>
      <span class="text-xs text-gray-400">11 Checkpoints</span>
    </div>

    <!-- CARD 1: UNCONFIRMED AI DRAFT STATE -->
    <div class="bg-card rounded-xl border border-amber-500/40 p-4 space-y-3 shadow-lg relative overflow-hidden">
      <div class="absolute top-0 right-0 bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-bl uppercase tracking-wider border-b border-l border-amber-500/30">
        🤖 AI Draft — Unconfirmed
      </div>

      <div class="flex justify-between items-start pr-12">
        <div>
          <span class="text-xs text-clay font-bold tracking-widest font-display">CHECKPOINT 03</span>
          <h3 class="font-bold text-base text-white">Hip-Shoulder Separation</h3>
        </div>
      </div>

      <!-- Score Stepper -->
      <div class="flex items-center justify-between bg-black/30 p-1.5 rounded-lg border border-gray-800">
        <span class="text-xs text-gray-400 font-medium px-2">Score:</span>
        <div class="flex space-x-2">
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-gray-400 bg-gray-800/60 active:bg-clay active:text-white transition-colors">1</button>
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-amber-400 bg-amber-500/20 border border-amber-500/50 shadow-sm">2</button>
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-gray-400 bg-gray-800/60 active:bg-clay active:text-white transition-colors">3</button>
        </div>
      </div>

      <p class="text-xs text-gray-300 leading-relaxed">
        Hips opening slightly ahead of torso on middle-in pitches. Cites <span class="text-clay font-semibold">AB#2</span> and <span class="text-clay font-semibold">AB#4</span>.
      </p>

      <div class="pt-2 border-t border-gray-800/80 flex justify-between items-center">
        <button class="text-xs text-clay font-semibold flex items-center space-x-1">
          <span>📐 View 3D Pose Skeleton</span>
        </button>
        <button class="text-xs bg-clay hover:bg-clay/90 text-white font-medium px-3 py-1.5 rounded-lg touch-target">
          Confirm Score
        </button>
      </div>
    </div>

    <!-- CARD 2: COACH-CONFIRMED STATE -->
    <div class="bg-card rounded-xl border border-gray-800 p-4 space-y-3 shadow-lg">
      <div class="flex justify-between items-start">
        <div>
          <span class="text-xs text-clay font-bold tracking-widest font-display">CHECKPOINT 07</span>
          <h3 class="font-bold text-base text-white">Extension & Contact Plane</h3>
        </div>
        <span class="bg-emerald-950 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border border-emerald-800">
          ✓ Verified
        </span>
      </div>

      <!-- Score Stepper -->
      <div class="flex items-center justify-between bg-black/30 p-1.5 rounded-lg border border-gray-800">
        <span class="text-xs text-gray-400 font-medium px-2">Score:</span>
        <div class="flex space-x-2">
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-gray-400 bg-gray-800/60">1</button>
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-gray-400 bg-gray-800/60">2</button>
          <button class="touch-target w-10 h-10 rounded-md font-display font-bold text-white bg-clay shadow-md">3</button>
        </div>
      </div>

      <p class="text-xs text-gray-300 leading-relaxed">
        Full arm extension through contact zone on high pitches. High-confidence pose metric (115° lead elbow angle).
      </p>

      <div class="pt-2 border-t border-gray-800 flex justify-between items-center text-xs text-gray-400">
        <span>Reviewed by <strong class="text-gray-200">Coach Jon</strong></span>
        <span>History: 2 → 3</span>
      </div>
    </div>

  </main>

  <!-- STICKY BOTTOM NAV BAR -->
  <nav class="fixed bottom-0 left-0 right-0 bg-[#121418] border-t border-gray-800 px-6 py-2 z-40 flex justify-around items-center">
    <button class="flex flex-col items-center space-y-1 text-gray-400 hover:text-white touch-target justify-center">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
      <span class="text-[10px] font-display uppercase tracking-wider">Roster</span>
    </button>
    
    <button class="flex flex-col items-center space-y-1 text-clay font-bold touch-target justify-center">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
      <span class="text-[10px] font-display uppercase tracking-wider">Report</span>
    </button>

    <button class="flex flex-col items-center space-y-1 text-gray-400 hover:text-white touch-target justify-center">
      <div class="w-7 h-7 rounded-full bg-clay text-white flex items-center justify-center font-bold text-lg shadow-lg -mt-3 border-2 border-[#121418]">
        +
      </div>
      <span class="text-[10px] font-display uppercase tracking-wider">Log AB</span>
    </button>
  </nav>

</body>
</html>
Step 5: Web Implementation & Integration ModulesStep 5.1: Touch-Friendly Steppers & Supabase PersistenceTo enable single-tap updates from the mobile UI, checkpoint steppers bind directly to Supabase RPCs or table updates.JavaScript// coach/components/scoreStepper.js
import { supabase } from '../lib/supabaseClient.js';

export async function updateCheckpointScore({ teamId, playerId, checkpointId, newScore, coachName }) {
  const { data, error } = await supabase
    .from('checklists')
    .update({
      score: newScore,
      reviewed_by: coachName,
      updated_at: new Date().toISOString()
    })
    .match({ team_id: teamId, player_id: playerId, checkpoint_id: checkpointId });

  if (error) {
    console.error('Failed to update score:', error);
    return false;
  }
  return true;
}
Step 5.2: 9-Zone Pitch Log ComponentA lightweight JavaScript ES module providing a touchable $3 \times 3$ grid for quick pitch location capture.JavaScript// coach/components/pitchZonePicker.js
export function renderZonePicker(containerEl, onSelect) {
  const zones = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  containerEl.innerHTML = `
    <div class="grid grid-cols-3 gap-1.5 w-48 h-48 mx-auto bg-black/40 p-2 rounded-xl border border-gray-800">
      ${zones.map(z => `
        <button data-zone="${z}" class="zone-btn touch-target bg-card border border-gray-700/60 rounded-lg flex items-center justify-center text-sm font-bold font-display text-gray-300 active:bg-clay active:text-white">
          ${z}
        </button>
      `).join('')}
    </div>
  `;

  containerEl.querySelectorAll('.zone-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const zone = e.target.dataset.zone;
      containerEl.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('bg-clay', 'text-white'));
      btn.classList.add('bg-clay', 'text-white');
      onSelect(zone);
    });
  });
}
Step 5.3: PWA / Offline Shell ConfigurationEnables home screen installation and basic offline shell caching for field use.Manifest File (public/manifest.json)JSON{
  "short_name": "Scouting",
  "name": "Softball & Baseball Swing Scouting",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "type": "image/png",
      "sizes": "192x192"
    },
    {
      "src": "/icons/icon-512.png",
      "type": "image/png",
      "sizes": "512x512"
    }
  ],
  "start_url": "/coach/index.html",
  "background_color": "#121418",
  "theme_color": "#C2593F",
  "display": "standalone",
  "orientation": "portrait"
}
Service Worker (public/sw.js)JavaScriptconst CACHE_NAME = 'scouting-v1';
const ASSETS = [
  '/coach/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then((res) => res || fetch(evt.request))
  );
});
