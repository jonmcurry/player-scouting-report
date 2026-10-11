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
const CACHE_NAME = "hitterloop-coach-93ef0237ed";
// Separate, unversioned cache for cross-origin CDN libs (currently just
// Three.js, see skeletonScene.js) - kept apart from CACHE_NAME so a normal
// app-shell version bump doesn't force re-downloading a large lib that
// hasn't changed, and so the activate handler below never wipes it.
const CDN_CACHE = "hitterloop-coach-cdn-v1";
const ASSETS = [
  "./index.html",
  "./team.html",
  "./player.html",
  "./report.html",
  "./queue.html",
  "./development.html",
  "./review.html",
  "./compare.html",
  "./atbat.html",
  "./session.html",
  "./family.html",
  "./simple.html",
  "./analysis.html",
  "./lab.html",
  "./components/challengeProtocols.js",
  "./components/challengeModel.js",
  "./coach.css?v=93ef0237ed",
  "./simple.css",
  "./coach-analysis.css",
  "./shared.js",
  "./config.js",
  "./demoConfig.js",
  "./manifest.json",
  "./components/appShell.js",
  "./components/shellState.js",
  "./components/ui.js",
  "./components/stepper.js",
  "./components/trendChart.js",
  "./components/compModal.js",
  "./components/checkpointEvidence.js",
  "./components/skeletonComparison.js",
  "./components/skeletonScene.js",
  "./components/fkCorrection.js",
  "./components/h36mSkeleton.js",
  "./components/videoUpload.js",
  "./components/uploadPolicy.js",
  "./components/captureQueue.js",
  "./components/demoShowcase.js",
  "./components/simpleApp.js",
  "./components/coachAnalysis.js",
  "./components/coachAnalysisModel.js",
  "./components/performanceLab.js",
  "./components/performanceLabModel.js",
  "./components/clipDeletion.js",
  "./components/rosterImport.js",
  "./components/rosterImportSheet.js",
  "./components/pitchZonePicker.js",
  "./components/swingMetricsPanel.js",
  "./components/avatar-retarget-map.js",
  "./components/developmentLogic.js",
  "./components/devUi.js",
  "./components/devActions.js",
  "./components/teamDashboard.js",
  "./components/phase1bScreens.js",
  "./components/phase2aScreens.js",
  "./components/practicePage.js",
  "./components/reviewQueue.js",
  "./components/pitchEntry.js",
  "./components/comparePairs.js",
  "./components/subjectZoom.js",
  "./components/clipReviewState.js",
  "./components/familyPage.js",
  "./components/guardianAdmin.js",
  "./components/captureGuide.js",
  "./components/logAtBatSheet.js",
  "./assets/icons.svg",
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
  // Never intercept a non-GET request - caching/cache.match() makes no sense
  // for a mutation anyway, but the real bug this found: relaying a large-body
  // POST/PUT (e.g. a coach uploading a video clip straight to GCS) through
  // fetch(evt.request) forces the service worker to buffer that whole body
  // itself, and on a memory-constrained WebView that reliably OOM-crashed the
  // renderer process outright - confirmed by reproducing it directly (a 41MB
  // upload killed the app every time, even after quadrupling the emulator's
  // RAM, which ruled out "just needs more memory" and pointed at this
  // architectural issue instead). Letting the browser handle non-GET
  // requests directly (no respondWith() call at all) avoids the SW ever
  // touching the body.
  if (evt.request.method !== "GET") return;

  const url = new URL(evt.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/cdn-cgi/")) {
    // Cloudflare injects optional analytics/challenge assets under /cdn-cgi/.
    // Browser extensions can block them; never turn that into an unhandled
    // service-worker fetch rejection or let it affect the product UI.
    return;
  }
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
    //
    // Not intercepted at all (no respondWith): a fetch() made BY the worker is
    // checked against the page's connect-src, so relaying e.g. the Google
    // Fonts stylesheet or the host's Cloudflare analytics beacon through it
    // failed with net::ERR_FAILED on the live demo even though the page itself
    // may load them. Left alone, the browser loads each one natively under the
    // rules for its own type, and still never from cache.
    return;
  }
  evt.respondWith(caches.match(evt.request).then((res) => res || fetch(evt.request)));
});
