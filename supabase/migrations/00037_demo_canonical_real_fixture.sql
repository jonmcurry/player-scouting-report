-- Emily-only canonical demo: every anonymous visitor's clone is built from
-- exactly ONE explicitly published real-data fixture, instead of the
-- fictional Harbor City Hawks narrative (00034) with real fixtures appended
-- to it (00036). See docs/research/demo-real-data-promotion.md.
--
-- Design:
--   * demo.demo_canonical - a single-row pointer that says what a clone is
--     built from: mode 'fixture' (a specific fixture_id@fixture_version) or
--     mode 'fictional' (the pre-existing narrative, kept ONLY as an explicit
--     rollback target). There is no implicit fallback: if the pointer says
--     'fixture' and that fixture can't be cloned, the clone raises and the
--     visitor gets an error - it never silently serves fictional data.
--   * Fixtures become immutable versions: primary key (fixture_id,
--     fixture_version); re-loading an existing version with different
--     content is refused. Publishing a newer version, or rolling back to an
--     older one, is one pointer update (atomic for every new visitor).
--   * The fixture payload carries its own publication-approved team block
--     ({name, sport, level_label}); the clone creates the visitor's team
--     from it. The exporter requires it to be set explicitly.
--   * 00036's "append every active fixture to the fictional team" path and
--     its `active` flag are retired: exactly one published fixture, never a
--     merge, so a stored-but-unpublished fixture can never reach a visitor.
--
-- The pointer starts in mode 'fictional' so deploying this migration
-- changes nothing for live visitors until a verified fixture is explicitly
-- published (see the rollout plan in the doc) - no window where a visitor
-- gets a half-published or missing dataset.
--
-- No real data lives in this file. Nothing here touches public.*, adds an
-- FK into public.*, or loosens any RLS policy/grant.

-- ---------------------------------------------------------------------
-- Immutable fixture versions
-- ---------------------------------------------------------------------
alter table demo.demo_real_fixtures drop constraint demo_real_fixtures_pkey;
alter table demo.demo_real_fixtures add primary key (fixture_id, fixture_version);
alter table demo.demo_real_fixtures drop column active;
alter table demo.demo_real_fixtures
  add constraint demo_real_fixtures_version_safe check (fixture_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

-- ---------------------------------------------------------------------
-- The canonical pointer (singleton)
-- ---------------------------------------------------------------------
create table demo.demo_canonical (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('fictional', 'fixture')),
  fixture_id text,
  fixture_version text,
  published_at timestamptz not null default now(),
  constraint demo_canonical_fixture_ref check (
    (mode = 'fixture' and fixture_id is not null and fixture_version is not null)
    or (mode = 'fictional' and fixture_id is null and fixture_version is null)),
  -- A published fixture version can't be deleted out from under visitors.
  constraint demo_canonical_fixture_fk foreign key (fixture_id, fixture_version)
    references demo.demo_real_fixtures (fixture_id, fixture_version) on delete restrict
);
alter table demo.demo_canonical enable row level security;
revoke all on demo.demo_canonical from authenticated, anon, public;
insert into demo.demo_canonical (mode) values ('fictional');
comment on table demo.demo_canonical is
  'What every new/reset demo clone is built from: one published fixture version, or the fictional narrative as an explicit rollback target. No client access.';

