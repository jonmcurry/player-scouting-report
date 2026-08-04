#!/usr/bin/env node
/**
 * Computes a real content hash over every file coach/sw.js precaches and
 * writes it into BOTH coach/sw.js's CACHE_NAME and coach.css's `?v=` query
 * string (in sw.js's own ASSETS list AND every coach/*.html <link> tag) -
 * replaces the fully-manual "remember to bump both, in lockstep, every
 * single time coach.css or a precached JS file changes" process that used
 * to be sw.js's own top comment. That process caused a real incident: a
 * real CSS fix looked like it hadn't landed on an already-installed app,
 * even after a full rebuild+reinstall, purely because the cache-bust was
 * missed. A missed bump is now structurally impossible - the version IS
 * the content, not a number someone has to remember to type.
 *
 * The real asset list is read straight out of sw.js's own ASSETS array
 * (not duplicated here), so this script never drifts from what's actually
 * being precached.
 *
 * Usage: node scripts/bump-coach-cache.mjs
 * Wired into .git/hooks/pre-commit to run automatically on any commit that
 * touches coach/ - see that file. Idempotent and safe to run manually too:
 * if nothing cached actually changed, no files get rewritten.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const coachDir = path.join(repoRoot, "coach");
const swPath = path.join(coachDir, "sw.js");

const sw = readFileSync(swPath, "utf-8");

const assetsMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) {
  console.error("bump-coach-cache: couldn't find ASSETS array in coach/sw.js");
  process.exit(1);
}
const assetPaths = [...assetsMatch[1].matchAll(/"\.\/([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
if (assetPaths.length === 0) {
  console.error("bump-coach-cache: parsed an empty ASSETS list - regex likely out of sync with sw.js's real format");
  process.exit(1);
}

// index.html/team.html/player.html are themselves in ASSETS (hashed below)
// AND are the exact files this script rewrites (their own coach.css?v=...
// stamp) - hashing them as-is would feed the previous run's OUTPUT back into
// this run's INPUT, a real self-referential loop that never converges
// (caught by actually re-running this script twice and comparing digests,
// not assumed stable). Normalizing the stamp to a fixed placeholder before
// hashing breaks the loop: real content changes to these files still change
// the digest, but the version stamp itself no longer feeds back into it.
const SELF_REFERENTIAL_FILES = new Set(["index.html", "team.html", "player.html", "report.html"]);
const STAMP_PLACEHOLDER = "coach.css?v=PLACEHOLDER";

const hash = createHash("sha256");
for (const rel of assetPaths) {
  const full = path.join(coachDir, rel);
  if (!existsSync(full)) {
    console.error(`bump-coach-cache: "${rel}" is listed in ASSETS but missing on disk`);
    process.exit(1);
  }
  hash.update(rel); // path itself, so renaming a file also changes the hash
  let content = readFileSync(full);
  if (SELF_REFERENTIAL_FILES.has(rel)) {
    content = Buffer.from(content.toString("utf-8").replace(/coach\.css\?v=[^"]*/, STAMP_PLACEHOLDER));
  }
  hash.update(content);
}
const digest = hash.digest("hex").slice(0, 10);
const newCacheName = `barreliq-coach-${digest}`;

let changed = false;

let newSw = sw.replace(/const CACHE_NAME = "[^"]*";/, (m) => {
  if (m === `const CACHE_NAME = "${newCacheName}";`) return m;
  changed = true;
  return `const CACHE_NAME = "${newCacheName}";`;
});
newSw = newSw.replace(/"\.\/coach\.css(?:\?v=[^"]*)?"/, (m) => {
  const want = `"./coach.css?v=${digest}"`;
  if (m === want) return m;
  changed = true;
  return want;
});
if (newSw !== sw) writeFileSync(swPath, newSw);

for (const file of ["index.html", "team.html", "player.html", "report.html"]) {
  const p = path.join(coachDir, file);
  const html = readFileSync(p, "utf-8");
  const updated = html.replace(/coach\.css\?v=[^"]*/, `coach.css?v=${digest}`);
  if (updated !== html) {
    writeFileSync(p, updated);
    changed = true;
  }
}

console.log(changed
  ? `bump-coach-cache: updated to ${digest} (${assetPaths.length} files hashed)`
  : `bump-coach-cache: already up to date (${digest})`);
