// Authenticated, short-lived read URL for an existing private raw clip.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Storage } from "npm:@google-cloud/storage@7";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
function parseGs(value:string){const m=value.match(/^gs:\/\/([^/]+)\/(.+)$/);if(!m)throw new Error("Invalid private object path");return {bucket:m[1],object:m[2]};}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {videoClipId}=await req.json();const auth=req.headers.get("Authorization");if(!auth)return reply({error:"Missing authorization"},401);
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data,error}=await db.from("video_clips").select("raw_gcs_path").eq("id",videoClipId).single();
    if(error||!data?.raw_gcs_path)return reply({error:"Clip not found or inaccessible"},404);
    const {bucket,object}=parseGs(data.raw_gcs_path);const emulator=Deno.env.get("GCS_EMULATOR_HOST");
    if(emulator)return reply({url:`${emulator}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`,expiresInSeconds:900});
    const storage=new Storage({projectId:Deno.env.get("GCP_PROJECT_ID")});const [url]=await storage.bucket(bucket).file(object).getSignedUrl({version:"v4",action:"read",expires:Date.now()+15*60*1000});
    return reply({url,expiresInSeconds:900});
  }catch(e){return reply({error:String(e)},500);}
});
