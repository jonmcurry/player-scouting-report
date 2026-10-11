#!/usr/bin/env node
/**
 * Admin script: imports and approves the 90 watch-verified drill candidates
 * from docs/research/drill-library-candidates-v2.md into Supabase drill_library
 * and demo.drill_library.
 *
 * Enforces safety defaults:
 * - 21 safety-flagged drills (partner in path / near swing) get requires_screen = true and home_friendly = false.
 * - 7 age-flagged drills (weighted/overspeed implements) get weighted_or_overspeed = true and min_age = 13.
 *
 * Usage:
 *   npm run import-curated-drills -- --dry-run
 *   npm run import-curated-drills -- --apply
 *   npm run import-curated-drills -- --apply --curator-email coach@example.com
 *   npm run import-curated-drills -- --sql
 */
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { loadCandidateDrills, type CandidateDrillRecord } from "../services/development/drillCandidateParser.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

async function findCuratorUser(email?: string, id?: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (id) return id;

  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Listing auth users: ${error.message}`);
    if (email) {
      const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (match) return match.id;
    } else if (data.users.length > 0) {
      return data.users[0]!.id;
    }
    if (data.users.length < 200) return null;
    page++;
  }
}

export function generateDrillSql(drills: CandidateDrillRecord[]): string {
  const escapeSql = (str: string) => "'" + str.replace(/'/g, "''") + "'";
  const escapeArr = (arr: string[]) => "'{" + arr.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",") + "}'";

  const rows = drills.map((d) => {
    return `(
      null,
      ${escapeSql(d.slug)},
      ${escapeSql(d.name)},
      ${escapeSql(d.bestFor)},
      ${escapeArr(d.targetTags)},
      ${escapeSql(d.instructions)},
      ${escapeSql(d.equipment)},
      ${escapeSql(d.ageNotes)},
      true,
      ${escapeSql(d.bestFor)},
      ${escapeSql(d.looksRightWhen)},
      ${escapeSql(d.cue)},
      ${escapeArr(d.commonMistakes)},
      ${d.homeFriendly},
      ${escapeSql(d.sport)},
      ${d.minAge !== null ? d.minAge : "null"},
      ${escapeSql(d.demoUrl)},
      ${escapeSql(d.demoTimestamp)},
      ${escapeSql(d.sourceCredit)},
      ${d.requiresScreen},
      ${d.weightedOrOverspeed},
      v_curation_status,
      v_curated_at,
      v_curator_id
    )`;
  });

  return `-- 00062_approved_drill_library.sql
-- Curate and approve the 90 watch-verified drills from docs/research/drill-library-candidates-v2.md
-- All 90 YouTube URLs, steps, cues, looks-right-when, and source credits are populated.
-- Enforces safety gates: 21 drills require screens (requires_screen = true), 7 weighted/overspeed drills require age 13+.

do $$
declare
  v_curator_id uuid;
  v_curation_status text := 'draft';
  v_curated_at timestamptz := null;
  v_demo_curator uuid := '00000000-0000-4000-a000-000000000001'::uuid;
begin
  -- Resolve an available auth user for public.drill_library curation record
  select id into v_curator_id from auth.users order by created_at asc limit 1;
  if v_curator_id is not null then
    v_curation_status := 'approved';
    v_curated_at := now();
  end if;

  -- 1. Insert/Update into public.drill_library
  insert into public.drill_library (
    team_id, slug, name, purpose, target_tags, instructions, equipment, age_notes,
    is_active, best_for, looks_right_when, cue, common_mistakes, home_friendly,
    sport, min_age, demo_url, demo_timestamp, source_credit, requires_screen,
    weighted_or_overspeed, curation_status, curated_at, curated_by
  ) values
    ${rows.join(",\n    ")}
  on conflict (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), slug) do update set
    name = excluded.name,
    purpose = excluded.purpose,
    target_tags = excluded.target_tags,
    instructions = excluded.instructions,
    equipment = excluded.equipment,
    age_notes = excluded.age_notes,
    is_active = excluded.is_active,
    best_for = excluded.best_for,
    looks_right_when = excluded.looks_right_when,
    cue = excluded.cue,
    common_mistakes = excluded.common_mistakes,
    home_friendly = excluded.home_friendly,
    sport = excluded.sport,
    min_age = excluded.min_age,
    demo_url = excluded.demo_url,
    demo_timestamp = excluded.demo_timestamp,
    source_credit = excluded.source_credit,
    requires_screen = excluded.requires_screen,
    weighted_or_overspeed = excluded.weighted_or_overspeed,
    curation_status = case when v_curator_id is not null then 'approved' else public.drill_library.curation_status end,
    curated_at = case when v_curator_id is not null then v_curated_at else public.drill_library.curated_at end,
    curated_by = case when v_curator_id is not null then v_curator_id else public.drill_library.curated_by end;

  -- 2. Insert/Update into demo.drill_library (always approved)
  if exists (select 1 from information_schema.tables where table_schema = 'demo' and table_name = 'drill_library') then
    insert into demo.drill_library (
      team_id, slug, name, purpose, target_tags, instructions, equipment, age_notes,
      is_active, best_for, looks_right_when, cue, common_mistakes, home_friendly,
      sport, min_age, demo_url, demo_timestamp, source_credit, requires_screen,
      weighted_or_overspeed, curation_status, curated_at, curated_by
    ) values
      ${rows.map((r) => r.replace("v_curation_status", "'approved'").replace("v_curated_at", "now()").replace("v_curator_id", "v_demo_curator")).join(",\n      ")}
    on conflict (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), slug) do update set
      name = excluded.name,
      purpose = excluded.purpose,
      target_tags = excluded.target_tags,
      instructions = excluded.instructions,
      equipment = excluded.equipment,
      age_notes = excluded.age_notes,
      is_active = excluded.is_active,
      best_for = excluded.best_for,
      looks_right_when = excluded.looks_right_when,
      cue = excluded.cue,
      common_mistakes = excluded.common_mistakes,
      home_friendly = excluded.home_friendly,
      sport = excluded.sport,
      min_age = excluded.min_age,
      demo_url = excluded.demo_url,
      demo_timestamp = excluded.demo_timestamp,
      source_credit = excluded.source_credit,
      requires_screen = excluded.requires_screen,
      weighted_or_overspeed = excluded.weighted_or_overspeed,
      curation_status = 'approved',
      curated_at = now(),
      curated_by = v_demo_curator;
  end if;
