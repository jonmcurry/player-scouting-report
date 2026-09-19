import type { Vec3 } from "./types.js";

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const median = (xs: number[]) => { const s=[...xs].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]!:(s[m-1]!+s[m]!)/2; };

export function boneLengthVariance(frames: Vec3[][], bones: Array<[number, number]>): number {
  const cvs = bones.map(([a,b]) => {
    const lengths = frames.map((f) => dist(f[a]!, f[b]!));
    const mean = lengths.reduce((x,y)=>x+y,0) / Math.max(1,lengths.length);
    const variance = lengths.reduce((x,y)=>x+(y-mean)**2,0) / Math.max(1,lengths.length);
    return mean > 1e-9 ? Math.sqrt(variance)/mean : 0;
  });
  return cvs.reduce((a,b)=>a+b,0)/Math.max(1,cvs.length);
}

export function stabilizeBoneLengths(frames: Vec3[][], parentOf: Record<number, number>): Vec3[][] {
  if (!frames.length) return [];
  const target: Record<number, number> = {};
  for (const key of Object.keys(parentOf)) {
    const child=Number(key), parent=parentOf[child]!;
    target[child]=median(frames.map((f)=>dist(f[child]!,f[parent]!)));
  }
  const last: Record<number, Vec3> = {};
  return frames.map((source) => {
    const out=source.map((p)=>[...p] as Vec3);
    for (const key of Object.keys(parentOf).sort((a,b)=>Number(a)-Number(b))) {
      const child=Number(key), parent=parentOf[child]!;
      const d:[number,number,number]=[source[child]![0]-source[parent]![0],source[child]![1]-source[parent]![1],source[child]![2]-source[parent]![2]];
      const n=Math.hypot(...d);
      const u:Vec3=n>1e-8?[d[0]/n,d[1]/n,d[2]/n]:(last[child]??[0,-1,0]); last[child]=u;
      out[child]=[out[parent]![0]+u[0]*target[child]!,out[parent]![1]+u[1]*target[child]!,out[parent]![2]+u[2]*target[child]!];
    }
    return out;
  });
}

/** Locks only low-velocity planted intervals by translating the body root; moving/stride frames remain untouched. */
export function lockPlantedFoot(frames: Vec3[][], footIndex: number, velocityThreshold = 0.012, minPlantFrames = 4): Vec3[][] {
  const out=frames.map((f)=>f.map((p)=>[...p] as Vec3));
  let start=-1;
  for(let i=1;i<=frames.length;i++){
    const slow=i<frames.length && dist(frames[i]![footIndex]!,frames[i-1]![footIndex]!)<=velocityThreshold;
    if(slow && start<0) start=i-1;
    if((!slow || i===frames.length) && start>=0){
      const end=i-1;
      if(end-start+1>=minPlantFrames){
        const anchor=frames[start]![footIndex]!;
        for(let f=start;f<=end;f++){
          const foot=out[f]![footIndex]!; const delta:Vec3=[anchor[0]-foot[0],0,anchor[2]-foot[2]];
          out[f]=out[f]!.map((p)=>[p[0]+delta[0],p[1],p[2]+delta[2]] as Vec3);
        }
      }
      start=-1;
    }
  }
  return out;
}

export function footSlidingScore(frames: Vec3[][], footIndex: number, velocityThreshold = 0.012): number {
  let distance=0, samples=0;
  for(let i=1;i<frames.length;i++) { const d=dist(frames[i]![footIndex]!,frames[i-1]![footIndex]!); if(d<=velocityThreshold*3){distance+=d;samples++;} }
  return samples ? distance/samples : 0;
}
