-- Canonical fictional demo seed template, v1. Deliberately minimal for
-- Phase 1-3: just enough (one team, three unmistakably fictional players)
-- to prove the clone/isolate/reset mechanics end-to-end per the Phase 1-3
-- acceptance criteria. The full per-player narrative (games, pitches, video
-- clips, analysis runs, priorities, drills, practice reps, observations,
-- Compare pairs) described in the architecture's Player A/B/C loops is
-- explicitly Phase 4 scope - adding it later is a data change to this
-- table's payload, not a new migration, by design (see
-- 001_demo_lifecycle.sql's header).
insert into demo_seed_templates (seed_version, payload, active) values (
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
);
