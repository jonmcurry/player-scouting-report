-- Development-only experimental results; never exposed through table grants.
create table public.experimental_v2_results (
  video_clip_id uuid primary key references public.video_clips(id) on delete cascade,
  engine text not null,
  pipeline_version text not null,
  outcome text not null check (outcome in ('processing', 'not_assessable',
    'analysis_not_enabled', 'findings', 'no_supported_issue', 'insufficient_evidence',
    'withheld', 'analysis_failed')),
  reason_codes text[] not null default '{}',
  events jsonb not null default '[]',
  findings jsonb not null default '[]',
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  analysis_run_id uuid references public.analysis_runs(id) on delete set null,
  retry_eligible boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.experimental_v2_results enable row level security;
revoke all on public.experimental_v2_results from public, anon, authenticated;
grant all on public.experimental_v2_results to service_role;

create function public.retry_experimental_v2_clip(p_clip_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_player uuid;
  v_team uuid;
  v_status text;
  v_held boolean;
  v_result public.experimental_v2_results%rowtype;
begin
  -- Lock in the same order as the worker (clip, then result). v_held mirrors the report's
  -- analysis hold: the worker still owns a ready clip below 100% for 15 minutes.
  select e.player_id, p.team_id, c.status,
      coalesce(c.processing_progress, 100) < 100 and c.claimed_at is not null
        and c.claimed_at > now() - interval '15 minutes'
    into v_player, v_team, v_status, v_held
    from public.video_clips c
    join public.game_log_entries e on e.id = c.game_log_entry_id
    join public.players p on p.id = e.player_id
    where c.id = p_clip_id for update of c;
  if auth.uid() is null or v_player is null or not (
    public.is_coach_for_team(v_team) or public.is_guardian_for_player(v_player)
  ) then
    raise exception 'Clip unavailable' using errcode = '42501';
  end if;
  select * into v_result from public.experimental_v2_results
    where video_clip_id = p_clip_id for update;
  if not found or not (v_result.retry_eligible or
    (v_result.outcome = 'processing' and (v_status = 'failed' or (v_status = 'ready' and not v_held)))) then
    raise exception 'Experimental analysis is not eligible for retry' using errcode = '22023';
  end if;
  update public.video_clips set status = 'pending', processing_progress = 0,
    error_message = null, retry_count = 0, next_retry_at = null
    where id = p_clip_id;
  update public.experimental_v2_results set outcome = 'processing',
    retry_eligible = false, reason_codes = '{}', updated_at = now()
    where video_clip_id = p_clip_id;
end;
$$;
revoke all on function public.retry_experimental_v2_clip(uuid) from public, anon;
grant execute on function public.retry_experimental_v2_clip(uuid) to authenticated;
