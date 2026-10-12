#!/usr/bin/env node
/** Candidate import only. Human decisions are made separately with approve_drill. */
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCandidateDrills, type CandidateDrillRecord } from "../services/development/drillCandidateParser.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

export function candidatePayload(d: CandidateDrillRecord) {
  return {
    team_id: null,
    slug: d.slug,
    name: d.name,
    purpose: d.bestFor,
    best_for: d.bestFor,
    target_tags: d.targetTags,
    instructions: d.instructions,
    equipment: d.equipment,
    age_notes: d.ageNotes,
    min_age: d.minAge,
    cue: d.cue,
    looks_right_when: d.looksRightWhen,
    common_mistakes: d.commonMistakes,
    home_friendly: d.homeFriendly,
    sport: d.sport,
    demo_url: d.demoUrl,
    demo_timestamp: d.demoTimestamp,
    source_credit: d.sourceCredit,
    requires_screen: d.requiresScreen,
    weighted_or_overspeed: d.weightedOrOverspeed,
    curation_status: "draft",
    curated_at: null,
    curated_by: null,
    is_active: true,
  };
}

export function generateDrillSql(drills: CandidateDrillRecord[]): string {
  const literal = (value: unknown): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) return `ARRAY[${value.map(literal).join(", ")}]::text[]`;
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return "E'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  };
  if (!drills.length) throw new Error("No candidates supplied");
  const rows = drills.map(candidatePayload);
  const columns = Object.keys(rows[0]!);
  const contentColumns = columns.filter(c => !["team_id", "slug", "curation_status", "curated_at", "curated_by"].includes(c));
  return "-- Draft candidates only. Existing reviewed rows and their content are preserved.\n" +
    ["public", "demo"].map(schema => `INSERT INTO ${schema}.drill_library (${columns.join(", ")}) VALUES\n` +
      rows.map(row => `(${Object.values(row).map(literal).join(", ")})`).join(",\n") +
      `\nON CONFLICT (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), slug) DO UPDATE SET\n` +
      contentColumns.map(c => `${c} = excluded.${c}`).join(",\n") +
      `\nWHERE ${schema}.drill_library.curation_status = 'draft';\n`).join("\n");
}

export async function applyCandidates(db: SupabaseClient, drills: CandidateDrillRecord[]) {
  for (const schema of ["public", "demo"] as const) {
    for (const drill of drills) {
      const payload = candidatePayload(drill);
      const table = () => db.schema(schema).from("drill_library");
      const { data: existing, error: lookupError } = await table().select("id").is("team_id", null).eq("slug", drill.slug).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) {
        const { error } = await table().insert(payload);
        if (!error) continue;
        // Concurrent insert: retry only as a conditional draft update.
        if (error.code !== "23505") throw error;
      }
      const { curation_status, curated_at, curated_by, ...content } = payload;
      const { error } = await table().update(content).is("team_id", null).eq("slug", drill.slug).eq("curation_status", "draft");
      if (error) throw error;
    }
  }
}

export async function importCuratedDrills(opts: { dryRun?: boolean; apply?: boolean; sql?: boolean }): Promise<void> {
  const drills = loadCandidateDrills();
  if (opts.sql) { process.stdout.write(generateDrillSql(drills)); return; }
  console.log(`Parsed ${drills.length} draft candidates; ${drills.filter(d => d.requiresScreen).length} require screens; ${drills.filter(d => d.weightedOrOverspeed).length} restricted to age 13+.`);
  if (opts.dryRun || !opts.apply) { console.log("Dry run. Use --apply to import drafts or --sql to generate SQL."); return; }
  await applyCandidates(getSupabaseClient(), drills);
  console.log("Draft import complete in public and demo. Reviewed records were preserved.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  new Command().name("import-curated-drills").description("Import draft drill candidates; never approve")
    .option("--dry-run", "Validate without writes").option("--apply", "Import drafts").option("--sql", "Print draft-only SQL")
    .action(async opts => { try { await importCuratedDrills(opts); } catch (error) { console.error(error); process.exitCode = 1; } }).parse();
}
