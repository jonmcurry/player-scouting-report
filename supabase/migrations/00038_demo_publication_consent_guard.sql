-- Database-level publication-consent guard for real-data demo fixtures.
--
-- The exporter already refuses to produce a publishable fixture without a
-- recorded publication consent, but a fixture can also be produced in the
-- explicit local-validation mode (curation.localValidationOnly = true,
-- consentRecorded = false) so the pipeline can be exercised on real footage
-- BEFORE the human consent/metadata checkpoint. This makes the database
-- itself refuse to store or publish such a fixture unless the local-only
-- dev setting below is switched on. That setting row is never created by
-- any migration - on the hosted project it doesn't exist, so the guard is
-- always closed there.

create table demo.demo_dev_settings (
  singleton boolean primary key default true check (singleton),
  allow_unconsented_fixtures boolean not null default false
);
alter table demo.demo_dev_settings enable row level security;
revoke all on demo.demo_dev_settings from authenticated, anon, public;
comment on table demo.demo_dev_settings is
  'LOCAL DEVELOPMENT ONLY. Never insert a row on a hosted project. allow_unconsented_fixtures lets local-validation fixtures (no recorded publication consent) be stored/published on a local stack.';

create or replace function demo.assert_fixture_publishable(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((p_payload->'curation'->>'consentRecorded')::boolean, false)
     and not coalesce((p_payload->'curation'->>'localValidationOnly')::boolean, false) then
    return;
  end if;
  if coalesce((select allow_unconsented_fixtures from demo.demo_dev_settings where singleton), false) then
    return;
  end if;
  raise exception 'fixture %@% has no recorded publication consent (or is local-validation-only) - refusing to store or publish it',
    p_payload->>'fixtureId', p_payload->>'fixtureVersion';
end;
$$;
revoke all on function demo.assert_fixture_publishable(jsonb) from public, anon, authenticated;

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
  perform demo.assert_fixture_publishable(p_payload);
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
    perform demo.assert_fixture_publishable(fx.payload);
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
