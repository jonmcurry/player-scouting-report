#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSwing, type FrameImage } from "../services/ai/geminiAnalyzer.js";
import { analyzeSwingViaClaudeCli } from "../services/ai/claudeCliAnalyzer.js";
import { buildInputManifest, type AnalysisInput, type PitchContext } from "../services/ai/analysisContext.js";
import { ANALYSIS_POLICY_VERSION, PROMPT_VERSION } from "../services/ai/analysisVersions.js";
import { findingIdentity, validateSwingAnalysisResult, type SwingAnalysisResult } from "../services/ai/swingAnalysisShared.js";
import { loadActiveMethodologySnapshot, filterApplicableMethodology, renderMethodologyPack } from "../services/knowledge/methodologyRepository.js";
import { findPlayerId, loadCheckpointSlugToId, upsertChecklistScore } from "../services/db/checklistUpsert.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const TILT_EXCLUSIONS = [
  { field: "torso_tilt_at_contact_deg", reason: "excluded: stored tilt is unreliable because the live 3D lift uses a fixed world rotation" },
  { field: "pelvis_tilt_at_contact_deg", reason: "excluded: stored tilt is unreliable because the live 3D lift uses a fixed world rotation" },
];

function frameNames(framesDir: string): string[] {
  if (!framesDir || !fs.existsSync(framesDir)) return [];
  return fs.readdirSync(framesDir).filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())).sort();
}

function loadFrameImages(framesDir: string): FrameImage[] {
  const files = frameNames(framesDir);
  if (files.length === 0) throw new Error(`No image files found in ${framesDir} (expected .png/.jpg from extract.ts)`);
  return files.map((f) => ({
    data: fs.readFileSync(path.join(framesDir, f)),
    mimeType: path.extname(f).toLowerCase() === ".png" ? "image/png" : "image/jpeg",
  }));
}

const emptyPitch = (): PitchContext => ({ location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null });

async function buildAnalysisInput(args: {
  teamSlug: string;
  playerSlug: string;
  playerId: string;
  framesDir: string;
  fallbackPitchContext: string;
  videoClipId: string | null;
  pipelineVersion: string | null;
}): Promise<AnalysisInput> {
  const supabase = getSupabaseClient();
  const { data: player, error: playerErr } = await supabase
    .from("players")
    .select("age_band, bats, throws, teams!inner(slug, sport, level_label)")
    .eq("id", args.playerId)
    .eq("teams.slug", args.teamSlug)
    .single();
  if (playerErr || !player) throw new Error(`Loading player analysis context: ${playerErr?.message ?? "not found"}`);
  const team = player.teams as unknown as { sport: "baseball" | "softball" | null; level_label: string | null };
  let pitch = emptyPitch();
  if (args.videoClipId) {
    const { data: clip, error: clipErr } = await supabase
      .from("video_clips")
      .select("at_bat_pitches(pitch_location,pitch_zone,count_before_balls,count_before_strikes,pitch_outcome,swung,pitch_type)")
      .eq("id", args.videoClipId)
      .single();
    if (clipErr) throw new Error(`Loading structured pitch context: ${clipErr.message}`);
    const p = clip?.at_bat_pitches as unknown as {
      pitch_location: string | null; pitch_zone: number | null; count_before_balls: number | null;
      count_before_strikes: number | null; pitch_outcome: string | null; swung: boolean | null; pitch_type: string | null;
    } | null;
    if (p) pitch = {
      location: p.pitch_location, zone: p.pitch_zone,
      count: p.count_before_balls !== null && p.count_before_strikes !== null ? { balls: p.count_before_balls, strikes: p.count_before_strikes } : null,
      outcome: p.pitch_outcome, swung: p.swung, pitchType: p.pitch_type,
    };
  } else if (args.fallbackPitchContext && args.fallbackPitchContext !== "No pitch/result details provided.") {
    // Manual CLI compatibility only. Automatic processing always uses the structured pitch row.
    pitch.location = args.fallbackPitchContext;
  }
  const { data: decisions, error: decisionsErr } = await supabase
    .from("issues")
    .select("concept,phase,video_clip_id,review_status")
    .eq("player_id", args.playerId)
    .neq("review_status", "draft");
  if (decisionsErr) throw new Error(`Loading coach-reviewed decisions: ${decisionsErr.message}`);
  // Fail-closed: loadActiveMethodologySnapshot() throws (rather than
  // falling back to knowledge/claims.json or candidate claims) if no
  // active methodology snapshot exists. That error propagates up through
  // analyzeAndSync and is caught by the existing per-clip try/catch in
  // processUploadQueue.ts, which logs it clearly and leaves the clip ready
  // rather than crashing the worker - the same non-fatal boundary every
  // other per-clip failure already uses.
  const snapshot = await loadActiveMethodologySnapshot();
  const playerContext = {
    sport: team.sport,
    level: team.level_label,
    ageBand: player.age_band as AnalysisInput["player"]["ageBand"],
    bats: player.bats as AnalysisInput["player"]["bats"],
    throws: player.throws as AnalysisInput["player"]["throws"],
  };
  const applicable = filterApplicableMethodology(snapshot.items, { sport: playerContext.sport, ageBand: playerContext.ageBand });
  const pack = renderMethodologyPack(applicable);
  return {
    player: playerContext,
    pitch,
    coachReviewedDecisions: (decisions ?? []).map((d) => ({ concept: d.concept, phase: d.phase, videoClipId: d.video_clip_id, status: d.review_status })),
    swing: {
      frameNames: frameNames(args.framesDir), pipelineVersion: args.pipelineVersion, metrics: {},
      reconstructionSupplied: false, excludedMeasurements: TILT_EXCLUSIONS,
    },
    knowledgePack: pack.text,
    knowledgeClaimIds: pack.claimIds,
    knowledgeVersion: snapshot.versionLabel,
  };
}

