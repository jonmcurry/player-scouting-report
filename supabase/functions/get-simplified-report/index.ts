// One read boundary for the simplified report. A caller supplies either their
// own JWT or one revocable share token. All private reads happen after the
// player-specific authorization check.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Storage } from "npm:@google-cloud/storage@7";
import { assembleReport, feedAnalysisPresentation, plainFailureReason, type ReportDrill, type ReportIssue } from "../../../src/services/development/reportAssembly.ts";
import { advanceFocus, type Finding, type FocusRecord, type ReadableSwing } from "../../../src/services/development/focus.ts";
import { opaqueRawObject } from "../_shared/opaqueStoragePath.ts";
import { privateName, redactSharedText } from "../_shared/sharedText.ts";
import { selectVisibleClips } from "./visibility.ts";
import { selectDrills } from "../../../src/services/development/drillSelection.ts";
import { practiceEvidence } from "../../../src/services/development/progressPractice.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const notFound = () => reply({ error: "Report not found." }, 404);

// supabase-js cannot infer a row type from its ungenerated schema here.
async function progressVideo(service: any, playerId: string, clipId: string | null) {
  if (!clipId) return null;
  const { data: clip, error } = await service.from("video_clips")
    .select("id, status, raw_gcs_path, game_log_entry_id, clip_slug, game_log_entries!inner(player_id)")
    .eq("id", clipId).eq("game_log_entries.player_id", playerId).maybeSingle();
  if (error || !clip || clip.status !== "ready") return null;
  const { data: deleting, error: deletionError } = await service.from("clip_deletions")
    .select("clip_id").eq("clip_id", clipId).limit(1);
  if (deletionError || deleting?.length) return null;
  const bucket = Deno.env.get("GCS_BUCKET_NAME") ?? "";
  const object = opaqueRawObject(clip.raw_gcs_path, bucket, clip.game_log_entry_id, clip.clip_slug, clip.id);
  if (!object) return null;
  const emulator = Deno.env.get("GCS_EMULATOR_HOST");
  let url: string;
  if (emulator) url = `${emulator}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
  else {
    const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
    [url] = await storage.bucket(bucket).file(object).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });
  }
  const { data: phases, error: phaseError } = await service.from("swing_phases")
    .select("time_s, swing_phase_types!inner(slug)").eq("video_clip_id", clipId)
    .eq("swing_phase_types.slug", "contact").limit(1);
  if (phaseError) return null;
  return { clipId, url, contactTime: phases?.[0]?.time_s ?? null };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    const playerId = body.playerId;
    const clipId = body.clipId;
    if (typeof playerId !== "string" || !UUID.test(playerId) || (clipId !== undefined && (typeof clipId !== "string" || !UUID.test(clipId)))) return notFound();
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    let shared = false;
    let shareScope: "report" | "progress" | null = null;
    if (typeof body.token === "string" && body.token.length > 0) {
      const { data: link, error } = await service.from("player_share_links").select("player_id, revoked_at, expires_at, share_scope, video_clip_id")
        .eq("token", body.token).maybeSingle();
      if (error || !link || link.player_id !== playerId || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) return notFound();
      if (link.share_scope !== "report" && link.share_scope !== "progress") return notFound();
      if (link.share_scope === "report" && link.video_clip_id !== clipId) return notFound();
      shared = true;
      shareScope = link.share_scope;
    } else {
      const authorization = request.headers.get("Authorization");
      if (!authorization) return notFound();
      const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: user, error: userError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
      if (userError || !user?.user || user.user.is_anonymous) return notFound();
      const [{ data: guardian }, { data: player }] = await Promise.all([
        caller.rpc("is_guardian_for_player", { target_player_id: playerId }),
        service.from("players").select("team_id").eq("id", playerId).maybeSingle(),
      ]);
      if (!player) return notFound();
      const { data: coach } = await caller.rpc("is_coach_for_team", { target_team_id: player.team_id });
      if (guardian !== true && coach !== true) return notFound();
    }
    const { data: player, error: playerError } = await service.from("players")
      .select("id, name, age_band, readable_game_swing_count, teams!inner(name, sport, age_group)").eq("id", playerId).single();
    if (playerError || !player) return notFound();
    const team = player.teams as unknown as { name: string; sport: string | null; age_group: string | null };
    const sharedText = (value: string) => shared ? redactSharedText(value, player.name, team.name) : value;
    const { data: focusRows, error: focusError } = await service.from("player_focus")
      .select("id, concept, status, started_at, ended_at, qualified_at_serial, dismissed_at_serial, dismissed_by")
      .eq("player_id", playerId).order("started_at", { ascending: false });
    if (focusError) throw focusError;
    const asFocus = (row: NonNullable<typeof focusRows>[number]): FocusRecord => ({
      concept: row.concept, status: row.status, startedAt: row.started_at, endedAt: row.ended_at,
      qualifiedAtSerial: row.qualified_at_serial, dismissedAtSerial: row.dismissed_at_serial,
      dismissedBy: row.dismissed_by,
    });
    const storedCurrent = (focusRows ?? []).find((row) => row.ended_at === null) ?? null;
    const { data: allClips, error: clipsError } = await service.from("video_clips")
      .select("id, status, swing_detection_state, error_message, created_at, readable_game_serial, raw_gcs_path, game_log_entry_id, clip_slug, game_log_entries!inner(player_id, date, session_type, result_simple)")
      .eq("game_log_entries.player_id", playerId).order("created_at", { ascending: false }).limit(100);
    if (clipsError) throw clipsError;
    const { data: allRecent, error: recentError } = await service.from("video_clips")
      .select("id, created_at, readable_game_serial, game_log_entries!inner(player_id, date)")
      .eq("game_log_entries.player_id", playerId).not("readable_game_serial", "is", null)
      .order("readable_game_serial", { ascending: false }).limit(100);
    if (recentError) throw recentError;
    // A storage deletion can fail after the audited request is recorded. Such
    // clips must disappear from the feed and focus immediately, even while
    // the retryable deletion is waiting to finish.
    const visibleIds = [...new Set([...(allClips ?? []), ...(allRecent ?? [])].map((clip) => clip.id))];
    const { data: deletionRows, error: deletionError } = visibleIds.length
      ? await service.from("clip_deletions").select("clip_id").in("clip_id", visibleIds)
      : { data: [], error: null };
    if (deletionError) throw deletionError;
    const deletingIds = new Set((deletionRows ?? []).map((row) => row.clip_id));
    const { clips, recent, feedClips } = selectVisibleClips(allClips ?? [], allRecent ?? [], deletingIds, shared);
    const { data: focusRuns, error: focusRunError } = (recent ?? []).length
      ? await service.from("analysis_runs").select("id, video_clip_id, created_at")
        .in("video_clip_id", (recent ?? []).map((clip) => clip.id))
        .not("summary", "is", null).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (focusRunError) throw focusRunError;
    const latestRun = new Map<string, string>();
    for (const run of focusRuns ?? []) if (run.video_clip_id && !latestRun.has(run.video_clip_id)) latestRun.set(run.video_clip_id, run.id);
    const { data: focusIssues, error: focusIssueError } = (recent ?? []).length
      ? await service.from("issues").select("id, video_clip_id, analysis_run_id, concept, phase, basis, confidence, context_explains_it, emergency_swing_suspected, review_status")
        .in("video_clip_id", (recent ?? []).map((clip) => clip.id))
      : { data: [], error: null };
    if (focusIssueError) throw focusIssueError;
    const findings = new Map<string, Finding[]>();
    for (const row of focusIssues ?? []) {
      if (row.analysis_run_id !== latestRun.get(row.video_clip_id)) continue;
      const list = findings.get(row.video_clip_id) ?? [];
      list.push({ id: row.id, concept: row.concept ?? "", phase: row.phase, basis: row.basis ?? "", confidence: row.confidence,
        contextExplainsIt: row.context_explains_it, emergencySwingSuspected: row.emergency_swing_suspected,
        hidden: row.review_status === "hidden" || row.review_status === "rejected" });
      findings.set(row.video_clip_id, list);
    }
    const swings: ReadableSwing[] = (recent ?? []).map((clip) => ({ id: clip.id, serial: clip.readable_game_serial,
      date: clip.game_log_entries.date, sessionType: "game", readable: true, findings: findings.get(clip.id) ?? [] }));
    const computed = advanceFocus(swings, storedCurrent ? asFocus(storedCurrent) : null,
      (focusRows ?? []).filter((row) => row.ended_at !== null).map(asFocus), player.readable_game_swing_count);
    const current = computed.current ? { concept: computed.current.concept, status: computed.status,
      startedAt: computed.current.startedAt, seen: computed.seen, windowSize: computed.windowSize } : null;
    const thenClip = computed.current ? [...(recent ?? [])].reverse().find((clip) =>
      (findings.get(clip.id) ?? []).some((f) => f.concept === computed.current?.concept && !f.hidden && f.basis === "video" && f.confidence === "medium"))
      ?? [...(recent ?? [])].reverse().find((clip) => (findings.get(clip.id) ?? []).some((f) => f.concept === computed.current?.concept && !f.hidden && f.basis === "video")) : null;
    const progress = { current, status: computed.status, windowSize: computed.windowSize,
      history: computed.history.map((row) => ({ concept: row.concept, status: row.status,
      startedAt: row.startedAt, endedAt: row.endedAt })), thenClipId: thenClip?.id ?? null,
      nowClipId: recent?.[0]?.id ?? null };
    const { data: practiceClips, error: practiceError } = await service.from("video_clips")
      .select("id, created_at, game_log_entries!inner(player_id, session_type)")
      .eq("game_log_entries.player_id", playerId).eq("game_log_entries.session_type", "practice")
      .eq("status", "ready").order("created_at", { ascending: false }).limit(20);
    if (practiceError) throw practiceError;
    const { data: practiceDeletions, error: practiceDeletionError } = (practiceClips ?? []).length
      ? await service.from("clip_deletions").select("clip_id").in("clip_id", (practiceClips ?? []).map((clip) => clip.id))
      : { data: [], error: null };
    if (practiceDeletionError) throw practiceDeletionError;
    const deletedPracticeIds = new Set((practiceDeletions ?? []).map((row) => row.clip_id));
    const visiblePractice = (practiceClips ?? []).filter((clip) => !deletedPracticeIds.has(clip.id));
    const { data: practiceRuns, error: practiceRunError } = visiblePractice.length
      ? await service.from("analysis_runs").select("id, video_clip_id, created_at, summary, strengths")
        .in("video_clip_id", visiblePractice.map((clip) => clip.id)).not("summary", "is", null)
        .order("created_at", { ascending: false }) : { data: [], error: null };
    if (practiceRunError) throw practiceRunError;
    const { data: practiceIssues, error: practiceIssueError } = visiblePractice.length
      ? await service.from("issues").select("video_clip_id, analysis_run_id, concept, basis, review_status, context_explains_it, emergency_swing_suspected")
        .in("video_clip_id", visiblePractice.map((clip) => clip.id)) : { data: [], error: null };
    if (practiceIssueError) throw practiceIssueError;
    const practice = current ? practiceEvidence(visiblePractice.map((clip) => clip.id), practiceRuns ?? [],
      practiceIssues ?? [], current.concept) : null;
    let focusDrill: ReportDrill | null = null;
    if (current) {
      const { data: focusDrills, error: focusDrillError } = await service.from("drill_library")
        .select("id, name, target_tags, best_for, is_active, min_age, sport, home_friendly, equipment, phase, requires_screen, weighted_or_overspeed, instructions, cue, looks_right_when, common_mistakes, demo_url, demo_timestamp, source_credit")
        .eq("is_active", true);
      if (focusDrillError) throw focusDrillError;
      const age = player.age_band ? Number(player.age_band.match(/\d+/)?.[0] ?? 12) : Number(team.age_group?.match(/\d+/)?.[0] ?? 12);
      const candidates: ReportDrill[] = (focusDrills ?? []).map((row) => ({ id: row.id, name: row.name,
        targetTags: row.target_tags, bestFor: row.best_for ?? "", isActive: row.is_active, minAge: row.min_age,
        sport: row.sport, homeFriendly: row.home_friendly, equipment: row.equipment, phase: row.phase,
        requiresScreen: row.requires_screen, weightedOrOverspeed: row.weighted_or_overspeed,
        instructions: row.instructions, cue: row.cue, looksRightWhen: row.looks_right_when,
        commonMistakes: row.common_mistakes, demoUrl: row.demo_url, demoTimestamp: row.demo_timestamp,
        sourceCredit: row.source_credit }));
      focusDrill = selectDrills(candidates, { concept: current.concept, phase: null,
        sport: team.sport === "baseball" || team.sport === "softball" ? team.sport : null, age })[0] ?? null;
      if (focusDrill && shared) focusDrill = { ...focusDrill, name: sharedText(focusDrill.name),
        bestFor: sharedText(focusDrill.bestFor), instructions: sharedText(focusDrill.instructions),
        cue: focusDrill.cue ? sharedText(focusDrill.cue) : null,
        looksRightWhen: focusDrill.looksRightWhen ? sharedText(focusDrill.looksRightWhen) : null,
        commonMistakes: focusDrill.commonMistakes.map(sharedText),
        sourceCredit: focusDrill.sourceCredit ? sharedText(focusDrill.sourceCredit) : null };
    }
    if (shareScope === "progress" && clipId) return notFound();
    const { data: headlines, error: headlineError } = (clips ?? []).length
      ? await service.from("analysis_runs").select("video_clip_id, summary, created_at")
        .in("video_clip_id", (clips ?? []).map((clip) => clip.id)).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (headlineError) throw headlineError;
    const newestSummary = new Map<string, string>();
    for (const row of headlines ?? []) if (row.video_clip_id && !newestSummary.has(row.video_clip_id) && row.summary?.trim())
      newestSummary.set(row.video_clip_id, row.summary.trim());
    const { data: disputedFeed, error: disputedFeedError } = (clips ?? []).length
      ? await service.from("issues").select("video_clip_id")
        .in("video_clip_id", (clips ?? []).map((clip) => clip.id))
        .in("review_status", ["hidden", "rejected"])
      : { data: [], error: null };
    if (disputedFeedError) throw disputedFeedError;
    const disputedClipIds = new Set((disputedFeed ?? []).map((issue) => issue.video_clip_id));
    // A failed storage delete leaves a retryable audit row. Authorized users
    // need one recovery action in the feed; share viewers never see it.
    const feed = feedClips.map((clip) => {
      const entry = clip.game_log_entries as unknown as { date: string; session_type: string; result_simple: string | null };
      const summary = newestSummary.get(clip.id);
      const presentation = feedAnalysisPresentation(clip.status, clip.swing_detection_state, summary ?? null);
      return { id: clip.id, entryId: clip.game_log_entry_id, date: entry.date, kind: entry.session_type, result: entry.result_simple,
        status: deletingIds.has(clip.id) ? "deletion_pending" : presentation.status,
        headline: deletingIds.has(clip.id) ? "Video deletion needs another try."
          : disputedClipIds.has(clip.id) ? "An observation was hidden after feedback."
          : presentation.headline ? sharedText(presentation.headline) : null };
    });
    const identity = shared ? privateName(player.name) : player.name;
    if (!clipId) {
      const [thenVideo, nowVideo] = await Promise.all([
        progressVideo(service, playerId, progress.thenClipId),
        progress.nowClipId === progress.thenClipId ? null : progressVideo(service, playerId, progress.nowClipId),
      ]);
      return reply({ playerId, playerName: identity,
        progress: { ...progress, practice, focusDrill, thenVideo, nowVideo: nowVideo ?? (progress.nowClipId === progress.thenClipId ? thenVideo : null) },
        feed: shareScope === "progress" ? [] : feed });
    }
    const { data: clip, error: clipError } = await service.from("video_clips")
      .select("id, status, swing_detection_state, error_message, raw_gcs_path, game_log_entry_id, clip_slug, game_log_entries!inner(player_id)")
      .eq("id", clipId).eq("game_log_entries.player_id", playerId).maybeSingle();
    if (clipError || !clip) return notFound();
    const { data: entryClips, error: entryClipsError } = shared
      ? { data: [], error: null }
      : await service.from("video_clips").select("id").eq("game_log_entry_id", clip.game_log_entry_id);
    if (entryClipsError) throw entryClipsError;
    const [{ data: run, error: runError }, { data: rows, error: issueError }, { data: drillRows, error: drillError }] = await Promise.all([
      service.from("analysis_runs").select("id, summary, strengths").eq("video_clip_id", clipId)
        .not("summary", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      service.from("issues").select("id, analysis_run_id, concept, phase, basis, confidence, context_explains_it, emergency_swing_suspected, review_status, issue, evidence, coaching_cue, look_for_next, hidden_by").eq("video_clip_id", clipId),
      service.from("drill_library").select("id, name, target_tags, best_for, is_active, min_age, sport, home_friendly, equipment, phase, requires_screen, weighted_or_overspeed, instructions, cue, looks_right_when, common_mistakes, demo_url, demo_timestamp, source_credit").eq("is_active", true),
    ]);
    if (runError || issueError || drillError) throw runError ?? issueError ?? drillError;
    const issues: ReportIssue[] = (rows ?? []).filter((row) => row.analysis_run_id === run?.id || row.review_status === "hidden").map((row) => ({
      id: row.id, concept: row.concept ?? "", phase: row.phase, basis: row.basis ?? "", confidence: row.confidence,
      contextExplainsIt: row.context_explains_it, emergencySwingSuspected: row.emergency_swing_suspected,
      hidden: row.review_status === "hidden" || row.review_status === "rejected", hiddenBy: row.hidden_by,
      issue: row.issue, evidence: row.evidence, coachingCue: row.coaching_cue, lookForNext: row.look_for_next,
    }));
    const drills: ReportDrill[] = (drillRows ?? []).map((row) => ({ id: row.id, name: row.name,
      targetTags: row.target_tags, bestFor: row.best_for ?? "", isActive: row.is_active, minAge: row.min_age,
      sport: row.sport, homeFriendly: row.home_friendly, equipment: row.equipment, phase: row.phase,
      requiresScreen: row.requires_screen, weightedOrOverspeed: row.weighted_or_overspeed,
      instructions: row.instructions, cue: row.cue, looksRightWhen: row.looks_right_when,
      commonMistakes: row.common_mistakes, demoUrl: row.demo_url, demoTimestamp: row.demo_timestamp,
      sourceCredit: row.source_credit }));
    const age = player.age_band ? Number(player.age_band.match(/\d+/)?.[0] ?? 12) : Number(team.age_group?.match(/\d+/)?.[0] ?? 12);
    const report = assembleReport({ run: run ? { id: run.id, summary: run.summary, strengths: run.strengths } : null,
      issues, drills, qualityPassed: clip.status === "ready",
      swingDetectionState: clip.swing_detection_state,
      currentFocus: computed.current?.concept ?? null,
      drillContext: { sport: team.sport === "baseball" || team.sport === "softball" ? team.sport : null, age } });
    if (report.state === "unreadable" && clip.status === "failed") report.reason = plainFailureReason(clip.error_message);
    const { data: deleting, error: deletingError } = await service.from("clip_deletions")
      .select("clip_id").eq("clip_id", clipId).limit(1);
    if (deletingError || deleting?.length) return notFound();
    const bucket = Deno.env.get("GCS_BUCKET_NAME") ?? "";
    const object = opaqueRawObject(clip.raw_gcs_path, bucket, clip.game_log_entry_id, clip.clip_slug, clip.id);
    let videoUrl: string | null = null;
    if (object && clip.status === "ready") {
      const emulator = Deno.env.get("GCS_EMULATOR_HOST");
      if (emulator) videoUrl = `${emulator}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
      else {
        const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
        [videoUrl] = await storage.bucket(bucket).file(object).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });
      }
    }
    const { data: phases, error: phaseError } = await service.from("swing_phases")
      .select("time_s, swing_phase_types!inner(slug)").eq("video_clip_id", clipId)
      .eq("swing_phase_types.slug", "contact").limit(1);
    if (phaseError) throw phaseError;
    const contactTime = phases?.[0]?.time_s ?? null;
    if (shared && report.state === "ready") {
      report.summary = sharedText(report.summary);
      report.strengths = report.strengths.map(sharedText);
      if (report.fix) {
        report.fix.issue = sharedText(report.fix.issue);
        report.fix.evidence = sharedText(report.fix.evidence);
        report.fix.coachingCue = sharedText(report.fix.coachingCue);
        report.fix.lookForNext = sharedText(report.fix.lookForNext);
      }
      report.drills = report.drills.map((drill) => ({ ...drill,
        name: sharedText(drill.name), bestFor: sharedText(drill.bestFor),
        instructions: sharedText(drill.instructions), cue: drill.cue ? sharedText(drill.cue) : drill.cue,
        looksRightWhen: drill.looksRightWhen ? sharedText(drill.looksRightWhen) : drill.looksRightWhen,
        commonMistakes: drill.commonMistakes.map(sharedText), sourceCredit: drill.sourceCredit ? sharedText(drill.sourceCredit) : drill.sourceCredit,
      }));
    }
    return reply({ playerId, playerName: identity, clipId, entryId: clip.game_log_entry_id,
      ...(shared ? {} : { entryClipIds: (entryClips ?? []).map((row) => row.id) }), report, status: clip.status,
      videoUrl, contactTime, ...(shared ? {} : { progress }) });
  } catch (error) {
    console.error("get-simplified-report:", error);
    return reply({ error: "Couldn't load the report. Please try again." }, 500);
  }
});
