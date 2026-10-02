// Edge Function: really deletes a clip - for a coach of the clip's team, or
// for the guardian who uploaded it (parent pathway). Replaces the coach app's
// old row-only `delete from video_clips`, which left the raw video in GCS, the
// worker's derived files, and the unreviewed AI drafts behind.
//
// Order (supabase/migrations/00043_clip_deletion.sql); every step is
// idempotent, so a retry after a partial failure finishes the job:
//   1. can_delete_clip() with the CALLER's JWT -> 403 if false.
//   2-4. begin_clip_deletion() (service role, one transaction): refuses a clip
//        that is in a stored demo fixture (and every clip while any stored
//        fixture is in a shape it can't check), or whose raw_gcs_path is not this
//        clip's own <team>/<player>/raw/ object (409, nothing changed); writes
//        the clip_deletions audit row (on conflict do nothing); deletes draft
//        issues and the AI output of the clip's analysis runs; records which
//        reviewed findings lose their video.
//   5. Deletes the GCS object (already-absent counts as deleted).
//   6. finish_clip_deletion(): stamps gcs_deleted_at, deletes the video_clips
//      row (cascades phases, pose3d frames, metrics). Reviewed issues and
//      observations keep their text; their clip link becomes null.
// The worker (src/cli/purgeDeletedClips.ts) removes frames/<player>/<clip>/.
//
// Local dev: fake-gcs-server's JSON API takes an unauthenticated
// `DELETE /storage/v1/b/{bucket}/o/{object}` (GCS_EMULATOR_HOST). Real GCS
// uses the client library's delete - unverified against real GCP credentials.

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

const IN_DEMO = "This swing is in the public demo — retire the demo version first";
const DEMO_UNREADABLE =
  "A stored public demo fixture couldn't be checked for this swing, so nothing was deleted. The demo fixtures need a review first.";
const UNVERIFIED_PATH = "This video's storage location can't be verified, so it wasn't deleted. Nothing was changed.";

async function deleteObject(bucket: string, object: string): Promise<void> {
  const emulatorHost = Deno.env.get("GCS_EMULATOR_HOST");
  if (emulatorHost) {
    const res = await fetch(
      `${emulatorHost}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`,
      { method: "DELETE" },
    );
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${res.status})`);
    return;
  }
  const storage = new Storage({ projectId: Deno.env.get("GCP_PROJECT_ID") });
  await storage.bucket(bucket).file(object).delete({ ignoreNotFound: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clipId } = await req.json().catch(() => ({}));
    if (!clipId || typeof clipId !== "string") {
      return jsonResponse({ error: "clipId is required" }, 400);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }
    const forbidden = () => jsonResponse({ error: "You can't delete this clip" }, 403);

    // 1. As the caller.
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: allowed, error: allowedError } = await caller.rpc("can_delete_clip", { p_clip_id: clipId });
    if (allowedError || allowed !== true) return forbidden();
    const { data: userData, error: userError } = await caller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const userId = userData?.user?.id;
    if (userError || !userId) return forbidden();

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bucket = Deno.env.get("GCS_BUCKET_NAME") ?? "";

    // 2-4.
    const { data: begun, error: beginError } = await service.rpc("begin_clip_deletion", {
      p_clip_id: clipId,
      p_requested_by: userId,
      p_bucket: bucket,
    });
    if (beginError) {
      if (beginError.message.includes("clip_in_demo_fixture")) return jsonResponse({ error: IN_DEMO }, 409);
      if (beginError.message.includes("demo_fixture_unrecognized")) return jsonResponse({ error: DEMO_UNREADABLE }, 409);
      if (beginError.message.includes("unverified_storage_path")) return jsonResponse({ error: UNVERIFIED_PATH }, 409);
      if (beginError.message.includes("not allowed") || beginError.message.includes("clip not found")) return forbidden();
      return jsonResponse({ error: `Couldn't delete the clip: ${beginError.message}` }, 500);
    }

    // 5. begin_clip_deletion verified the path is gs://<bucket>/<team>/<player>/raw/<file>.
    const rawPath = (begun as { raw_gcs_path: string | null }).raw_gcs_path;
    if (rawPath) {
      const object = rawPath.slice(`gs://${bucket}/`.length);
      try {
        await deleteObject(bucket, object);
      } catch (err) {
        return jsonResponse({ error: `Couldn't delete the video file, please try again: ${String(err)}` }, 502);
      }
    }

    // 6.
    const { error: finishError } = await service.rpc("finish_clip_deletion", { p_clip_id: clipId });
    if (finishError) {
      return jsonResponse({ error: `Couldn't finish deleting the clip, please try again: ${finishError.message}` }, 500);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