-- ---------------------------------------------------------------------
-- Clone one fixture into a fresh team created from its own team block.
-- ---------------------------------------------------------------------
create or replace function demo.clone_fixture_team(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_team_id uuid := gen_random_uuid();
  team jsonb := p_payload->'team';
begin
  if team is null or coalesce(btrim(team->>'name'), '') = '' then
    raise exception 'demo fixture % has no publication-approved team name', p_payload->>'fixtureId';
  end if;
  insert into demo.teams (id, slug, name, sport, level_label)
  values (new_team_id, 'demo-' || replace(gen_random_uuid()::text, '-', ''), team->>'name',
          nullif(team->>'sport', ''), nullif(team->>'level_label', ''));
  perform demo.clone_real_fixture(new_team_id, p_payload);
  return new_team_id;
end;
$$;
revoke all on function demo.clone_fixture_team(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- clone_demo_dataset: follow the pointer, fail closed.
-- ---------------------------------------------------------------------
create or replace function demo.clone_demo_dataset(p_user_id uuid)
returns table (team_id uuid, team_slug text, seed_version text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  canon demo.demo_canonical;
  fx demo.demo_real_fixtures;
  base record;
  new_team uuid;
begin
  select * into canon from demo.demo_canonical where singleton;
  if canon.mode is null then
    raise exception 'demo is not published (no demo.demo_canonical row)';
  end if;
  if canon.mode = 'fictional' then
    select * into base from demo.clone_fictional_dataset(p_user_id);
    return query select base.team_id, base.team_slug, base.seed_version;
    return;
  end if;
  select * into fx from demo.demo_real_fixtures
  where fixture_id = canon.fixture_id and fixture_version = canon.fixture_version;
  if fx.fixture_id is null then
    raise exception 'published demo fixture %@% is missing - refusing to fall back', canon.fixture_id, canon.fixture_version;
  end if;
  new_team := demo.clone_fixture_team(fx.payload);
  return query select new_team, (select slug from demo.teams where id = new_team),
    'fixture:' || fx.fixture_id || '@' || fx.fixture_version;
end;
$$;
revoke all on function demo.clone_demo_dataset(uuid) from public, anon, authenticated;
comment on function demo.clone_demo_dataset(uuid) is
  'Internal (no client grant). Builds one visitor team from demo.demo_canonical: the published fixture version (team block + data), or the fictional narrative only when explicitly set as a rollback. Never falls back silently.';

-- ---------------------------------------------------------------------
-- verify / load / publish (service role only)
-- ---------------------------------------------------------------------
create or replace function demo.verify_real_fixture(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  counts jsonb;
  new_team uuid;
begin
  begin
    new_team := demo.clone_fixture_team(p_payload);
    select jsonb_object_agg(t, n) into counts from (
      select 'players' t, count(*) n from demo.players where team_id = new_team
      union all select 'video_clips', count(*) from demo.video_clips c join demo.game_log_entries g on g.id = c.game_log_entry_id join demo.players p on p.id = g.player_id where p.team_id = new_team
      union all select 'issues', count(*) from demo.issues i join demo.players p on p.id = i.player_id where p.team_id = new_team
    ) s;
    raise exception using errcode = 'HLV01', message = counts::text;
  exception when sqlstate 'HLV01' then
    return jsonb_build_object('ok', true, 'counts', sqlerrm::jsonb);
  end;
end;
$$;
revoke all on function demo.verify_real_fixture(jsonb) from public, anon, authenticated;
grant execute on function demo.verify_real_fixture(jsonb) to service_role;

drop function if exists demo.load_real_fixture(jsonb, text, boolean);
drop function if exists demo.set_real_fixture_active(text, boolean);

create or replace function demo.load_real_fixture(p_payload jsonb, p_content_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified jsonb;
  existing demo.demo_real_fixtures;
begin
  if coalesce(p_payload->>'fixtureId', '') = '' or coalesce(p_payload->>'fixtureVersion', '') = '' then
    raise exception 'demo.load_real_fixture: payload needs fixtureId and fixtureVersion';
  end if;
  select * into existing from demo.demo_real_fixtures
  where fixture_id = p_payload->>'fixtureId' and fixture_version = p_payload->>'fixtureVersion';
  if existing.fixture_id is not null then
    if existing.content_sha256 = p_content_sha256 then
      return jsonb_build_object('ok', true, 'unchanged', true, 'fixtureId', existing.fixture_id, 'fixtureVersion', existing.fixture_version);
    end if;
    raise exception 'fixture %@% already exists with different content - fixture versions are immutable; export a new fixtureVersion',
      existing.fixture_id, existing.fixture_version;
  end if;
  verified := demo.verify_real_fixture(p_payload);
  insert into demo.demo_real_fixtures (fixture_id, fixture_version, content_sha256, payload)
  values (p_payload->>'fixtureId', p_payload->>'fixtureVersion', p_content_sha256, p_payload);
  return verified || jsonb_build_object('fixtureId', p_payload->>'fixtureId', 'fixtureVersion', p_payload->>'fixtureVersion', 'published', false);
end;
$$;
revoke all on function demo.load_real_fixture(jsonb, text) from public, anon, authenticated;
grant execute on function demo.load_real_fixture(jsonb, text) to service_role;

-- Atomic switch for every NEW/reset visitor. Re-verifies the stored payload
-- first (a fixture that no longer clones against the current schema is
-- never published). p_fixture_id null = explicit rollback to fictional.
create or replace function demo.publish_demo_canonical(p_fixture_id text, p_fixture_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fx demo.demo_real_fixtures;
  previous demo.demo_canonical;
begin
  select * into previous from demo.demo_canonical where singleton for update;
  if p_fixture_id is null then
    update demo.demo_canonical set mode = 'fictional', fixture_id = null, fixture_version = null, published_at = now() where singleton;
  else
    select * into fx from demo.demo_real_fixtures where fixture_id = p_fixture_id and fixture_version = p_fixture_version;
    if fx.fixture_id is null then
      raise exception 'no stored fixture %@% - load it first', p_fixture_id, p_fixture_version;
    end if;
    perform demo.verify_real_fixture(fx.payload);
    update demo.demo_canonical set mode = 'fixture', fixture_id = fx.fixture_id, fixture_version = fx.fixture_version, published_at = now() where singleton;
  end if;
  return jsonb_build_object(
    'previous', jsonb_build_object('mode', previous.mode, 'fixtureId', previous.fixture_id, 'fixtureVersion', previous.fixture_version),
    'current', (select jsonb_build_object('mode', mode, 'fixtureId', fixture_id, 'fixtureVersion', fixture_version) from demo.demo_canonical where singleton));
end;
$$;
revoke all on function demo.publish_demo_canonical(text, text) from public, anon, authenticated;
grant execute on function demo.publish_demo_canonical(text, text) to service_role;

-- Ends every existing session that was cloned from anything other than the
-- current canonical dataset (e.g. old fictional sessions after the switch).
-- Affected visitors simply get a fresh canonical clone on their next page
-- load (start_demo_session() re-bootstraps a missing session).
create or replace function demo.retire_noncanonical_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  canon demo.demo_canonical;
  label text;
  retired integer;
begin
  select * into canon from demo.demo_canonical where singleton;
  if canon.mode <> 'fixture' then
    raise exception 'refusing to retire sessions while the canonical dataset is not a published fixture';
  end if;
  label := 'fixture:' || canon.fixture_id || '@' || canon.fixture_version;
  create temporary table retire_teams on commit drop as
    select team_id from demo.demo_sessions where seed_version is distinct from label;
  delete from demo.demo_sessions where team_id in (select team_id from retire_teams);
  delete from demo.teams where id in (select team_id from retire_teams);
  get diagnostics retired = row_count;
  return retired;
end;
$$;
revoke all on function demo.retire_noncanonical_sessions() from public, anon, authenticated;
grant execute on function demo.retire_noncanonical_sessions() to service_role;