async function createAnalysisRun(args: {
  playerId: string; videoClipId: string | null; result: SwingAnalysisResult; input: AnalysisInput;
}): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("analysis_runs").insert({
    video_clip_id: args.videoClipId,
    player_id: args.playerId,
    backend: args.result.source,
    ai_model: args.result.aiModel,
    ai_model_version: args.result.aiModelVersion,
    prompt_version: PROMPT_VERSION,
    analysis_policy_version: ANALYSIS_POLICY_VERSION,
    knowledge_version: args.input.knowledgeVersion,
    pipeline_version: args.input.swing.pipelineVersion,
    input_manifest: buildInputManifest(args.input),
    no_action_needed: args.result.noActionNeeded,
    no_action_reason: args.result.noActionReason,
  }).select("id").single();
  if (error || !data) throw new Error(`Creating analysis run: ${error?.message ?? "no row returned"}`);
  return data.id as string;
}

export async function analyzeAndSync(
  teamSlug: string,
  playerSlug: string,
  framesDir: string,
  pitchContext: string,
  force = false,
  claudeDraftPath: string | null = null,
  useClaudeCli = false,
  videoClipId: string | null = null,
  pipelineVersion: string | null = null,
): Promise<void> {
  const playerId = await findPlayerId(teamSlug, playerSlug);
  const input = await buildAnalysisInput({ teamSlug, playerSlug, playerId, framesDir, fallbackPitchContext: pitchContext, videoClipId, pipelineVersion });
  let result: SwingAnalysisResult;
  if (claudeDraftPath) {
    console.log(`Loading Claude-drafted analysis from ${claudeDraftPath} (Gemini not called)...`);
    result = validateSwingAnalysisResult(JSON.parse(fs.readFileSync(claudeDraftPath, "utf-8")), {
      source: "claude", aiModel: "claude-draft-file", allowedKnowledgeClaimIds: input.knowledgeClaimIds, availableBases: ["video"],
    });
  } else if (useClaudeCli) {
    console.log(`Running analysis via the local claude CLI on ${framesDir} (Gemini not called)...`);
    result = await analyzeSwingViaClaudeCli(framesDir, input);
  } else {
    const frames = loadFrameImages(framesDir);
    console.log(`Sending ${frames.length} frame(s) from ${framesDir} to configured Gemini model...`);
    result = await analyzeSwing(frames, input);
  }

  // Both backends and draft files reach this point only after the same strict runtime validator.
  // Consequently malformed output has made zero database writes.
  const analysisRunId = await createAnalysisRun({ playerId, videoClipId, result, input });
  const slugToId = await loadCheckpointSlugToId();
  let updated = 0;
  let skipped = 0;
  for (const entry of result.checklist) {
    const checkpointId = slugToId.get(entry.checkpointSlug)!;
    const wrote = await upsertChecklistScore({
      playerId, checkpointId, checkpointLabel: entry.checkpointSlug, score: entry.score,
      aiDraft: entry.score, notes: entry.notes, source: result.source, analysisRunId,
    }, force);
    if (wrote) updated++; else skipped++;
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: existingErr } = await supabase.from("issues").select("finding_key").eq("player_id", playerId);
  if (existingErr) throw new Error(`Reading existing finding identities: ${existingErr.message}`);
  const existingKeys = new Set((existing ?? []).map((r) => r.finding_key).filter(Boolean));
  const freshIssues = result.issues.filter((i) => !existingKeys.has(findingIdentity(i, videoClipId)));
  if (freshIssues.length) {
    const rows = freshIssues.map((i) => ({
      player_id: playerId, issue: i.issue, seen_in_at_bats: i.seenInAtBats, likely_cause: i.likelyCause,
      effect: i.effect, evidence: i.evidence, coaching_cue: i.coachingCue, suggested_drill: i.suggestedDrill ?? null,
      look_for_next: i.lookForNext, confidence: i.confidence, phase: i.phase ?? null, video_clip_id: videoClipId,
      suggested_priority_title: i.issue, review_status: "draft", reviewed_by: null, source: result.source,
      analysis_run_id: analysisRunId, concept: i.concept, basis: i.basis,
      context_explains_it: i.contextExplainsIt, emergency_swing_suspected: i.emergencySwingSuspected,
      knowledge_claim_ids: i.knowledgeClaimIds, suggest_priority: i.suggestPriority,
      finding_key: findingIdentity(i, videoClipId),
    }));
    const { error } = await supabase.from("issues").insert(rows);
    if (error) throw new Error(`Inserting ${result.source}-drafted issues: ${error.message}`);
  }

  if (result.comps.length) {
    const { error } = await supabase.from("comp_recommendations").insert(result.comps.map((c, i) => ({
      player_id: playerId, comp_name: c.compName, cue: c.cue, position: i, analysis_run_id: analysisRunId,
    })));
    if (error) throw new Error(`Inserting comp illustrations: ${error.message}`);
  }
  if (result.compNotes.length) {
    const { error } = await supabase.from("comp_notes").insert(result.compNotes.map((note, i) => ({
      player_id: playerId, note, position: i, analysis_run_id: analysisRunId,
    })));
    if (error) throw new Error(`Inserting comp notes: ${error.message}`);
  }
  if (result.drills.length) {
    const { error } = await supabase.from("drill_recommendations").insert(result.drills.map((d, i) => ({
      player_id: playerId, title: d.title, description: d.description, position: i, analysis_run_id: analysisRunId,
    })));
    if (error) throw new Error(`Inserting drill recommendations: ${error.message}`);
  }

  console.log(`Analyzed ${playerSlug}: run ${analysisRunId}; ${updated} checkpoint(s) updated, ${skipped} coach-reviewed checkpoint(s) protected, ${freshIssues.length} new issue draft(s), noActionNeeded=${result.noActionNeeded}.`);
}

async function main() {
  const program = new Command();
  program.requiredOption("--team <slug>").requiredOption("--player <slug>")
    .option("--framesDir <path>").option("--pitchContext <text>")
    .option("--force", "Overwrite checkpoints a coach has already reviewed", false)
    .option("--claudeDraft <path>").option("--claudeCli", "Use local Claude CLI", false);
  program.parse(process.argv);
  const opts = program.opts<{ team: string; player: string; framesDir?: string; pitchContext?: string; force: boolean; claudeDraft?: string; claudeCli: boolean }>();
  if (!opts.claudeDraft && !opts.framesDir) throw new Error("--framesDir is required unless --claudeDraft is provided");
  await analyzeAndSync(opts.team, opts.player, opts.framesDir ?? "", opts.pitchContext ?? "No pitch/result details provided.", opts.force, opts.claudeDraft ?? null, opts.claudeCli);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
