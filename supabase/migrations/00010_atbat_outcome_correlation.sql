-- Real report HTML (reports/_individual_report_template.html, added 2026-07-28)
-- has an At-Bat Outcome Correlation feature that cross-references
-- CHECKLIST[].atBats / ISSUES[].atBats against GAME_LOG[].outcome - three
-- fields migrate.ts's original RawGameLogEntry/RawChecklistEntry/RawIssueEntry
-- interfaces never modeled, since they predate this feature. Migrating a real
-- report (Latham Lady Bison White 10U's emily_c.html, which already uses all
-- three) without this would silently drop the feature's underlying data from
-- Supabase - exactly the risk NEXT_STEPS.md flagged before this ever came up
-- for a real team. The client-side correlation-computing JS in the report
-- itself is untouched (generate.ts only replaces the GAME_LOG/CHECKLIST/
-- ISSUES const arrays, never the surrounding <script>), so restoring these
-- fields on the round trip is the whole fix.
--
-- outcome's three values are the template's own documented convention
-- (its GAME_LOG comment), not just what's observed in Emily's 4 real rows
-- today (which only uses two of them).
alter table game_log_entries
  add column outcome text check (outcome in ('take', 'foul-no-advance', 'ball-in-play'));

-- atBats arrays are 1-indexed references into a player's own GAME_LOG array
-- position (the "1st/2nd/3rd logged at-bat" ordinal, NOT the "ab" field,
-- which can repeat across games) - already exactly how game_log_entries rows
-- are ordered (the existing `position` column, 0-indexed) and re-serialized
-- by generate.ts, so no extra join table is needed to reinterpret them.
alter table checklist_scores
  add column at_bats smallint[] not null default '{}';

alter table issues
  add column at_bats smallint[] not null default '{}';
