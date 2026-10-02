-- Guardian (parent) link: the first piece of the parent pathway. A coach
-- invites a parent/guardian to ONE player; the parent accepts the invite
-- once, recording which consent text version they agreed to.
--
-- Scope: public schema only. Guardians have no demo.* persona in this phase -
-- nothing here is mirrored into the demo schema.
--
-- Access model (deliberately narrow):
--   * `anon` gets nothing - no table grants, no function execute.
--   * Guardians get NO new grants/policies on development data (players,
--     checklist_scores, issues, player_priorities, video_clips, ...). A
--     guardian has no coach_team_access row, so every existing
--     coach_rw_own_team policy already returns zero rows for them. Later
--     tasks expose guardian-facing data through security definer functions
--     gated on is_guardian_for_player(), not through table policies.
--   * The only policies a guardian matches are guardian_read_own (their own
--     link rows) below. All writes go through the security definer RPCs;
--     authenticated has SELECT only on both new tables.
--   * Invite tokens: only the sha256 hex hash is stored. The plaintext is
--     returned once by create_guardian_invite and never persisted.

create table player_guardians (
  user_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  relationship text not null check (relationship in ('parent', 'guardian')),
  consent_version text not null,
  consented_at timestamptz not null default now(),
  -- on delete set null: deleting the inviting coach's account must not be
  -- blocked by (or delete) the family's link.
  invited_by uuid references auth.users (id) on delete set null,
  primary key (user_id, player_id)
);
create index player_guardians_player_id_idx on player_guardians (player_id);
alter table player_guardians enable row level security;

create policy guardian_read_own on player_guardians for select
  using (user_id = auth.uid());
create policy coach_read_team_guardians on player_guardians for select
  using (is_coach_for_team((select team_id from players where players.id = player_id)));

create table guardian_invites (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  token_hash text not null unique, -- sha256 hex; the plaintext is never stored
  relationship text not null check (relationship in ('parent', 'guardian')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  -- on delete set null: a parent deleting their account must not be blocked
  -- by the invite they once accepted.
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index guardian_invites_player_id_idx on guardian_invites (player_id);
alter table guardian_invites enable row level security;

create policy coach_read_team_invites on guardian_invites for select
  using (is_coach_for_team((select team_id from players where players.id = player_id)));

-- Supabase's default privileges grant anon/authenticated broad rights on new
-- public tables; pin them down explicitly. Writes happen only inside the
-- security definer functions below (which run as the owner).
revoke all on player_guardians, guardian_invites from anon, authenticated, public;
grant select on player_guardians, guardian_invites to authenticated;
grant all on player_guardians, guardian_invites to service_role;

-- Current consent text version. accept_guardian_invite rejects any other
-- value, so the client must show (and send) exactly this version. Bump it
-- here (or directly in app_settings) when the consent text changes.
insert into app_settings (key, value) values ('guardian_consent_version', 'guardian-consent-2026-10-01')
on conflict (key) do update set value = excluded.value;

create or replace function is_guardian_for_player(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from player_guardians
    where user_id = auth.uid() and player_id = target_player_id
  );
$$;

-- Coach of the player's team creates a one-time invite. Returns the
-- plaintext token exactly once; only its sha256 hash is stored.
create or replace function create_guardian_invite(p_player_id uuid, p_relationship text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select team_id into v_team_id from players where id = p_player_id;
  if v_team_id is null or not is_coach_for_team(v_team_id) then
    raise exception 'not allowed';
  end if;

  if p_relationship is null or p_relationship not in ('parent', 'guardian') then
    raise exception 'invalid relationship';
  end if;

  -- 32 random bytes, hex encoded (64 chars). pgcrypto lives in `extensions`
  -- on Supabase, so it is schema-qualified (search_path is public only).
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into guardian_invites (player_id, token_hash, relationship, created_by)
  values (p_player_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_relationship, auth.uid());

  return v_token;
end;
$$;

-- Parent accepts an invite. Looks the invite up by sha256(p_token) - never
-- compares plaintext - and locks the row so two concurrent accepts cannot
-- both succeed. Returns the linked player_id.
create or replace function accept_guardian_invite(p_token text, p_consent_version text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invite guardian_invites;
  v_team_id uuid;
  v_consent text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Anonymous (demo) sessions are `authenticated` too; they must never
  -- become a guardian of a real player.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;

  select value into v_consent from app_settings where key = 'guardian_consent_version';
  if v_consent is null or p_consent_version is null or p_consent_version <> v_consent then
    raise exception 'consent version mismatch';
  end if;

  if p_token is null or p_token = '' then
    raise exception 'invalid invite';
  end if;

  select * into v_invite from guardian_invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invalid invite';
  end if;
  if v_invite.used_at is not null then
    raise exception 'invite already used';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite expired';
  end if;

  select team_id into v_team_id from players where id = v_invite.player_id;
  if is_coach_for_team(v_team_id) then
    raise exception 'a coach on this team cannot accept a guardian invite';
  end if;

  insert into player_guardians (user_id, player_id, relationship, consent_version, consented_at, invited_by)
  values (auth.uid(), v_invite.player_id, v_invite.relationship, p_consent_version, now(), v_invite.created_by)
  on conflict (user_id, player_id) do update
    set relationship = excluded.relationship,
        consent_version = excluded.consent_version,
        consented_at = excluded.consented_at,
        invited_by = excluded.invited_by;

  update guardian_invites set used_at = now(), used_by = auth.uid() where id = v_invite.id;

  return v_invite.player_id;
end;
$$;

-- Removes a guardian link immediately. Allowed for a coach on the player's
-- team, or for the guardian removing themselves.
create or replace function revoke_guardian(p_player_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select team_id into v_team_id from players where id = p_player_id;
  if not (p_user_id = auth.uid() or (v_team_id is not null and is_coach_for_team(v_team_id))) then
    raise exception 'not allowed';
  end if;

  delete from player_guardians where player_id = p_player_id and user_id = p_user_id;
end;
$$;

-- Functions default to EXECUTE for PUBLIC (and Supabase's default privileges
-- add anon); restrict all four to signed-in users.
revoke all on function is_guardian_for_player(uuid) from public, anon;
revoke all on function create_guardian_invite(uuid, text) from public, anon;
revoke all on function accept_guardian_invite(text, text) from public, anon;
revoke all on function revoke_guardian(uuid, uuid) from public, anon;
grant execute on function is_guardian_for_player(uuid) to authenticated, service_role;
grant execute on function create_guardian_invite(uuid, text) to authenticated, service_role;
grant execute on function accept_guardian_invite(text, text) to authenticated, service_role;
grant execute on function revoke_guardian(uuid, uuid) to authenticated, service_role;

comment on table player_guardians is
  'Guardian (parent) link to exactly one player per row, created only by accept_guardian_invite. Guardians get no direct access to development data through this table.';
comment on table guardian_invites is
  'One-time, 7-day coach-issued guardian invites. Stores only sha256(token) hex; the plaintext token is returned once by create_guardian_invite.';
