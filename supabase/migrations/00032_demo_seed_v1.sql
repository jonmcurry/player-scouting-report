-- Canonical fictional demo seed template, v1, loaded into demo.demo_seed_templates
-- (supabase/migrations/00031_demo_shared_project_schema.sql). Content is
-- identical to the original supabase/demo/002_demo_seed_template.sql - only
-- the target table changed (demo_seed_templates -> demo.demo_seed_templates).
-- Deliberately minimal: one team, three unmistakably fictional players -
-- enough to prove the clone/isolate/reset mechanics end-to-end. The fuller
-- per-player narrative (games, pitches, clips, analysis runs, priorities,
-- drills, practice reps, Compare pairs) is still explicitly out of scope
-- (Phase 4) - adding it later is a data change to this payload, not a new
-- migration or schema change, by design.
insert into demo.demo_seed_templates (seed_version, payload, active) values (
  'v1',
  '{
    "team": {
      "name": "Harbor City Hawks 12U — Demo",
      "sport": "softball",
      "level_label": "12U"
    },
    "players": [
      { "slug": "jordan-lee", "name": "Jordan Lee", "jersey_number": "7", "age_band": "11-12", "bats": "R", "throws": "R" },
      { "slug": "maya-torres", "name": "Maya Torres", "jersey_number": "12", "age_band": "11-12", "bats": "L", "throws": "R" },
      { "slug": "riley-chen", "name": "Riley Chen", "jersey_number": "4", "age_band": "11-12", "bats": "S", "throws": "R" }
    ]
  }'::jsonb,
  true
)
on conflict (seed_version) do nothing;
