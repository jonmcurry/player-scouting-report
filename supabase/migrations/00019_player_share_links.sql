-- Shareable read-only player report links (coach/report.html). This app's
-- RLS model has never granted `anon` anything, by deliberate original
-- design (00001_initial_schema.sql's own header: two independent,
-- redundant deny layers). A public share link should not be the thing that
-- changes that - this table stays exactly as team-scoped/RLS-protected as
-- every other table (only a player's own team's coach can create/list/
-- revoke links for her). The actual anon-facing read happens through the
-- get-player-report Edge Function, which uses the service_role key
-- internally after validating the token - same "never expose Supabase
-- directly to anon" boundary the app has always held, just enforced in a
-- function instead of a table grant.
create table player_share_links (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table player_share_links enable row level security;

create policy coach_rw_own_team on player_share_links
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));
