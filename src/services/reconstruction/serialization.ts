import { ANIMATION_FORMAT_VERSION, COORDINATE_SYSTEM, PIPELINE_VERSION, SKELETON_VERSION, type ReconstructionAnimation } from "./types.js";
export function validateAnimation(a: ReconstructionAnimation): void {
  if(a.formatVersion!==ANIMATION_FORMAT_VERSION) throw new Error(`Unsupported animation format ${a.formatVersion}`);
  if(a.coordinateSystem!==COORDINATE_SYSTEM) throw new Error(`Unexpected coordinate system ${a.coordinateSystem}`);
  if(a.fps<=0 || a.duration<0) throw new Error("Invalid animation timeline");
  for(let i=1;i<a.frames.length;i++) if(a.frames[i]!.t<a.frames[i-1]!.t) throw new Error("Animation timestamps must be monotonic");
}
export function newAnimation(fps:number): ReconstructionAnimation {
  return {formatVersion:ANIMATION_FORMAT_VERSION,fps,duration:0,coordinateSystem:COORDINATE_SYSTEM,skeletonVersion:SKELETON_VERSION,pipelineVersion:PIPELINE_VERSION,frames:[]};
}
