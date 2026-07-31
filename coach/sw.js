// PWA offline shell for the coach app (ux.md Step 5.3). Caches the app shell
// only - Supabase API calls and GCS-hosted video are never cached here, so
// "offline" means the shell loads instantly and shows cached data, not that
// live coach edits work with no connection.
const CACHE_NAME = "barreliq-coach-v4";
const ASSETS = [
  "./index.html",
  "./team.html",
  "./player.html",
  "./coach.css?v=6",
  "./shared.js",
  "./config.js",
  "./manifest.json",
  "./components/appShell.js",
  "./components/stepper.js",
  "./components/compModal.js",
  "./components/skeletonComparison.js",
  "./components/skeletonRenderer.js",
  "./components/fkCorrection.js",
  "./components/h36mSkeleton.js",
  "./components/videoUpload.js",
  "./components/pitchZonePicker.js",
  "./components/swingMetricsPanel.js",
];

self.addEventListener("install", (evt) => {
  // skipWaiting() so a new deploy takes over on the coach's very next reload
  // instead of staying "waiting" until every open tab/PWA window is closed -
  // the CACHE_NAME bump above was silently ignored all session because the
  // old worker kept controlling already-open clients (see
  // [[polling_microrefresh_fix]] - this is what made the targeted-refresh
  // fix look like it hadn't landed).
  self.skipWaiting();
  evt.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evt) => {
  evt.respondWith(caches.match(evt.request).then((res) => res || fetch(evt.request)));
});
