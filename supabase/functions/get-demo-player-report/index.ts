// Edge Function: demo-mode counterpart to ../get-player-report/index.ts.
// coach/report.html calls THIS function instead of get-player-report
// whenever isDemoMode() is true (see report.html's own comment) - the one
// and only difference is every query below targets the isolated `demo`
// Postgres schema (temporary same-project demo architecture - see
// docs/research/demo-shared-project-architecture.md) instead of `public`.
// get-player-report itself is completely untouched by this file - the
// production report path is not weakened or shared with this one in any
// way, including its own service-role client instance.
//
// Same token-based, no-caller-session, service-role-internal design as
// get-player-report (the token IS the entire authorization boundary - see
// that file's header). video is always reported "unavailable": every demo
// clip's raw_gcs_path is null by design (no real footage is ever stored
// for the public demo - see 00033_demo_phase4_schema.sql's header), so
// this function never attempts a GCS signed-URL lookup at all, unlike
// get-player-report - there is deliberately no video-serving branch here.

import { createClient } from "npm:@supabase/supabase-js@2";
import { shapePlayerReport } from "../get-player-report/shape.ts";

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

    // service_role - same rationale as get-player-report: no caller session
    // to scope RLS to, the token is the entire boundary. Every call below
    // is schema-qualified to "demo" explicitly (.schema("demo")) - never
    // relies on a default/ambient schema, so this can never accidentally
    // read or write public.* production data.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ).schema("demo");

    const { data: link, error: linkError } = await supabase
      .from("player_share_links")
      .select("player_id, revoked_at, expires_at")
      .eq("token", token)
      .maybeSingle();

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

    // No real footage is ever stored for the demo - every clip's
    // raw_gcs_path is null by design, so this always reports "not
    // available" rather than attempting (and always failing) a GCS
    // lookup. Matches the real get-video-url/report.html empty state.
    if (videoClipId) {
      return jsonResponse({ error: "Clip not available." }, 404);
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
