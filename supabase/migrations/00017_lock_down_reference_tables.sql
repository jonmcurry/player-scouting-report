-- checkpoints and swing_phase_types were shared reference data with RLS
-- DISABLED entirely (not "no policy" - actually off) plus full INSERT/
-- UPDATE/DELETE grants to authenticated. Proven exploitable during the
-- 2026-08-04 go-live audit: a brand-new, zero-team self-signup coach could
-- rewrite checklist labels used by every team in the database. Read-only
-- for authenticated is correct and sufficient - the only real reads are
-- coach/player.html's checkpoints!inner(...) / swing_phase_types!inner(...)
-- joins; every write comes from CLI scripts using the service_role client
-- (getSupabaseClient()), which bypasses RLS entirely regardless of policy.
alter table checkpoints enable row level security;
alter table swing_phase_types enable row level security;

create policy checkpoints_read on checkpoints for select to authenticated using (true);
create policy swing_phase_types_read on swing_phase_types for select to authenticated using (true);

revoke insert, update, delete, truncate on checkpoints from authenticated;
revoke insert, update, delete, truncate on swing_phase_types from authenticated;
