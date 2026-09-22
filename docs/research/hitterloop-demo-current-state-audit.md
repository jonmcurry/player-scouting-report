# HitterLoop Public Demo — Current-State Audit

> **2026-09-22 cloud-configuration pass 3 (CLOUD DEMO BACKEND READY):**
> the user completed both previously-blocking Dashboard settings on the
> real "hitterloop" cloud project (`rjnpaqsqslvzkwwwqmze`) — Data API
> schema exposure and Anonymous Sign-Ins. Both were re-verified LIVE
> before trusting the report (not assumed): a bare-`anon` schema query now
> returns `42501` (exposed, correctly access-controlled) rather than the
> old `PGRST106` (not exposed); a signed-in anonymous session succeeds
> against `demo.teams`/`demo.start_demo_session()`; anonymous signup
> returns a real session instead of `anonymous_provider_disabled`. The
> full `supabase/demo/demo.test.ts` suite (25 tests) then ran against the
> real cloud project end-to-end and **passed 25/25** — cross-session
> isolation, production-table isolation, reset, 3-way concurrent reset,
> the full Jordan/Maya/Riley narrative, and `get-demo-player-report` all
> confirmed live (one test's pass is caveated — see
> `demo-shared-project-architecture.md`'s "CLOUD DEPLOYMENT STATUS"
> section for the honest detail on why). All synthetic test residue (28
> anonymous auth users + their cloned teams) was identified and fully
> cleaned up afterward — verified 0 remaining. The rest of this document
> (below) still describes the **local** app-side state from the prior
> Phase 4 session, which remains accurate; joncurry.co wiring remains out
> of scope (separate repo, separate task).

Read-only audit, performed by direct inspection of the current repo (HEAD
`121daee`, demo work landed in `6e387bc` and has not been touched by any
commit since) and the personal-site repo at `/Users/jon/dev/personal`
(present and accessible in this session). No implementation files were
changed. One reversible local-only step was taken to get real evidence
rather than rely on prior claims: `supabase/config.toml`'s
`enable_anonymous_sign_ins` was temporarily flipped to `true`, the demo SQL
applied to the local stack, `supabase/demo/demo.test.ts` run for real
(8/8 pass), then everything reverted and the DB reset — confirmed via
`git status`/`git diff` showing zero residual changes.

A prior audit artifact already existed at this exact file path (timestamp
predating this session, written against an earlier HEAD) reaching
materially the same conclusions but unable to re-run the live integration
suite (blocked by its own session's permissions). This document supersedes
it with fresh, independently re-verified evidence from this session,
including a successful live test run.

> **2026-09-22 update:** the "dedicated demo Supabase project" architecture
> row below is now superseded by an implemented, locally-verified
> **temporary same-project + isolated `demo` Postgres schema** design — see
> [`demo-shared-project-architecture.md`](demo-shared-project-architecture.md)
> for the full writeup, `supabase/migrations/00031_demo_shared_project_schema.sql`
> + `00032_demo_seed_v1.sql` for the implementation, and
> `supabase/demo/demo.test.ts` for the 12/12 passing integration suite
> (cross-session isolation + new cross-boundary/production-isolation
> tests). This closes the "no real demo backend exists at all" gap for
> local/shared-project purposes, but does **not** change the overall B
> verdict below — Phase 4 seed content, the at-bat upload/camera
> suppression gap, and all joncurry.co-side wiring are still outstanding.
> Rows/items below are annotated inline where this update changes their
> status; nothing else in this document was re-verified on 2026-09-22.

## Verdict

**Superseded 2026-09-22 (Phase 4 session) — see the "Final response" at
the bottom of this document for the current classification.** Originally
(when this document was first written): B — code complete for Phases 1–3
of the demo's own plan (backend isolation + centralized runtime-mode
plumbing), but that plan never covered the public-facing experience. As of
the Phase 4 session, the app-side demo (schema, seed narrative, all 8
traced pages, upload/camera suppression) is complete and locally verified;
what remains is exclusively cloud deployment and joncurry.co wiring, not
application code.

## Completion matrix

