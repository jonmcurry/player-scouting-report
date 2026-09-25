// Edge Function: serves a read-only player report to an anonymous visitor
// holding a real share-link token (coach/report.html) - the only place in
// this codebase that intentionally reads player data with NO caller
// session, using the service_role key internally after validating the
// token. Deliberately not a table/RPC anon grant (see
// 00019_player_share_links.sql's comment) - this function is the entire
// public-read boundary, so it returns only what a report genuinely needs:
// no ai_draft/notes/source, no internal metrics. Priorities/drills/progress are coach-authored
// only (shape.ts is the whitelist); video is served only for clips a coach linked as evidence.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Storage } from "npm:@google-cloud/storage@7";
import { shapePlayerReport } from "./shape.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, videoClipId } = await req.json();
    if (!token || typeof token !== "string") {
      return jsonResponse({ error: "token is required" }, 400);
    }

    // service_role - intentional, this request has no user session to
    // scope RLS to. The token itself is the entire authorization boundary.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link, error: linkError } = await supabase
      .from("player_share_links")
      .select("player_id, revoked_at, expires_at")
      .eq("token", token)
      .maybeSingle();

    // Same generic message for revoked/expired/never-existed - deliberately
    // not distinguishing them to an anonymous caller (no reason to leak
    // which case applies).
    if (linkError || !link || link.revoked_at || new Date(link.expires_at) < new Date()) {
      return jsonResponse({ error: "This link is invalid or has been revoked." }, 404);
    }

    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("name, jersey_number, what_to_check_next, teams!inner(name)")
      .eq("id", link.player_id)
      .single();
    if (playerError || !player) {
      return jsonResponse({ error: "Player not found." }, 404);
    }

    // Signed video URL for a clip - only when a coach linked it as evidence on one of this
    // player's visible priorities. The token alone is not enough to fetch arbitrary clips.
    if (videoClipId) {
      const { data: obs } = await supabase
        .from("player_priority_observations")
        .select("video_clip_id, player_priorities!inner(player_id, status)")
        .eq("video_clip_id", videoClipId)
        .eq("player_priorities.player_id", link.player_id)
        .neq("player_priorities.status", "archived")
        .limit(1);
      if (!obs?.length) return jsonResponse({ error: "Clip not available." }, 404);
      const { data: clip } = await supabase.from("video_clips").select("raw_gcs_path").eq("id", videoClipId).single();
      const m = clip?.raw_gcs_path?.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (!m) return jsonResponse({ error: "Clip not available." }, 404);
      const emulator = Deno.env.get("GCS_EMULATOR_HOST");
      if (emulator) return jsonResponse({ url: `${emulator}/download/storage/v1/b/${encodeURIComponent(m[1])}/o/${encodeURIComponent(m[2])}?alt=media` });
      const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
      const [url] = await storage.bucket(m[1]).file(m[2]).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });
      return jsonResponse({ url });
    }

    const { data: scores } = await supabase
      .from("checklist_scores")
      .select("score, reviewed_by, review_status, checkpoints!inner(label, sort_order)")
      .eq("player_id", link.player_id)
      .order("sort_order", { referencedTable: "checkpoints" });

    const { count: loggedAtBats } = await supabase
      .from("game_log_entries")
      .select("id", { count: "exact", head: true })
      .eq("player_id", link.player_id)
      .eq("session_type", "game");

    const { data: priorities } = await supabase
      .from("player_priorities")
      .select("id, title, description, status, priority_order, first_identified_at, resolved_at, follow_up_kind, follow_up_date, follow_up_swings")
      .eq("player_id", link.player_id)
      .neq("status", "archived");
    const ids = (priorities ?? []).map((p) => p.id);
    const [{ data: drills }, { data: observations }] = ids.length
      ? await Promise.all([
          supabase.from("player_priority_drills").select("player_priority_id, active, coach_note, assigned_at, drill_library(name, purpose, instructions, equipment)").in("player_priority_id", ids).order("assigned_at", { ascending: false }),
          supabase.from("player_priority_observations").select("player_priority_id, status, coach_note, observed_at, video_clip_id, phase").in("player_priority_id", ids),
        ])
      : [{ data: [] }, { data: [] }];

    return jsonResponse(
      shapePlayerReport({
        player: { name: player.name, jersey_number: player.jersey_number, teamName: (player.teams as unknown as { name: string }).name, whatToCheckNext: player.what_to_check_next },
        // deno-lint-ignore no-explicit-any
        scores: (scores ?? []) as any,
        priorities: priorities ?? [],
        // deno-lint-ignore no-explicit-any
        drills: (drills ?? []) as any,
        observations: observations ?? [],
        loggedAtBats: loggedAtBats ?? 0,
      }),
    );
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
