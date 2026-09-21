// Brand-consistency guard. HitterLoop is the only active product name. The previous names may appear only
// in explicitly listed historical documents and as the two persisted format identifiers below.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const OLD_BRAND = /barrel[ _-]?(trace|iq)|com\.barrel/i;
const TEXT_EXT = /\.(js|mjs|ts|py|json|html|css|svg|md|xml|gradle|java|toml|sql|yml|yaml|txt|properties)$/i;

// Dated records and change history written under a previous name. They describe what was true at the time.
const HISTORICAL = new Set([
  "CHANGELOG.md",
  "docs/PHASE_2B_IMPLEMENTATION_SPEC.md",
  "docs/UX_REDESIGN_SPEC.md",
  "docs/UX_PHASE_1A_VERIFICATION.md",
  "docs/PIPELINE_AUDIT.md",
  ".claude/settings.json", // local tool-approval noise, never part of a feature change
  "scripts/brand-consistency.test.mjs",
]);

// Persisted format identifiers: stored reconstructions are validated against these on load, so they are
// intentionally not renamed. Only these exact tokens are tolerated, and only in these files.
const PERSISTED_TOKENS = ["barreltrace-reconstruction-v1", "barreltrace-x-right-y-up-z-pitcher"];
const PERSISTED_FILES = new Set([
  "src/services/reconstruction/types.ts",
  "scripts/pose3d/validation_artifacts.py",
  "scripts/process-validation-batch.ts",
]);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((f) => f && TEXT_EXT.test(f) && fs.existsSync(path.join(root, f)));

test("no active file names the old product or Android ID", () => {
  const offenders = [];
  for (const rel of tracked) {
    if (HISTORICAL.has(rel)) continue;
    let text = read(rel);
    if (rel === "readme.md") text = text.split("### Upgrading from BarrelIQ")[0]; // upgrade notes are history
    if (PERSISTED_FILES.has(rel)) for (const t of PERSISTED_TOKENS) text = text.split(t).join("");
    if (OLD_BRAND.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("Android identity is com.hitterloop.coach / HitterLoop", () => {
  assert.match(read("mobile/capacitor.config.json"), /"appId": "com\.hitterloop\.coach"/);
  assert.match(read("mobile/capacitor.config.json"), /"appName": "HitterLoop"/);
  const gradle = read("mobile/android/app/build.gradle");
  assert.match(gradle, /namespace "com\.hitterloop\.coach"/);
  assert.match(gradle, /applicationId "com\.hitterloop\.coach"/);
  const strings = read("mobile/android/app/src/main/res/values/strings.xml");
  assert.match(strings, /name="app_name">HitterLoop</);
  assert.match(strings, /name="title_activity_main">HitterLoop</);
  const activity = "mobile/android/app/src/main/java/com/hitterloop/coach/MainActivity.java";
  assert.match(read(activity), /^package com\.hitterloop\.coach;/m);
  assert.equal(fs.existsSync(path.join(root, "mobile/android/app/src/main/java/com/barreltrace")), false);
});

test("versions stay in sync across npm packages and Android", () => {
  const v = JSON.parse(read("package.json")).version;
  assert.equal(JSON.parse(read("mobile/package.json")).version, v);
  assert.match(read("mobile/android/app/build.gradle"), new RegExp(`versionName "${v.replace(/\./g, "\\.")}"`));
});

test("web/PWA identity reads HitterLoop", () => {
  const manifest = JSON.parse(read("coach/manifest.json"));
  assert.equal(manifest.short_name, "HitterLoop");
  assert.match(manifest.name, /^HitterLoop/);
  assert.match(read("coach/index.html"), /<title>HitterLoop — Coach Login<\/title>/);
  const report = read("coach/report.html");
  assert.match(report, /<title>HitterLoop — Player Report<\/title>/);
  assert.match(report, /bt-report-brand">HitterLoop</);
  assert.match(report, /Shared by your coach with HitterLoop/);
  const sw = read("coach/sw.js");
  assert.match(sw, /const CACHE_NAME = "hitterloop-coach-[0-9a-f]{10}"/);
  assert.match(sw, /const CDN_CACHE = "hitterloop-coach-cdn-v1"/);
});
