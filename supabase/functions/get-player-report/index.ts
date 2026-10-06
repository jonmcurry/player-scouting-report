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
import { buildFamilyReport } from "../_shared/familyReport.ts";
import { opaqueRawObject } from "../_shared/opaqueStoragePath.ts";

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
      .select("player_id, created_by, revoked_at, expires_at, share_scope")
      .eq("token", token)
      .maybeSingle();

    // Same generic message for revoked/expired/never-existed - deliberately
    // not distinguishing them to an anonymous caller (no reason to leak
    // which case applies).
    if (linkError || !link || link.share_scope || link.revoked_at || new Date(link.expires_at) < new Date()) {
      return jsonResponse({ error: "This link is invalid or has been revoked." }, 404);
    }

    // Legacy links were coach-created. Removing that coach's team access must
    // also close their outstanding bearer links, including signed video reads.
    const { data: player, error: playerError } = await supabase.from("players")
      .select("team_id").eq("id", link.player_id).maybeSingle();
    if (playerError || !player) return jsonResponse({ error: "This link is invalid or has been revoked." }, 404);
    const { data: access, error: accessError } = await supabase.from("coach_team_access")
      .select("coach_id").eq("coach_id", link.created_by).eq("team_id", player.team_id).limit(1);
    if (accessError || !access?.length) return jsonResponse({ error: "This link is invalid or has been revoked." }, 404);

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
      const { data: deleting, error: deletingError } = await supabase.from("clip_deletions").select("clip_id").eq("clip_id", videoClipId).limit(1);
      if (deletingError || (deleting ?? []).length) return jsonResponse({ error: "Clip not available." }, 404);
      const { data: clip } = await supabase.from("video_clips").select("id, raw_gcs_path, game_log_entry_id, clip_slug").eq("id", videoClipId).single();
      const bucket = Deno.env.get("GCS_BUCKET_NAME") ?? "";
      const object = opaqueRawObject(clip?.raw_gcs_path ?? null, bucket, clip?.game_log_entry_id ?? "", clip?.clip_slug ?? "", clip?.id);
      if (!object) return jsonResponse({ error: "Clip not available." }, 404);
      const emulator = Deno.env.get("GCS_EMULATOR_HOST");
      if (emulator) return jsonResponse({ url: `${emulator}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media` });
      const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
      const [url] = await storage.bucket(bucket).file(object).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });
      return jsonResponse({ url });
    }

    // The family-report builder omits guardian-only sections and redacts
    // identity for this anonymous share link.
    const report = await buildFamilyReport(supabase, link.player_id, { includeVideoIds: false });
    if (!report) {
      return jsonResponse({ error: "Player not found." }, 404);
    }
    return jsonResponse(report);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
