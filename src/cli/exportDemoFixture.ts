#!/usr/bin/env node
/**
 * Curated real-footage -> public-demo fixture exporter. Reads a player's
 * COMPLETED local analysis (local Supabase public.* + frames/ pipeline
 * output), applies the human curation manifest (the clip allowlist + every
 * piece of metadata that can't be derived from video), and writes a
 * versionable fixture that `npm run import-demo-fixture` loads into
 * demo.demo_real_fixtures - the canonical source every anonymous demo
 * visitor's clone is built from. Never touches demo.*, never uploads media.
 * See docs/research/demo-real-data-promotion.md.
 *
 * Usage:
 *   # 1. What does the local DB have for this player? (+ optional starter manifest)
 *   npm run export-demo-fixture -- --team <team-slug> --player <player-slug> [--init-manifest demo-curation.json]
 *
 *   # 2. Check a manifest without writing anything
 *   npm run export-demo-fixture -- --manifest demo-curation.json --dry-run
 *
 *   # 3. Validation report only (no fixture, no media)
 *   npm run export-demo-fixture -- --manifest demo-curation.json --validate-only
 *
 *   # 4. Full export (fixture + transcoded media + reports)
 *   npm run export-demo-fixture -- --manifest demo-curation.json --output demo-export
 */
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { buildFixture, type BuildResult, type ClipContext, type SourceSnapshot } from "../services/demoExport/buildFixture.js";
import { parseCurationManifest, type CurationManifest } from "../services/demoExport/curationManifest.js";
import { ffmpegAvailable, MAX_MEDIA_SECONDS, probe, readStage0Context, sha256File, transcodeClip, type TranscodeResult } from "../services/demoExport/media.js";
import { loadSourceSnapshot } from "../services/demoExport/sourceLoader.js";
import { FIXTURE_TABLE_ORDER } from "../services/demoExport/translation.js";
import { hasErrors, type Finding } from "../services/demoExport/validate.js";
import { evaluatePrivacyGate, loadPrivacyGateInput } from "../services/demoExport/privacy.js";

interface Opts {
  team?: string; player?: string; manifest?: string; output: string; framesRoot: string;
  dryRun?: boolean; validateOnly?: boolean; skipMedia?: boolean; initManifest?: string; allowRemoteSource?: boolean;
}

export function assertLocalSource(url: string | undefined, allowRemote: boolean, flag = "--allow-remote-source"): void {
  if (!url) throw new Error("SUPABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!allowRemote && !["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) {
    throw new Error(`SUPABASE_URL points at ${host}, not the local stack. This tool targets the LOCAL Supabase stack; pass ${flag} only if you really mean another project.`);
  }
}

function printFindings(findings: Finding[]): void {
  for (const f of findings.filter((x) => x.level === "error")) console.error(`  ERROR   [${f.code}] ${f.message}`);
  for (const f of findings.filter((x) => x.level === "warning")) console.warn(`  warning [${f.code}] ${f.message}`);
}

function inventory(snapshot: SourceSnapshot): Record<string, unknown> {
  const R = snapshot.rows;
  const has = (rows: { video_clip_id?: unknown }[], id: unknown) => rows.some((r) => r.video_clip_id === id);
  return {
    team: snapshot.team.slug,
    player: snapshot.player.slug,
    clips: R.video_clips.map((c) => {
      const entry = R.game_log_entries.find((e) => e.id === c.game_log_entry_id);
      const issues = R.issues.filter((i) => i.video_clip_id === c.id);
      return {
        sourceClipId: c.id, clipSlug: c.clip_slug, status: c.status,
        entry: entry ? `${String(entry.session_type)} ${String(entry.date)}${entry.opponent ? ` vs ${String(entry.opponent)}` : ""} AB ${String(entry.ab)}` : null,
        linkedPitch: Boolean(c.at_bat_pitch_id), linkedPracticeRep: Boolean(c.practice_repetition_id),
        phases: R.swing_phases.filter((p) => p.video_clip_id === c.id).length,
        pose3d: has(R.video_clip_pose3d, c.id), metrics: has(R.video_clip_metrics, c.id),
        findings: {
          approved: issues.filter((i) => i.review_status === "approved").length, edited: issues.filter((i) => i.review_status === "edited").length,
          draft: issues.filter((i) => i.review_status === "draft").length, rejected: issues.filter((i) => i.review_status === "rejected").length,
        },
      };
    }),
    checklistScores: { reviewed: R.checklist_scores.filter((s) => s.reviewed_by).length, aiDraft: R.checklist_scores.filter((s) => !s.reviewed_by).length },
    priorities: R.player_priorities.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    practiceSessions: R.practice_sessions.length,
  };
}