end $$;
`;
}

export async function importCuratedDrills(opts: {
  dryRun?: boolean;
  apply?: boolean;
  curatorEmail?: string;
  curatorId?: string;
  sql?: boolean;
}): Promise<void> {
  const drills = loadCandidateDrills();
  console.log(`Parsed ${drills.length} candidate drills.`);
  const screenCount = drills.filter((d) => d.requiresScreen).length;
  const weightedCount = drills.filter((d) => d.weightedOrOverspeed).length;
  console.log(`Safety summary: ${screenCount} drills require screen, ${weightedCount} drills restricted for under-13.`);

  if (opts.sql) {
    const sql = generateDrillSql(drills);
    process.stdout.write(sql);
    return;
  }

  if (opts.dryRun || !opts.apply) {
    console.log("Dry run complete. Use --apply to execute database import or --sql to view generated SQL.");
    return;
  }

  const supabase = getSupabaseClient();
  const curatorId = await findCuratorUser(opts.curatorEmail, opts.curatorId);
  if (!curatorId) {
    throw new Error(
      "No auth user found in Supabase auth.users to record as curator in public.drill_library. " +
        "Provide --curator-email or create an admin/coach user first.",
    );
  }

  console.log(`Curating drills as user ID: ${curatorId}`);
  const now = new Date().toISOString();

  // Batch insert into public.drill_library
  for (const d of drills) {
    const payload = {
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
      curation_status: "approved",
      curated_at: now,
      curated_by: curatorId,
      is_active: true,
    };

    const { data: existing } = await supabase
      .from("drill_library")
      .select("id")
      .is("team_id", null)
      .eq("slug", d.slug)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("drill_library").update(payload).eq("id", existing.id);
      if (error) {
        throw new Error(`Failed to update drill ${d.slug} in public.drill_library: ${error.message}`);
      }
    } else {
      const { error } = await supabase.from("drill_library").insert(payload);
      if (error) {
        throw new Error(`Failed to insert drill ${d.slug} into public.drill_library: ${error.message}`);
      }
    }
  }

  console.log(`Successfully imported and approved all ${drills.length} drills into public.drill_library.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const program = new Command()
    .name("import-curated-drills")
    .description("Import and approve watch-verified drills from docs/research/drill-library-candidates-v2.md")
    .option("--dry-run", "Validate and print summary without writing to database", false)
    .option("--apply", "Apply changes to Supabase database", false)
    .option("--curator-email <email>", "Email of the curator user")
    .option("--curator-id <uuid>", "UUID of the curator user")
    .option("--sql", "Output SQL statements", false)
    .action(async (options) => {
      try {
        await importCuratedDrills(options);
      } catch (err) {
        console.error("Error:", (err as Error).message);
        process.exit(1);
      }
    });

  program.parse();
}
