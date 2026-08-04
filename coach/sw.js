// PWA offline shell for the coach app (ux.md Step 5.3). Caches the app shell
// only - Supabase API calls and GCS-hosted video are never cached here, so
// "offline" means the shell loads instantly and shows cached data, not that
// live coach edits work with no connection.
//
// EVERY time coach.css changes, bump BOTH the "?v=N" query string below AND
// in the <link> tag of every coach/*.html page, AND bump CACHE_NAME. Missing
// either one means the fetch handler's caches.match() keeps matching the
// SAME request URL, silently serving the OLD cached content forever - a real
// CSS fix (2026-08-01, bottom-nav alignment) looked like it hadn't landed at
// all for exactly this reason, on an already-installed app, even after a
// full rebuild+reinstall. Confirmed the fix was correct all along; only the
// cache-bust was missing.
const CACHE_NAME = "barreliq-coach-0c05e077dd";
// Separate, unversioned cache for cross-origin CDN libs (currently just
// Three.js, see skeletonScene.js) - kept apart from CACHE_NAME so a normal
// app-shell version bump doesn't force re-downloading a large lib that
// hasn't changed, and so the activate handler below never wipes it.
const CDN_CACHE = "barreliq-coach-cdn-v1";
const ASSETS = [
  "./index.html",
  "./team.html",
  "./player.html",
  "./coach.css?v=0c05e077dd",
  "./shared.js",
  "./config.js",
  "./manifest.json",
  "./components/appShell.js",
  "./components/stepper.js",
  "./components/compModal.js",
  "./components/skeletonComparison.js",
  "./components/skeletonScene.js",
  "./components/fkCorrection.js",
  "./components/h36mSkeleton.js",
  "./components/videoUpload.js",
  "./components/pitchZonePicker.js",
  "./components/swingMetricsPanel.js",
  "./assets/models/batter.fbx",
];

self.addEventListener("install", (evt) => {
  // skipWaiting() so a new deploy takes over on the coach's very next reload
  // instead of staying "waiting" until every open tab/PWA window is closed -
  // the CACHE_NAME bump above was silently ignored all session because the
  // old worker kept controlling already-open clients (see
  // [[polling_microrefresh_fix]] - this is what made the targeted-refresh
  // fix look like it hadn't landed).
  //
  // Deliberately does NOT include the esm.sh CDN URLs skeletonScene.js
  // imports (Three.js) - cache.addAll() is all-or-nothing, and failing the
  // ENTIRE offline app-shell install because a CDN happened to be briefly
  // unreachable would be a worse outcome than just not having that one lib
  // pre-cached yet. See the fetch handler below for how those get cached
  // instead (opportunistically, on first successful real fetch).
  self.skipWaiting();
  evt.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evt) => {
  const url = new URL(evt.request.url);
  if (url.hostname === "esm.sh") {
    // The actual CDN this app loads from (Three.js, supabase-js) - cache-first,
    // falling back to network and opportunistically caching a successful
    // response for next time. Not precached at install time, see the comment
    // above.
    evt.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(evt.request);
        if (cached) return cached;
        const res = await fetch(evt.request);
        if (res.ok) cache.put(evt.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) {
    // Any other cross-origin request - the live Supabase REST/Auth API and
    // GCS-hosted video both land here. Must never be cache-first: caching a
    // Supabase GET by URL means a repeated identical query (e.g. reloading a
    // roster right after inserting a row - the exact same request URL as the
    // pre-insert load) would silently serve stale data forever instead of
    // hitting the network. Confirmed real: this exact bug made a newly-added
    // player invisible in the roster until a hard refresh.
    evt.respondWith(fetch(evt.request));
    return;
  }
  evt.respondWith(caches.match(evt.request).then((res) => res || fetch(evt.request)));
});
