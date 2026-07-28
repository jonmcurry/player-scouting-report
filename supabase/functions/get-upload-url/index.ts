// Edge Function: authorizes + mints a destination for a coach to upload a
// RAW video clip straight from their browser, for this project's "browser
// upload + automatic processing" feature (Supabase client scoped to the
// CALLING coach's own JWT, so RLS enforces access - no service-role
// bypass).
//
// This function does NOT touch any bytes and does NOT write to video_clips -
// it only authorizes the request and returns where to PUT/POST the file.
// The browser does the actual upload (a direct fetch to the returned URL),
// then inserts the video_clips row itself (RLS-protected the same as every
// other coach write in this app) - see coach/components/videoUpload.js.
//
// Access control: teamSlug/playerSlug are derived SERVER-SIDE from the
// caller-supplied gameLogEntryId via a join that only succeeds if RLS
// allows it (coach_rw_own_team on game_log_entries, joined through
// players/teams) - never trusted from client input directly ("let RLS
// decide" rather than trusting a client-supplied slug).
//
// Local-dev fallback: fake-gcs-server's simple-upload JSON API endpoint
// (`POST /upload/storage/v1/b/{bucket}/o?uploadType=media&name={object}`)
// accepts unsigned uploads with no auth and returns permissive CORS headers
// (Access-Control-Allow-Origin: *) - confirmed by a real browser fetch()
// test through Playwright, not assumed. Real GCS needs a genuine v4 signed
// PUT url instead (getSignedUrl, action:"write") - unverified against real
// GCP credentials.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Storage } from "npm:@google-cloud/storage@7";

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
    const { gameLogEntryId, clipSlug, ext, contentType } = await req.json();
    if (!gameLogEntryId || !clipSlug || !ext) {
      return jsonResponse({ error: "gameLogEntryId, clipSlug, and ext are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    // Scoped to the CALLING coach's own JWT - RLS is what actually enforces
    // access here.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: entry, error } = await supabase
      .from("game_log_entries")
      .select("id, players!inner(slug, teams!inner(slug))")
      .eq("id", gameLogEntryId)
      .single();

    if (error || !entry) {
      return jsonResponse({ error: "At-bat not found or not accessible" }, 404);
    }

    const teamSlug = (entry.players as unknown as { teams: { slug: string } }).teams.slug;
    const playerSlug = (entry.players as unknown as { slug: string }).slug;
    const bucketName = Deno.env.get("GCS_BUCKET_NAME")!;
    const destination = `${teamSlug}/${playerSlug}/raw/${clipSlug}${ext}`;
    const gcsPath = `gs://${bucketName}/${destination}`;
    const resolvedContentType = contentType || "video/mp4";

    const emulatorHost = Deno.env.get("GCS_EMULATOR_HOST");
    let uploadUrl: string;
    let method: string;
    if (emulatorHost) {
      uploadUrl =
        `${emulatorHost}/upload/storage/v1/b/${bucketName}/o` +
        `?uploadType=media&name=${encodeURIComponent(destination)}`;
      method = "POST";
    } else {
      const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
      const [signedUrl] = await storage
        .bucket(bucketName)
        .file(destination)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          contentType: resolvedContentType,
        });
      uploadUrl = signedUrl;
      method = "PUT";
    }

    return jsonResponse({ uploadUrl, method, gcsPath, contentType: resolvedContentType });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
