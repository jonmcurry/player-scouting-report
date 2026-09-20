#!/usr/bin/env node
/** Repeatable private validation runner. Videos/outputs remain gitignored. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface BatchItem { videoId:string; filename:string; inputPath:string; outputDir:string; status:string; error?:string }
const inputDir=path.resolve(process.argv[2] ?? "videos/game1");
const force=process.argv.includes("--force");
const python=path.resolve(".venv_pose3d/Scripts/python.exe");
const pipeline=path.resolve("scripts/pose3d/run_pipeline.py");
const diagnostics=path.resolve("scripts/pose3d/validation_artifacts.py");
const batchRoot=path.resolve("frames/validation/game1");

function run(command:string,args:string[]) { return new Promise<void>((resolve,reject)=>{
  const child=spawn(command,args,{stdio:"inherit",env:{...process.env,PYTHONUNBUFFERED:"1"}});
  child.on("error",reject); child.on("close",code=>code===0?resolve():reject(new Error(`${path.basename(command)} exited ${code}`)));
}); }
function sha256File(p:string){ const h=createHash("sha256"); h.update(fs.readFileSync(p)); return h.digest("hex"); }

async function main(){
  fs.mkdirSync(batchRoot,{recursive:true});
  const all=fs.readdirSync(inputDir).filter(n=>/\.mp4$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  // A full-game source is not one of the five labelled swing clips. It can be included explicitly via a manifest later.
  const files=all.filter(n=>!/_game\d*/i.test(n));
  if(files.length!==5) throw new Error(`Expected five labelled swing clips after excluding *_game* source files; found ${files.length}: ${files.join(", ")}`);
  console.log(`[validation] processing ${files.length} clips; excluded source files: ${all.filter(n=>!files.includes(n)).join(", ") || "none"}`);
  const results:BatchItem[]=[];
  for(const filename of files){
    const inputPath=path.join(inputDir,filename); const hash=sha256File(inputPath); const videoId=`val-${hash.slice(0,16)}`;
    const outputDir=path.join(batchRoot,videoId); fs.mkdirSync(outputDir,{recursive:true});
    const item:BatchItem={videoId,filename,inputPath,outputDir,status:"processing"}; results.push(item);
    try{
      if(force || !fs.existsSync(path.join(outputDir,"pipeline_status.json"))) await run(python,[pipeline,inputPath,outputDir]);
      await run(python,[diagnostics,inputPath,outputDir,videoId,filename,hash]);
      const status=JSON.parse(fs.readFileSync(path.join(outputDir,"pipeline_status.json"),"utf8"));
      item.status=status.status === "complete" ? "complete" : "failed";
      if(item.status!=="complete") item.error=JSON.stringify(status.detail);
    }catch(error){ item.status="failed"; item.error=error instanceof Error?error.message:String(error); }
    fs.writeFileSync(path.join(batchRoot,"batch-progress.json"),JSON.stringify(results,null,2));
  }
  const summaries=results.map(r=>{ const p=path.join(r.outputDir,"validation-result.json"); return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{video_id:r.videoId,filename:r.filename,errors:[r.error??"missing validation result"]}; });
  fs.writeFileSync(path.join(batchRoot,"validation-summary.json"),JSON.stringify({generated_at:new Date().toISOString(),pipeline_version:"barreltrace-reconstruction-v1",videos:summaries},null,2));
  console.table(summaries.map((s:any)=>({file:s.filename,pose:`${(100*(s.pose_coverage??0)).toFixed(1)}%`,bat:`${(100*(s.bat_track_coverage??0)).toFixed(1)}%`,"3d":`${(100*(s["3d_pose_coverage"]??0)).toFixed(1)}%`,quality:s.overall_reconstruction_quality,status:s["3d_reconstruction_status"]})));
  if(results.some(r=>r.status!=="complete")) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