| Area | Status | Evidence |
|---|---|---|
| Dedicated cloud demo Supabase project | **MISSING (unchanged)** | Still no separate project — same evidence as before (`npx supabase projects list` → auth error, no cloud account). This remains the eventual target; see "future migration" below. |
| Same-project isolated `demo` schema (2026-09-22 interim architecture) | **COMPLETE — implemented and verified live this update** | `demo` schema, `demo.teams`/`demo.players`/`demo.demo_sessions`/`demo.demo_seed_templates`, RLS on all four, `demo.start_demo_session()`/`demo.reset_demo_session()` — all live-verified: RLS enabled on every table (`pg_tables.rowsecurity`), zero cross-schema FKs into `public.*` (`information_schema` query), `search_path=""` pinned on all 4 SECURITY DEFINER functions (`pg_proc.proconfig`), schema `USAGE` granted to `authenticated` only, not `anon` (`has_schema_privilege`). 12/12 `demo.test.ts` tests pass, including new tests proving a demo anonymous JWT cannot read/mutate `public.teams`/`public.players` or successfully call `get-upload-url` for a real `game_log_entries` row. See `demo-shared-project-architecture.md`. |
| Demo SQL/schema | **COMPLETE** | `supabase/demo/001_demo_lifecycle.sql` + `002_demo_seed_template.sql` exist, applied cleanly against the current schema this session (after 2 methodology migrations landed since the demo work), and add zero changes to any existing table's RLS. |
| Anonymous demo auth | **COMPLETE** | `start_demo_session()` requires real `auth.uid()`, never a caller-supplied id. `shared.js`'s `bootstrapDemoSession()` calls `signInAnonymously()` then `rpc("start_demo_session")`, reachable only via `requireSession()` — never on `report.html`. |
| Per-visitor cloning | **COMPLETE** | `clone_demo_dataset()` generates a fresh `teams.id`/slug per call; `demo_sessions.team_id` is unique. Live-tested this session: two anonymous sessions received two different team ids. |
| Session isolation | **COMPLETE — re-verified live this session** | `demo.test.ts`'s cross-session test (real Postgres, not mocked) passed: session B reads zero rows for A's team/players and a mutation attempt on A's team has no effect. |
| Transactional reset | **COMPLETE — re-verified live** | `reset_demo_session()` clones → repoints `demo_sessions` → deletes the old team, in that order. `demo_sessions.team_id` carries no `ON DELETE CASCADE` (the specific regression this ordering exists to prevent). Live test: reset produces a fresh team id, the old team id no longer exists, and a second visitor's team is untouched by the first's reset. |
| Concurrent reset safety | **COMPLETE — re-verified live** | `pg_advisory_xact_lock(hashtext(auth.uid()::text))` serializes concurrent calls per visitor in both `start_demo_session()`/`reset_demo_session()`. Live test fired 3 concurrent resets for one session: passed, exactly one clean 3-player dataset remained afterward. |
| Fictional seed data | **COMPLETE (2026-09-22 Phase 4 update)** | `demo.clone_demo_dataset()` now seeds the full canonical narrative (games, at-bats, pitches, video-clip rows, findings, priorities, drills, practice sessions/reps, observations, checklist scores/history, a share link) for all three players, not just team+roster. See `demo-shared-project-architecture.md`'s "Phase 4 update" section. |
| Review flow | **COMPLETE** | Maya Torres has one seeded `review_status='draft'` finding tied to her 4th pitch — live-verified via `demo.test.ts` ("Review page data exists") and a direct `review.html`-shaped PostgREST query against the local stack. |
| Development flow | **COMPLETE** | Jordan (resolved) and Riley (one resolved, one monitoring) priorities seeded with drills, coach notes, and follow-up fields — live-verified. |
| Practice flow | **COMPLETE** | Jordan: one practice session with a baseline + post-drill repetition. Riley: two practice sessions on different dates. Both with assigned drills and outcome notes — live-verified. |
| At-bat flow | **COMPLETE** | Maya has one pre-seeded 4-pitch at-bat with a coherent 0-0→0-1→1-1→1-2 count progression and one video clip per pitch — live-verified against the exact `atbat.html`/`review.html` embedded-join query shapes via direct PostgREST calls, not just table existence. |
| Compare flow | **COMPLETE** | Jordan's practice session has a `grouping='baseline'` and a `grouping='post_drill'` repetition, each with a `status='ready'` video clip — the exact shape `comparePairs.js`'s `suggestedComparePairs()` looks for. Live-verified. |
| Demo reports | **COMPLETE** | New `get-demo-player-report` Edge Function (schema-qualified to `demo`, reuses `get-player-report`'s own `shape.ts`) + `report.html` now branches on `isDemoMode()` to call it. Live-verified end-to-end this session: a real HTTP call against the local Edge Runtime with Jordan's seeded share token returned his full resolved-priority/drill/progress report. `get-video-url`/in-report video serving intentionally still return "unavailable" (no real footage exists) — the existing, unmodified UI already renders that gracefully. |
| Demo banner | **COMPLETE** | `shared.js` injects it unconditionally whenever `isDemoMode()` is true, at module load, reaching every page that imports `shared.js` including `report.html`. Text matches the brief; Reset button calls `rpc("reset_demo_session")`; return link defaults to `https://joncurry.co/projects/hitterloop`. |
| Upload UI suppression | **COMPLETE (2026-09-22 — gap closed)** | `atbat.html`'s `chooseVideo()` (the single chokepoint for Record-pitch/camera-icon/"Add another video") now checks `getDemoConfig().capabilities.uploads` before ever creating or clicking the OS picker, and those controls carry `.upload-control` so the existing CSS-hiding rule covers them too. The same gap, found by a repo-wide grep, existed in `practicePage.js`'s `attachVideo()`/`addRepsWithVideo()` and was fixed identically. `player.html`'s controls remain correctly covered as before. Static tests added in `demoBanner.test.mjs`. |
| Camera UI suppression | **COMPLETE — same fix** | The camera icon on `atbat.html` routes through the same now-gated `chooseVideo()`. No other camera-only entry point exists anywhere in `coach/` (confirmed via a repo-wide grep for `type = "file"`/`.capture`/`accept="video`/`getUserMedia`). |
| Live-analysis suppression | **COMPLETE (functionally), by absence of any trigger** | No client-side "run analysis" button exists anywhere in `coach/` — analysis is queue-driven by a backend worker outside `coach/`, reacting to `video_clips` rows. Since uploads are functionally blocked and the demo README instructs never pointing a worker/`GEMINI_API_KEY` at the demo project, no clip can reach analysis. `capabilities.liveAnalysis` is plumbed through `demoConfig.js`, defaults to `false`, but nothing in `coach/` currently reads it (reserved flag, not load-bearing — there's nothing for it to gate yet). |
| Centralized runtime config | **COMPLETE** | `coach/demoConfig.js` is the single source of `isDemoMode()`/`getDemoConfig()`. Every call site (`config.js`, `shared.js`, `videoUpload.js`) branches through it; zero `window.location.pathname` checks exist anywhere in `coach/` (grep-confirmed). Defaults to `mode: "normal"` when the global is unset — test-covered. |
| Service-worker scope | **CANNOT VERIFY** | `sw.js` registers via `navigator.serviceWorker.register("./sw.js")` with no explicit `scope` — correct in principle for a relative subpath deploy, but since no publishing step exists (see below), the actual `/hitterloop/demo/` URL structure has never been exercised. A "verify at deploy time" item, not a known defect. |
| Android/Capacitor isolation | **COMPLETE** | `grep -rn "demo" mobile/` (case-sensitive, for the config global specifically) returns zero matches. `mobile/capacitor.config.json` unchanged since before the demo work (confirmed via `git log` — last touched at the BarrelTrace→HitterLoop rename, commit `40ff670`). `demoConfig.js` is a no-op wherever `window.__HITTERLOOP_DEMO_CONFIG__` is unset, which is always true for the native shell. Android/PWA identity tests pass. |
| Security / credential isolation | **COMPLETE (nothing live to leak yet)** | No service-role key anywhere under `coach/`/`mobile/` (grep clean — the one match in `config.js` is a comment, not a value). `PROD_SUPABASE_URL`/`KEY` blank. `demoConfig.js` has a dedicated test asserting it never hardcodes a production/local-dev URL; `demo.local.example.js` has one asserting `uploads`/`liveAnalysis` default `false`. Since no real demo project exists (see above), there is no live credential to have leaked yet — this row needs re-auditing the moment a real project/anon key is wired in. |
| joncurry.co demo route | **MISSING** | Searched `/Users/jon/dev/personal` directly this session: zero references to `hitterloop/demo` or `hitterloop-demo` anywhere (`.ts`/`.tsx`/`.js`/`.json`/`.jsonc`/`.mdx`), and no file/directory named `*hitterloop*` besides the existing `/projects/hitterloop` marketing page. `next.config.ts`'s CSP has no `esm.sh` in `script-src` (the coach app's only source for `supabase-js`/Three.js) and no Supabase host in `connect-src` — the app would be blocked by the site's own CSP even if the files were simply dropped in. No rewrite, no static-asset copy step, no build script referencing this path. |
| noindex/noarchive | **MISSING / moot until the route exists** | `app/robots.ts` currently disallows only `/app`, `/dashboard`, `/api/` — no `/hitterloop/demo` rule, because the path doesn't exist yet. |
| Tests | **COMPLETE, re-run live 2026-09-22** | `npm run build`: clean. Full `npm test`: **90/90** in the `.mjs` component suite (including 2 new upload-suppression tests) + **64/64 (+1 pre-existing unrelated skip)** in the `dist/**/*.test.js` suite. `supabase/demo/demo.test.ts`: **25/25 pass** (11 original + 14 new Phase 4 tests: seed content, Jordan/Maya/Riley stories, review/development/practice/compare/report data existence, cross-clone isolation, expanded-dataset reset, 3-way concurrent reset), executed live against the local stack. |

## Exact remaining work

Ordered by what actually blocks a usable public demo, not file count:

**As of 2026-09-22 (Phase 4 complete): all app-side work is done and
locally verified.** What remains is entirely deployment/provisioning, not
application code:

1. **Deploy `supabase/migrations/00031` through `00034` to the real,
   shared HitterLoop Supabase project**, then expose the `demo` schema in
   that project's Dashboard → API → Exposed schemas (or `supabase config
   push`) and enable Anonymous Sign-Ins project-wide — both one-time,
   non-migration steps documented in `supabase/demo/README.md`.
2. **Deploy the `get-demo-player-report` Edge Function** (new this pass;
   `get-player-report`/`get-upload-url`/`get-video-url` already need
   deploying for the normal app regardless of the demo).
3. **Build the joncurry.co publishing pipeline**: a `/hitterloop/demo`
   route or static-asset copy step serving `coach/` under that subpath, a
   build-time injection of `window.__HITTERLOOP_DEMO_CONFIG__` with the
   real demo project's URL/anon key, and the CSP changes this needs
   (`script-src` needs `esm.sh`; `connect-src` needs the demo project's
   Supabase host) — without which no API call the app makes would work
   even after the files exist at that path.
4. **Add a noindex/noarchive rule** for the demo path once it exists
   (`app/robots.ts` and/or page-level `metadata.robots`).

All of items 1-4 require Supabase dashboard access and the personal-site
repo, neither available in this session — see "User actions required"
below. Nothing remaining is an app-code gap.

## Blockers to public deployment

- No real demo backend is *deployed* yet — the SQL/RLS/RPC implementation, the full Phase 4 narrative, and the demo report function are all complete and locally verified (25/25 `demo.test.ts` tests, 2026-09-22), but none of it has been pushed to the real shared HitterLoop Supabase project yet (see item 1-2 above). Everything else is downstream of that deploy step, not of writing the code.
- No fictional narrative content beyond team/player names — every product-loop page (Review, Development, Practice, Compare, Report) would render empty.
- No Edge Function deployment story for the demo project.
- ~~`atbat.html`'s upload/camera controls are not suppressed~~ **fixed 2026-09-22** — see the Phase 4 update above.
- Zero wiring on the joncurry.co side — no route, no publish step, and the current CSP would block the app's own CDN (`esm.sh`) and Supabase calls even if the files were dropped in as static assets.
- No noindex rule for the eventual path.
- No real demo backend is deployed to the shared HitterLoop Supabase project yet (app-side code is complete; deployment is a Supabase-dashboard-access-gated step).

## User actions required

- **Cloud demo backend: fully done.** Migrations 00001-00034 applied and
  structurally verified, `get-demo-player-report` deployed, both Dashboard
  settings (Data API schema exposure, Anonymous Sign-Ins) completed by the
  user and live-verified, full 25/25 cloud integration/security suite
  passing, all synthetic test residue cleaned up. No further action needed
  on the Supabase side for the demo backend itself.
- **Building the joncurry.co publish pipeline** requires the personal-site
  repo and its own deploy process (out of scope for this repo's session
  per the task boundary — "Do NOT modify the personal website repo").

---

## Final response (2026-09-22, Phase 4 update)

1. **Overall classification:** **A for the app-side demo** (all 8 real HitterLoop flows render meaningful fictional data, isolation is intact, upload/camera UI is suppressed, tests are green) — **B overall** for "ready to publish," since cloud deployment and joncurry.co wiring are still outstanding and gated on access this session doesn't have.
2. **Is the demo app code itself complete?** YES — schema, RLS, seed narrative (Jordan/Maya/Riley), all 8 traced pages' data dependencies, at-bat upload/camera suppression, and the demo report function are all implemented and locally verified.
3. **Is a real dedicated cloud demo backend live?** NO — the schema-isolated same-project design is implemented and verified locally but not yet deployed to the real shared HitterLoop Supabase project (needs dashboard access).
4. **Is joncurry.co/hitterloop/demo currently ready to deploy?** NO — zero wiring exists on the personal-site side (out of scope for this session; different repo).
5. **Is at-bat upload/camera UI fully suppressed in demo mode?** YES — fixed this pass; `chooseVideo()` and `practicePage.js`'s equivalent chokepoints now check `capabilities.uploads` before ever opening the OS picker, and the trigger controls are CSS-hidden via the existing `.upload-control` mechanism. Static tests added.
6. **Number of remaining implementation issues:** 0.
7. **Number of deployment/provisioning issues:** 3 (deploy the demo schema/seed migrations + expose the schema + enable anonymous sign-ins on the real project; deploy the new `get-demo-player-report` Edge Function; build the joncurry.co route/CSP/publish pipeline).
8. **Exact blockers:** listed in full above — all are deployment/provisioning, none are application code.
9. **Test results:** `npm run build` clean; `npm test` 64/64 (+1 pre-existing unrelated skip) + 90/90; `supabase/demo/demo.test.ts` **25/25**, run live against the local stack this session (cross-session isolation, cross-boundary production isolation, and 14 new Phase 4 tests covering seed content, Jordan/Maya/Riley stories, review/development/practice/compare/report data, independent-clone isolation, expanded-dataset reset, and 3-way concurrent reset safety).
10. **Audit artifact path:** `docs/research/hitterloop-demo-current-state-audit.md` (this file) + `docs/research/demo-shared-project-architecture.md` (architecture detail).
11. **Git diff/status summary:** working tree clean except the files this task actually changed (9 new/modified app files, 4 new migrations, 1 new Edge Function directory, 2 doc updates) — `git diff --check` clean, no stray `.bak` files, local `enable_anonymous_sign_ins` toggle reverted to `false` and confirmed.
12. **Confirmation no implementation/deployment changes were made beyond this session's own local-only verification:** confirmed — nothing was deployed to any cloud project, no real anonymous sign-ins were left enabled, no production data was touched.

This document reflects the state as of the 2026-09-22 Phase 4 session. See
the final report in that session's own response for the formal
classification under the Phase 4 task's completion standard (APP DEMO
COMPLETE — READY FOR CLOUD CONFIG + WEBSITE WIRING).