function starterManifest(snapshot: SourceSnapshot): Record<string, unknown> {
  return {
    manifestVersion: 1,
    fixtureId: "",
    fixtureVersion: "",
    source: { teamSlug: snapshot.team.slug, playerSlug: snapshot.player.slug },
    publication: { consentConfirmedBy: "", consentConfirmedAt: "", note: "" },
    player: { publicName: "", publicSlug: "" },
    reviewerDisplayName: "",
    clips: [],
    priorities: "none",
    findings: { includeDrafts: false },
    report: { shareLink: true },
    expect: { requirePose3d: true, comparePairs: [] },
    _instructions: "Move entries from _availableClips into clips (add trim + sourceVideo), fill every blank field, and delete this key. If _linkedGuardianUserIds is nonempty, every selected clip also needs linkedGuardianPublicationPermissions for each listed guardian. These IDs stay local and must not enter public fixture data. Nothing is pre-selected on purpose.",
    _linkedGuardianUserIds: snapshot.linkedGuardianUserIds,
    _availableClips: snapshot.rows.video_clips.map((c) => ({ sourceClipId: c.id, clipSlug: c.clip_slug, status: c.status })),
  };
}

/** Only ever clears a directory this tool itself produced. */
function prepareOutDir(dir: string): void {
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir);
    const ours = new Set(["fixture.json", "media-manifest.json", "validation-report.json", "media"]);
    const foreign = entries.filter((e) => !ours.has(e));
    if (foreign.length) throw new Error(`${dir} contains files this exporter didn't create (${foreign.join(", ")}) - refusing to clear it`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
}

interface MediaOutcome { entries: Record<string, unknown>[]; findings: Finding[] }

