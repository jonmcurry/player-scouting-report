// PWA offline shell for the coach app (ux.md Step 5.3). Caches the app shell
// only - Supabase API calls and GCS-hosted video are never cached here, so
// "offline" means the shell loads instantly and shows cached data, not that
// live coach edits work with no connection.
const CACHE_NAME = "scouting-coach-v1";
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
];

self.addEventListener("install", (evt) => {
  evt.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("fetch", (evt) => {
  evt.respondWith(caches.match(evt.request).then((res) => res || fetch(evt.request)));
});
