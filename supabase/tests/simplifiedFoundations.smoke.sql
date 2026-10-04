-- Run inside BEGIN/ROLLBACK after migrations 00036-00047 against a local
-- database. The fixtures and checks below must never persist.
do $$
declare
  v_coach uuid;
  v_team uuid;
  v_player uuid;
  v_entry uuid;
  v_clip uuid;
  v_run uuid;
  v_issue uuid;
  v_token text;
  v_serial integer;
  v_count integer;
  v_slug text;
  v_capture uuid;
  v_new_team public.teams;
  v_guardian uuid;
  v_other_player uuid;
  v_denied boolean := false;
begin
  insert into auth.users(id, instance_id, aud, role, email)
    values(gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'simplified-smoke@example.test')
    returning id into v_coach;
  insert into public.teams(slug,name,sport,age_group)
    values('simplified-smoke','Simplified smoke','softball','12U') returning id into v_team;
  insert into public.players(team_id,slug,name,jersey_number)
    values(v_team,'smoke-player','Test Player','12') returning id into v_player;
  insert into public.coach_team_access(coach_id,team_id,role)
    values(v_coach,v_team,'head_coach');
  perform set_config('request.jwt.claim.sub', v_coach::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_coach::text,'role','authenticated')::text, true);
  insert into public.app_settings(key,value) values('team_creation_code','simplified-smoke-code')
    on conflict(key) do update set value=excluded.value;
  v_new_team := public.create_simple_team('simple-smoke-team','Simple smoke','simplified-smoke-code','baseball','13U',null);
  if v_new_team.id is null or v_new_team.sport <> 'baseball' or v_new_team.age_group <> '13U' then
    raise exception 'team setup context missing';
  end if;
  v_capture := gen_random_uuid();
  v_entry := public.create_simple_at_bat(v_player, 'game', 'hit', current_date, v_capture);
  if public.create_simple_at_bat(v_player, 'game', 'hit', current_date, v_capture) <> v_entry then
    raise exception 'capture retry created a duplicate entry';
  end if;
  if (select result_simple from public.game_log_entries where id = v_entry) <> 'hit' then raise exception 'simple result not saved'; end if;
  v_slug := gen_random_uuid()::text;
  if not public.reserve_simple_upload(v_entry, v_slug, v_entry::text || '/raw/' || v_slug || '.mp4')
    or not public.reserve_simple_upload(v_entry, v_slug, v_entry::text || '/raw/' || v_slug || '.mp4') then
    raise exception 'upload reservation denied';
  end if;
  if not public.has_simple_upload_reservation(v_entry, v_slug, v_entry::text || '/raw/' || v_slug || '.mp4')
    or public.has_simple_upload_reservation(v_entry, v_slug, v_entry::text || '/raw/' || v_slug || '.mov') then
    raise exception 'upload reservation ownership is incorrect';
  end if;
  if (select count(*) from public.upload_reservations where user_id = v_coach and entry_id = v_entry) <> 1 then
    raise exception 'upload reservation not idempotent';
  end if;
  insert into public.video_clips(game_log_entry_id,clip_slug,status,position)
    values(v_entry, 'legacy-smoke', 'ready', 1) returning id into v_clip;
  update public.video_clips set raw_gcs_path = 'gs://smoke-bucket/' || v_entry::text || '/raw/' || v_clip::text || '.mp4'
    where id = v_clip;
  v_token := public.create_simple_share_link(v_player, 'progress', null);
  if length(v_token) <> 64 then raise exception 'share token length'; end if;
  if not exists (select 1 from public.player_share_links where token = v_token and share_scope = 'progress') then raise exception 'share scope'; end if;
  perform public.revoke_simple_share_link((select id from public.player_share_links where token = v_token));
  if not exists (select 1 from public.player_share_links where token = v_token and revoked_at is not null) then raise exception 'share revoke'; end if;
  insert into public.video_clips(game_log_entry_id,clip_slug,raw_gcs_path,status,position)
    values(v_entry, v_slug, 'gs://smoke-bucket/' || v_entry::text || '/raw/' || v_slug || '.mp4', 'ready', 0) returning id into v_clip;
  begin
    update public.video_clips set raw_gcs_path = 'gs://smoke-bucket/wrong/raw/' || v_slug || '.mp4' where id = v_clip;
    raise exception 'invalid path was accepted';
  exception when check_violation or raise_exception then
    if (select raw_gcs_path from public.video_clips where id = v_clip) not like 'gs://smoke-bucket/' || v_entry::text || '/raw/%' then
      raise exception 'invalid path changed stored clip';
    end if;
  end;
  v_serial := public.register_readable_game_swing(v_clip);
  if v_serial is null or public.register_readable_game_swing(v_clip) <> v_serial then raise exception 'serial idempotence'; end if;
  select count(*) into v_count from public.video_clips where id = v_clip and readable_game_serial = v_serial;
  if v_count <> 1 then raise exception 'serial missing'; end if;
  insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,
    analysis_policy_version,knowledge_version,input_manifest,summary,strengths)
    values(v_clip,v_player,'gemini','test','test','test',(select min(version_label) from public.methodology_versions),'{}'::jsonb,'Visible balance.','[]'::jsonb)
    returning id into v_run;
  insert into public.issues(player_id,issue,video_clip_id,analysis_run_id,concept,basis,confidence)
    values(v_player,'Test finding',v_clip,v_run,'posture','video','medium') returning id into v_issue;
  perform public.hide_simple_issue(v_issue, 'other');
  if not exists (select 1 from public.issues where id = v_issue and review_status = 'hidden' and hidden_by = v_coach) then
    raise exception 'issue not hidden';
  end if;
  insert into auth.users(id, instance_id, aud, role, email)
    values(gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'simplified-guardian-smoke@example.test')
    returning id into v_guardian;
  insert into public.players(team_id,slug,name,jersey_number)
    values(v_team,'other-smoke-player','Other Child','7') returning id into v_other_player;
  insert into public.player_guardians(user_id,player_id,relationship,consent_version)
    values(v_guardian,v_player,'parent',(select value from public.app_settings where key='guardian_consent_version'));
  perform set_config('request.jwt.claim.sub', v_guardian::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_guardian::text,'role','authenticated')::text, true);
  if public.create_simple_at_bat(v_player,'practice',null,current_date,gen_random_uuid()) is null then raise exception 'guardian capture denied'; end if;
  if length(public.create_simple_share_link(v_player,'progress',null)) <> 64 then raise exception 'guardian share denied'; end if;
  begin
    perform public.create_simple_at_bat(v_other_player,'game',null,current_date,gen_random_uuid());
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'guardian crossed into another child'; end if;
end;
$$;
