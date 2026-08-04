// Edge Function: serves a read-only player report to an anonymous visitor
// holding a real share-link token (coach/report.html) - the only place in
// this codebase that intentionally reads player data with NO caller
// session, using the service_role key internally after validating the
// token. Deliberately not a table/RPC anon grant (see
// 00019_player_share_links.sql's comment) - this function is the entire
// public-read boundary, so it returns only what a report genuinely needs:
// no internal ids, no ai_draft/notes/source, no video/clip data.

import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { token } = await req.json();
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
      .select("player_id, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link || link.revoked_at) {
      return jsonResponse({ error: "This link is invalid or has been revoked." }, 404);
    }

    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("name, jersey_number, teams!inner(name)")
      .eq("id", link.player_id)
      .single();
    if (playerError || !player) {
      return jsonResponse({ error: "Player not found." }, 404);
    }

    const { data: scores } = await supabase
      .from("checklist_scores")
      .select("score, reviewed_by, checkpoints!inner(label, sort_order)")
      .eq("player_id", link.player_id)
      .order("sort_order", { referencedTable: "checkpoints" });

    const { count: loggedAtBats } = await supabase
      .from("game_log_entries")
      .select("id", { count: "exact", head: true })
      .eq("player_id", link.player_id)
      .eq("session_type", "game");

    return jsonResponse({
      playerName: player.name,
      jerseyNumber: player.jersey_number,
      teamName: (player.teams as unknown as { name: string }).name,
      loggedAtBats: loggedAtBats ?? 0,
      checkpoints: (scores ?? []).map((s) => ({
        label: (s.checkpoints as unknown as { label: string }).label,
        score: s.score,
        reviewedBy: s.reviewed_by,
      })),
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