async function produceMedia(result: BuildResult, mediaDir: string | null, planOnly: boolean, manifest: CurationManifest): Promise<MediaOutcome> {
  const findings: Finding[] = [];
  const entries: Record<string, unknown>[] = [];
  const err = (code: string, message: string) => findings.push({ level: "error", code, message, table: "video_clips" });
  if (!(await ffmpegAvailable())) {
    err("MEDIA_FFMPEG_MISSING", "ffmpeg/ffprobe not found on PATH - install ffmpeg or pass --skip-media");
    return { entries, findings };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hitterloop-demo-export-"));
  try {
    const policy = manifest.mediaPolicy ?? "privacy-treated";
    for (const clip of result.clips) {
      if (!clip.publicFilename) continue;
      if (policy === "privacy-treated") {
        // Only the anonymized output that passed both automated checks AND has a
        // human approval for its exact bytes. Copied byte-for-byte (no re-encode),
        // so frames, timing and hash are exactly what was validated and approved.
        if (!clip.privacy) { err("MEDIA_PRIVACY_MISSING", `clip "${clip.clipSlug}" has no privacy-treated media (clips[].privacy) - untreated footage is never exported`); continue; }
        const input = loadPrivacyGateInput({
          dir: path.resolve(clip.privacy.dir ?? path.join("demo-export", "privacy")), name: clip.privacy.name,
          approvalsFile: manifest.privacyApprovals ? path.resolve(manifest.privacyApprovals) : null,
          expectedFrames: clip.nFrames, localValidationOnly: manifest.localValidationOnly === true,
        });
        const gate = evaluatePrivacyGate({
          ...input, analysisWindowStartS: clip.analysisWindowStartS,
          mediaTrimStartS: clip.trim === null ? null : clip.trim === "full" ? 0 : clip.trim.startS,
        });
        for (const e of gate.errors) err("MEDIA_PRIVACY_GATE", `clip "${clip.clipSlug}" (${clip.privacy.name}): ${e}`);
        if (!gate.ok) continue;
        const base = {
          demoClipId: clip.fixtureClipId, publicFilename: clip.publicFilename,
          source: { clipSlug: clip.clipSlug, sourceClipId: clip.sourceClipId, sourceSha256: gate.record.sourceSha256 },
          trim: clip.trim, analysisWindowStartS: clip.analysisWindowStartS, audio: false, privacy: gate.record,
        };
        if (planOnly || !mediaDir) { entries.push({ ...base, planned: true }); continue; }
        fs.mkdirSync(mediaDir, { recursive: true });
        const dest = path.join(mediaDir, clip.publicFilename);
        fs.copyFileSync(input.mediaFile, dest);
        const copied = await sha256File(dest);
        if (copied !== gate.record.treatedSha256) { err("MEDIA_PRIVACY_GATE", `clip "${clip.clipSlug}": copied file hash changed`); continue; }
        const pinfo = await probe(dest);
        entries.push({ ...base, sha256: copied, bytes: fs.statSync(dest).size, durationS: Number(pinfo.durationS.toFixed(3)), width: pinfo.width, height: pinfo.height, videoCodec: pinfo.videoCodec, audioCodec: pinfo.audioCodec });
        continue;
      }
      if (!clip.trim) continue;
      let src = clip.local.sourceVideo ? path.resolve(clip.local.sourceVideo) : null;
      if (src && !fs.existsSync(src)) { err("MEDIA_SOURCE_MISSING", `clip "${clip.clipSlug}": sourceVideo does not exist`); continue; }
      if (!src) {
        if (!clip.local.rawGcsPath) { err("MEDIA_SOURCE_MISSING", `clip "${clip.clipSlug}" has no sourceVideo in the manifest and no stored original to download`); continue; }
        try {
          const { downloadFile } = await import("../services/storage/gcs.js");
          src = path.join(tmp, `${clip.fixtureClipId}${path.extname(clip.local.rawGcsPath) || ".mp4"}`);
          await downloadFile(clip.local.rawGcsPath, src);
        } catch (e) {
          err("MEDIA_SOURCE_MISSING", `clip "${clip.clipSlug}": couldn't fetch the stored original (${e instanceof Error ? e.message.split("\n")[0] : String(e)}) - set sourceVideo in the manifest to a local copy`);
          continue;
        }
      }
      const srcInfo = await probe(src);
      const window = clip.trim === "full" ? { startS: 0, endS: srcInfo.durationS } : clip.trim;
      if (window.endS > srcInfo.durationS + 0.05) { err("MEDIA_TRIM_INVALID", `clip "${clip.clipSlug}": trim ends at ${window.endS}s but the source video is ${srcInfo.durationS.toFixed(2)}s`); continue; }
      const length = window.endS - window.startS;
      if (length > MAX_MEDIA_SECONDS && !clip.allowLongMedia) {
        err("MEDIA_TOO_LONG", `clip "${clip.clipSlug}": ${length.toFixed(1)}s of media (limit ${MAX_MEDIA_SECONDS}s) - trim it tighter or set allowLongMedia explicitly`);
        continue;
      }
      const base = {
        demoClipId: clip.fixtureClipId, publicFilename: clip.publicFilename,
        source: { clipSlug: clip.clipSlug, sourceClipId: clip.sourceClipId, sourceSha256: await sha256File(src) },
        trim: clip.trim, analysisWindowStartS: clip.analysisWindowStartS, audio: clip.includeAudio,
      };
      if (planOnly || !mediaDir) { entries.push({ ...base, planned: true }); continue; }
      const t: TranscodeResult = await transcodeClip({ src, outDir: mediaDir, publicFilename: clip.publicFilename, trim: clip.trim, includeAudio: clip.includeAudio });
      for (const p of t.problems) err("MEDIA_OUTPUT_INVALID", `clip "${clip.clipSlug}": ${p}`);
      entries.push({
        ...base, sha256: t.sha256, bytes: t.bytes, durationS: Number(t.durationS.toFixed(3)),
        width: t.width, height: t.height, videoCodec: t.videoCodec, audioCodec: t.audioCodec,
      });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { entries, findings };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Export a curated, coach-reviewed real player into a public-demo fixture")
    .option("--team <slug>", "Local team slug (inventory mode, or cross-check against the manifest)")
    .option("--player <slug>", "Local player slug (inventory mode, or cross-check against the manifest)")
    .option("--manifest <path>", "Curation manifest (demo-curation.json) - required to export anything")
    .option("--output <dir>", "Export root; the fixture lands in <dir>/<fixtureId>/", "demo-export")
    .option("--frames-root <dir>", "Local pose3d pipeline output root (for stage0.json alignment)", "frames")
    .option("--dry-run", "Build + validate + check media sources; write nothing")
    .option("--validate-only", "Write validation-report.json only (no fixture, no media)")
    .option("--skip-media", "Export data only; clips carry no demo media (the demo shows its placeholder)")
    .option("--init-manifest <path>", "Inventory mode: write a starter manifest (nothing pre-selected)")
    .option("--allow-remote-source", "Permit a non-local SUPABASE_URL as the source (off by default)");
  program.parse(process.argv);
  const opts = program.opts<Opts>();
  assertLocalSource(process.env.SUPABASE_URL, opts.allowRemoteSource === true);
  const client = getSupabaseClient();

  if (!opts.manifest) {
    if (!opts.team || !opts.player) throw new Error("pass --manifest <file>, or --team and --player for inventory mode");
    const snapshot = await loadSourceSnapshot(client, opts.team, opts.player);
    console.log(JSON.stringify(inventory(snapshot), null, 2));
    if (opts.initManifest) {
      if (fs.existsSync(opts.initManifest)) throw new Error(`${opts.initManifest} already exists - not overwriting`);
      fs.writeFileSync(opts.initManifest, JSON.stringify(starterManifest(snapshot), null, 2) + "\n");
      console.log(`\nStarter manifest written to ${opts.initManifest} (no clips pre-selected).`);
    }
    return;
  }

  const parsed = parseCurationManifest(JSON.parse(fs.readFileSync(opts.manifest, "utf-8")));
  if (!parsed.manifest) {
    console.error(`Curation manifest ${opts.manifest} is invalid:`);
    for (const p of parsed.problems) console.error(`  ERROR   [MANIFEST] ${p.path}: ${p.message}`);
    process.exitCode = 1;
    return;
  }
  const manifest: CurationManifest = parsed.manifest;
  if ((opts.team && opts.team !== manifest.source.teamSlug) || (opts.player && opts.player !== manifest.source.playerSlug)) {
    throw new Error(`--team/--player (${opts.team}/${opts.player}) disagree with the manifest (${manifest.source.teamSlug}/${manifest.source.playerSlug})`);
  }

  const snapshot = await loadSourceSnapshot(client, manifest.source.teamSlug, manifest.source.playerSlug);
  const clipContext = new Map<string, ClipContext>();
  for (const c of snapshot.rows.video_clips) {
    const ctx = readStage0Context(opts.framesRoot, manifest.source.playerSlug, String(c.clip_slug));
    if (ctx) clipContext.set(String(c.id), ctx);
  }
  const mediaMode = opts.skipMedia ? "skipped" : "planned";
  const result = buildFixture(snapshot, manifest, { mediaMode, clipContext });

  const outDir = path.join(opts.output, manifest.fixtureId);
  const writeReport = !opts.dryRun;
  // Every real run starts from an empty directory, so a failed export can
  // never leave an older fixture.json/media next to a new failing report.
  if (writeReport) prepareOutDir(outDir);
  let media: MediaOutcome = { entries: [], findings: [] };
  const dataOk = !hasErrors(result.findings);
  if (dataOk && mediaMode === "planned" && !opts.validateOnly) {
    media = await produceMedia(result, opts.dryRun ? null : path.join(outDir, "media"), Boolean(opts.dryRun), manifest);
  }
  const findings = [...result.findings, ...media.findings];
  const ok = !hasErrors(findings);

  const counts = Object.fromEntries(FIXTURE_TABLE_ORDER.map((t) => [t, result.fixture.tables[t].length]));
  const report = {
    fixtureId: manifest.fixtureId,
    fixtureVersion: manifest.fixtureVersion,
    contentSha256: result.fixture.contentSha256,
    generatedAt: new Date().toISOString(),
    status: ok ? "pass" : "fail",
    mode: opts.dryRun ? "dry-run" : opts.validateOnly ? "validate-only" : mediaMode === "skipped" ? "export (media skipped)" : "export",
    source: { teamSlug: manifest.source.teamSlug, playerSlug: manifest.source.playerSlug },
    publication: manifest.publication,
    counts,
    errors: findings.filter((f) => f.level === "error"),
    warnings: findings.filter((f) => f.level === "warning"),
    excluded: result.exclusions,
    humanOverrides: result.fixture.curation.overrides,
  };

  console.log(`\nFixture ${manifest.fixtureId}@${manifest.fixtureVersion}: ${ok ? "PASS" : "FAIL"} (${report.errors.length} error(s), ${report.warnings.length} warning(s), ${report.excluded.length} source row(s) excluded)`);
  console.log(`  rows: ${Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${t}=${n}`).join(" ")}`);
  printFindings(findings);

  if (writeReport) {
    fs.writeFileSync(path.join(outDir, "validation-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  if (!ok) {
    console.error(`\nNot exported - fix the errors above.${writeReport ? ` Full report: ${path.join(outDir, "validation-report.json")}` : ""}`);
    process.exitCode = 1;
    return;
  }
  if (opts.dryRun || opts.validateOnly) {
    if (writeReport) fs.rmSync(path.join(outDir, "media"), { recursive: true, force: true });
    console.log(opts.dryRun ? "\nDry run: nothing written." : `\nValidation report written to ${path.join(outDir, "validation-report.json")}.`);
    return;
  }
  fs.writeFileSync(path.join(outDir, "fixture.json"), JSON.stringify(result.fixture) + "\n");
  if (mediaMode === "planned") {
    fs.writeFileSync(path.join(outDir, "media-manifest.json"), JSON.stringify({
      fixtureId: manifest.fixtureId, fixtureVersion: manifest.fixtureVersion,
      mediaPolicy: manifest.mediaPolicy ?? "privacy-treated",
      encoding: (manifest.mediaPolicy ?? "privacy-treated") === "privacy-treated"
        ? { video: "privacy-treated output of scripts/privacy/anonymize_clip.py, copied byte-for-byte: H.264 High yuv420p limited range, 1280px wide, CFR at the analysis fps (frame i = analysis frame i)", audio: "none", metadata: "stripped" }
        : { video: "H.264 High, yuv420p, CRF 23, short side <= 720px, fps <= 60, faststart", audio: "dropped unless the clip opts in (then AAC 128k stereo)", metadata: "all container/stream metadata stripped" },
      clips: media.entries,
    }, null, 2) + "\n");
  } else {
    fs.rmSync(path.join(outDir, "media"), { recursive: true, force: true });
  }
  console.log(`\nWrote ${outDir}/ (fixture.json${mediaMode === "planned" ? `, media-manifest.json, media/ x${media.entries.length}` : ""}, validation-report.json).`);
  console.log(`Next: npm run import-demo-fixture -- --fixture ${path.join(outDir, "fixture.json")} --verify-only`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
