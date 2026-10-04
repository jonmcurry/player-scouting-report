export interface CuratedDrill {
  id: string; name: string; targetTags: string[]; bestFor: string; isActive: boolean;
  minAge: number | null; sport: "baseball" | "softball" | "both";
  homeFriendly: boolean; equipment: string; phase: string | null;
  requiresScreen: boolean; weightedOrOverspeed: boolean;
}
export interface DrillContext { concept: string; phase: string | null; sport: "baseball" | "softball" | null; age: number | null; previousDrillId?: string | null }
const normalized = (tag: string) => tag.toLowerCase().replaceAll("-", "_");

/** Returns only human-curated drills; unknown age is handled as under 13. */
export function selectDrills<T extends CuratedDrill>(drills: T[], context: DrillContext): T[] {
  const age = context.age ?? 12;
  if (!context.sport) return [];
  const eligible = drills.filter((drill) => drill.isActive && drill.bestFor.trim()
    && drill.targetTags.some((tag) => normalized(tag) === context.concept)
    && (drill.sport === "both" || drill.sport === context.sport)
    && (drill.minAge === null || age >= drill.minAge)
    && !(age < 13 && drill.weightedOrOverspeed)
    && !drill.requiresScreen);
  eligible.sort((a, b) => Number(b.id === context.previousDrillId) - Number(a.id === context.previousDrillId)
    || Number(b.phase === context.phase) - Number(a.phase === context.phase)
    || Number(b.homeFriendly) - Number(a.homeFriendly)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const chosen: T[] = [];
  for (const drill of eligible) {
    if (chosen.length === 3) break;
    const equipmentGroup = normalized(drill.equipment.split(/[;,]/)[0] ?? "");
    if (chosen.some((item) => normalized(item.equipment.split(/[;,]/)[0] ?? "") === equipmentGroup)) continue;
    chosen.push(drill);
  }
  for (const drill of eligible) {
    if (chosen.length === 3) break;
    if (!chosen.includes(drill)) chosen.push(drill);
  }
  return chosen;
}
