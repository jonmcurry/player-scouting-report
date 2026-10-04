// Edge Function: authorizes + mints a destination for a coach - or a linked
// guardian (00041/00042) - to upload a RAW video clip straight from their
// browser, for this project's "browser upload + automatic processing"
// feature.
//
// This function does NOT touch any bytes and does NOT write to video_clips -
// it only authorizes the request and returns where to PUT/POST the file.
// The browser does the actual upload (a direct fetch to the returned URL),
// then records the clip itself: a coach inserts the video_clips row
// (RLS-protected), a guardian calls the guardian_register_clip RPC - see
// coach/components/videoUpload.js.
//
// Access control: the caller's own JWT must pass can_upload_for_entry()
// (coach of the entry's team, or guardian of the entry's player). Only then
// is the entry resolved - with the service-role client, since guardians have
// no table access. The object name contains only the entry and clip UUIDs.
//
// Local-dev fallback: fake-gcs-server's simple-upload JSON API endpoint
// (`POST /upload/storage/v1/b/{bucket}/o?uploadType=media&name={object}`)
// accepts unsigned uploads with no auth and returns permissive CORS headers
// (Access-Control-Allow-Origin: *) - confirmed by a real browser fetch()
// test through Playwright, not assumed. Real GCS needs a genuine v4 signed
// PUT url instead (getSignedUrl, action:"write") - unverified against real
// GCP credentials.
//
// Guardian branch (caller is NOT a coach of the entry's team, so
// can_upload_for_entry passed as a linked guardian). Before minting, it
// enforces what guardian_register_clip enforces afterwards, so a guardian
// can't get a writable URL for anything the RPC would refuse:
//   * clipSlug is a UUID and ext is ^\.[A-Za-z0-9]{1,10}$ (400);
//   * the per-guardian quota (10 registered clips per rolling 24h) - a
//     read-only check here (429); guardian_register_clip still records the
//     event and re-checks under its lock;
//   * no overwrite: an object already at that name -> 409 (checked with the
//     service-role GCS client), and the minted URL itself carries a
//     create-only precondition so a race between check and upload can't
//     overwrite either: real GCS signs `x-goog-if-generation-match: 0` into
//     the v4 URL (returned in `headers`; the browser must send it - the
//     bucket's CORS config must allow that request header, see NEXT_STEPS
//     PRE-DEPLOY; unverified against real GCP); the emulator URL gets
//     `ifGenerationMatch=0` (fake-gcs-server answers 412 on an existing
//     object - verified locally).
// Coaches use the same create-only opaque destination.

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

// guardian_register_clip's limit (00042): 10 registered clips per guardian per rolling 24h.
const GUARDIAN_DAILY_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is there already an object at bucket/object? (service-role GCS client; the emulator's JSON API locally). */
async function objectExists(bucket: string, object: string, emulatorHost: string | undefined): Promise<boolean> {
  if (emulatorHost) {
    const res = await fetch(`${emulatorHost}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`);
    await res.body?.cancel();
    if (res.status === 404) return false;
    if (res.ok) return true;
    throw new Error(`storage check failed (${res.status})`);
  }
  const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
  const [exists] = await storage.bucket(bucket).file(object).exists();
  return exists;
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

    // Authorization runs as the CALLER (their own JWT): can_upload_for_entry
    // (00042) is true only for a coach of the entry's team or a linked
    // guardian of the entry's player. Guardians have no table access to
    // game_log_entries, so the entry is resolved with the service-role
    // client - but ONLY after that check passed.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const notAccessible = () => jsonResponse({ error: "At-bat not found or not accessible" }, 404);

    const { data: allowed, error: allowedError } = await supabase.rpc("can_upload_for_entry", {
      p_entry_id: gameLogEntryId,
    });
    if (allowedError || allowed !== true) {
      return notAccessible();
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: entry, error } = await serviceClient
      .from("game_log_entries")
      .select("id, players!inner(team_id)")
      .eq("id", gameLogEntryId)
      .single();

    if (error || !entry) {
      return notAccessible();
    }

    const teamId = (entry.players as unknown as { team_id: string }).team_id;
    const bucketName = Deno.env.get("GCS_BUCKET_NAME")!;
    const emulatorHost = Deno.env.get("GCS_EMULATOR_HOST");

    // Coach of the entry's team -> coach branch. Anyone else who
    // passed can_upload_for_entry is a linked guardian of the entry's player.
    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const userId = userData?.user?.id;
    if (userError || !userId) return notAccessible();
    const { data: coachRows, error: coachError } = await serviceClient
      .from("coach_team_access")
      .select("team_id")
      .eq("coach_id", userId)
      .eq("team_id", teamId)
      .limit(1);
    if (coachError) return jsonResponse({ error: "Couldn't check upload access" }, 500);
    const asGuardian = (coachRows ?? []).length === 0;

    // Both roles receive the same opaque path. A UUID clip slug is also the
    // worker's stable local directory key for retries.
    if (typeof clipSlug !== "string" || !UUID.test(clipSlug) || typeof ext !== "string" || !/^\.[A-Za-z0-9]{1,10}$/.test(ext)) {
        return jsonResponse({ error: "invalid clip slug or extension" }, 400);
    }
    const destination = `${gameLogEntryId}/raw/${clipSlug}${ext}`;
    const gcsPath = `gs://${bucketName}/${destination}`;
    const resolvedContentType = contentType || "video/mp4";

    const exists = await objectExists(bucketName, destination, emulatorHost);
    if (exists) {
      const { data: owned, error: ownershipError } = await supabase.rpc("has_simple_upload_reservation", {
        p_entry_id: gameLogEntryId, p_clip_slug: clipSlug, p_object_name: destination,
      });
      if (ownershipError) return jsonResponse({ error: "Couldn't check this upload" }, 500);
      if (owned !== true) return jsonResponse({ error: "A video with this name already exists" }, 409);
      return jsonResponse({ alreadyUploaded: true, gcsPath });
    }

    if (asGuardian) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error: quotaError } = await serviceClient
        .from("guardian_upload_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gt("created_at", since);
      if (quotaError) return jsonResponse({ error: "Couldn't check the upload limit" }, 500);
      if ((count ?? 0) >= GUARDIAN_DAILY_LIMIT) {
        return jsonResponse({ error: `rate limited: at most ${GUARDIAN_DAILY_LIMIT} uploads per day` }, 429);
      }
    }

    const { data: reserved, error: reservationError } = await supabase.rpc("reserve_simple_upload", {
      p_entry_id: gameLogEntryId, p_clip_slug: clipSlug, p_object_name: destination,
    });
    if (reservationError) return jsonResponse({ error: "Couldn't check the upload limit" }, 500);
    if (reserved !== true) return jsonResponse({ error: "At most 10 videos per day" }, 429);

    let uploadUrl: string;
    let method: string;
    let headers: Record<string, string> | undefined;
    if (emulatorHost) {
      uploadUrl =
        `${emulatorHost}/upload/storage/v1/b/${bucketName}/o` +
        `?uploadType=media&name=${encodeURIComponent(destination)}` +
        "&ifGenerationMatch=0";
      method = "POST";
    } else {
      const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
      const createOnly = { "x-goog-if-generation-match": "0" };
      const [signedUrl] = await storage
        .bucket(bucketName)
        .file(destination)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          contentType: resolvedContentType,
          extensionHeaders: createOnly,
        });
      uploadUrl = signedUrl;
      method = "PUT";
      headers = createOnly;
    }

    return jsonResponse({ uploadUrl, method, gcsPath, contentType: resolvedContentType, ...(headers ? { headers } : {}) });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
