// Edge Function: the family (guardian) read surface. A linked guardian reads
// ONLY what the coach has confirmed about their own child, plus that child's
// clip statuses - never AI drafts, notes, sources or analysis metrics.
//
// Guardians have no table grants on development data (00041); this function
// is their only read path:
//   1. is_guardian_for_player(playerId) with the CALLER's JWT -> 404 if false
//      (same answer for "not linked" and "no such player": nothing to leak).
//   2. buildFamilyReport() with the service role (_shared/familyReport.ts):
//      the share-link report payload plus `clips` (with uploadedByYou /
//      deleteUnfinished for the verified caller) and `findings`.
// Videos are fetched separately through get-video-url, which re-checks the
// guardian link and the clip's review state on every request.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildFamilyReport } from "../_shared/familyReport.ts";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }
    const notFound = () => jsonResponse({ error: "Player not found." }, 404);
    const { playerId } = await req.json().catch(() => ({}));
    if (!playerId || typeof playerId !== "string" || !UUID.test(playerId)) return notFound();

    // 1. As the caller.
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: linked, error: linkedError } = await caller.rpc("is_guardian_for_player", { target_player_id: playerId });
    if (linkedError || linked !== true) return notFound();
    // The viewer's id comes from the verified JWT - never from the request body.
    const { data: userData, error: userError } = await caller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const viewerUserId = userData?.user?.id;
    if (userError || !viewerUserId) return notFound();

    // 2. Service role - the caller is authorized for exactly this player.
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const report = await buildFamilyReport(service, playerId, { includeVideoIds: true, viewerUserId });
    if (!report) return notFound();
    return jsonResponse(report);
  } catch (err) {
    // Fail closed, without echoing internal query errors to a family.
    console.error("get-family-report:", err);
    return jsonResponse({ error: "Couldn't load the report. Please try again." }, 500);
  }
});
