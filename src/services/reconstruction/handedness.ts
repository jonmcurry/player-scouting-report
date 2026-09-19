export type Handedness = "left" | "right" | "unknown";
export function inferHandedness(votes: Array<{ side: Exclude<Handedness,"unknown">; confidence: number }>, override?: Handedness) {
  if (override && override !== "unknown") return { handedness: override, confidence: 1, method: "coach_override" };
  const left=votes.filter(v=>v.side==="left").reduce((s,v)=>s+v.confidence,0);
  const right=votes.filter(v=>v.side==="right").reduce((s,v)=>s+v.confidence,0);
  const total=left+right;
  if(total<0.5) return { handedness:"unknown" as const, confidence:0, method:"insufficient_evidence" };
  return { handedness:(left>right?"left":"right") as Exclude<Handedness,"unknown">, confidence:Math.abs(left-right)/total, method:"weighted_stance_hands_bat" };
}
