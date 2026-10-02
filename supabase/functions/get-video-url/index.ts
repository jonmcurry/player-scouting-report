// Authenticated, short-lived read URL for an existing private raw clip.
//
// Coach path (unchanged): the clip row is read with the caller's JWT, so RLS
// (coach_rw_own_team) decides.
// Guardian path (parent pathway): a guardian has no table grant, so that read
// returns nothing. Then:
//   1. guardian_can_view_clip(clip) with the caller's JWT - identity only:
//      is the caller a linked guardian of the clip's player? No -> 403.
//   2. Service role loads the clip and its findings; clipReviewState() (the
//      coach page's rule, _shared/clipReviewState.ts) must be 'reviewed' or
//      'analyzed', else 403. Never authorized by clip status alone.
//   3. A clip whose deletion has started (clip_deletions row) -> 404.
//   4. The stored path must be this player's own raw object
//      (gs://<bucket>/<team>/<player>/raw/<file>) - raw_gcs_path is
//      client-written on the coach path, so it is never trusted to point at
//      another player's footage. Otherwise 404.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Storage } from "npm:@google-cloud/storage@7";
import { clipReviewState } from "../_shared/clipReviewState.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
function parseGs(value:string){const m=value.match(/^gs:\/\/([^/]+)\/(.+)$/);if(!m)throw new Error("Invalid private object path");return {bucket:m[1],object:m[2]};}
async function signedUrl(rawPath:string){
  const {bucket,object}=parseGs(rawPath);const emulator=Deno.env.get("GCS_EMULATOR_HOST");
  if(emulator)return reply({url:`${emulator}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`,expiresInSeconds:900});
  const storage=new Storage({projectId:Deno.env.get("GCP_PROJECT_ID")});const [url]=await storage.bucket(bucket).file(object).getSignedUrl({version:"v4",action:"read",expires:Date.now()+15*60*1000});
  return reply({url,expiresInSeconds:900});
}
type GuardianClip={status:string;raw_gcs_path:string|null;game_log_entries:{players:{slug:string;teams:{slug:string}}}};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {videoClipId}=await req.json();const auth=req.headers.get("Authorization");if(!auth)return reply({error:"Missing authorization"},401);
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data,error}=await db.from("video_clips").select("raw_gcs_path").eq("id",videoClipId).single();
    if(!error&&data){
      if(!data.raw_gcs_path)return reply({error:"Clip not found or inaccessible"},404);
      return await signedUrl(data.raw_gcs_path);
    }

    // Guardian path.
    const forbidden=()=>reply({error:"This video isn't available."},403);
    const {data:canView,error:canViewError}=await db.rpc("guardian_can_view_clip",{p_clip_id:videoClipId});
    if(canViewError||canView!==true)return forbidden();
    const service=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const [clipRes,runsRes,findingsRes,deletingRes]=await Promise.all([
      service.from("video_clips").select("status, raw_gcs_path, game_log_entries!inner(players!inner(slug, teams!inner(slug)))").eq("id",videoClipId).single(),
      service.from("analysis_runs").select("id").eq("video_clip_id",videoClipId).limit(1),
      service.from("issues").select("review_status").eq("video_clip_id",videoClipId),
      service.from("clip_deletions").select("clip_id").eq("clip_id",videoClipId).limit(1),
    ]);
    if(clipRes.error||runsRes.error||findingsRes.error||deletingRes.error||!clipRes.data)return forbidden();
    // Deletion already started (delete-clip wrote the audit row): never serve it.
    if((deletingRes.data??[]).length>0)return reply({error:"Clip not found or inaccessible"},404);
    const clip=clipRes.data as unknown as GuardianClip;
    const state=clipReviewState({status:clip.status,analyzed:(runsRes.data??[]).length>0},findingsRes.data);
    if(state!=="reviewed"&&state!=="analyzed")return forbidden();
    const bucket=Deno.env.get("GCS_BUCKET_NAME")??"";
    const prefix=`gs://${bucket}/${clip.game_log_entries.players.teams.slug}/${clip.game_log_entries.players.slug}/raw/`;
    const rest=clip.raw_gcs_path?.startsWith(prefix)?clip.raw_gcs_path.slice(prefix.length):"";
    if(!bucket||!rest||rest.includes("/"))return reply({error:"Clip not found or inaccessible"},404);
    return await signedUrl(clip.raw_gcs_path!);
  }catch(e){return reply({error:String(e)},500);}
});
