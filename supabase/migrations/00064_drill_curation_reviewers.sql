-- No reviewers are seeded. The product owner provisions qualified identities separately.
create table public.curation_reviewers (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('drill_curator', 'concept_reviewer')),
  qualification text not null check (nullif(btrim(qualification), '') is not null),
  added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.curation_reviewers enable row level security;
revoke all on public.curation_reviewers from public, anon, authenticated, service_role;
grant select, insert, update on public.curation_reviewers to service_role;
grant select on public.curation_reviewers to authenticated;
create policy reviewer_self_read on public.curation_reviewers for select to authenticated using (user_id = auth.uid());

create table public.drill_curation_decisions (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null,
  drill_schema text not null check (drill_schema in ('public', 'demo')),
  decision text not null check (decision in ('approved', 'rejected')),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  content jsonb not null,
  reviewer_id uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  notes text not null default ''
);
-- Snapshot plus logical drill identity survives later edits/deletion. Never cascade audit deletion.
alter table public.drill_curation_decisions enable row level security;
revoke all on public.drill_curation_decisions from public, anon, authenticated, service_role;
grant select on public.drill_curation_decisions to service_role;
grant select on public.drill_curation_decisions to authenticated;
create policy decision_reviewer_read on public.drill_curation_decisions for select to authenticated
  using (exists (select 1 from public.curation_reviewers r where r.user_id = auth.uid() and r.revoked_at is null));

-- Private, single-use authorization capabilities. A caller-controlled GUC is NOT authority.
create schema curation_private;
revoke all on schema curation_private from public, anon, authenticated, service_role;
create table curation_private.authorizations (
  transaction_id bigint not null,
  backend_pid integer not null,
  drill_schema text not null,
  drill_id uuid not null,
  reviewer_id uuid not null,
  decision text not null,
  content_sha256 text not null,
  primary key (transaction_id, backend_pid, drill_schema, drill_id)
);
revoke all on curation_private.authorizations from public, anon, authenticated, service_role;

-- Hash all content/safety/selection fields, including future fields, excluding only identity
-- and review metadata. Identical global public/demo content has an identical hash.
create function public.drill_review_content(p_row jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select p_row - array['id','team_id','created_at','curation_status','curated_at','curated_by'];
$$;
create function public.drill_content_sha256(p_row jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(public.drill_review_content(p_row)::text, 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public.drill_review_content(jsonb), public.drill_content_sha256(jsonb) from public;
grant execute on function public.drill_review_content(jsonb), public.drill_content_sha256(jsonb) to authenticated, service_role;

create function public.prevent_curation_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Curation decisions are append-only'; end;
$$;
revoke all on function public.prevent_curation_audit_mutation() from public, anon, authenticated, service_role;
create trigger immutable_curation_decisions before update or delete or truncate on public.drill_curation_decisions
for each statement execute function public.prevent_curation_audit_mutation();

create or replace function public.protect_drill_curation_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  changed boolean;
  allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.curation_status is distinct from 'draft' or new.curated_at is not null or new.curated_by is not null then
      raise exception 'New drills must be unreviewed drafts';
    end if;
    return new;
  end if;
  changed := public.drill_content_sha256(to_jsonb(new)) is distinct from public.drill_content_sha256(to_jsonb(old))
    or new.team_id is distinct from old.team_id or new.id is distinct from old.id;
  if new.curation_status is distinct from old.curation_status or new.curated_at is distinct from old.curated_at
     or new.curated_by is distinct from old.curated_by then
    if coalesce(auth.role(), '') = 'authenticated' and auth.uid() is not null and not changed then
      delete from curation_private.authorizations a
      where a.transaction_id = txid_current() and a.backend_pid = pg_backend_pid()
        and a.drill_schema = tg_table_schema and a.drill_id = new.id
        and a.reviewer_id = auth.uid() and a.reviewer_id = new.curated_by
        and a.decision = new.curation_status and new.curated_at = transaction_timestamp()
        and a.content_sha256 = public.drill_content_sha256(to_jsonb(new))
        and exists (select 1 from public.curation_reviewers r where r.user_id = auth.uid()
          and r.role = 'drill_curator' and r.revoked_at is null)
      returning true into allowed;
    end if;
    if not coalesce(allowed, false) then raise exception 'Curation decisions require approve_drill'; end if;
  end if;
  if changed and old.curation_status in ('approved', 'rejected') then
    new.curation_status := 'draft'; new.curated_at := null; new.curated_by := null;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_drill_curation_fields() from public, anon, authenticated, service_role;
create trigger protect_drill_curation_fields before insert or update on demo.drill_library
for each row execute function public.protect_drill_curation_fields();

create function public.get_drill_review(p_drill_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.drill_library;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null or not exists (
    select 1 from public.curation_reviewers where user_id = auth.uid() and role = 'drill_curator' and revoked_at is null
  ) then raise exception 'Active drill reviewer required'; end if;
  select * into strict d from public.drill_library where id = p_drill_id;
  return jsonb_build_object('id', d.id, 'team_id', d.team_id, 'content', public.drill_review_content(to_jsonb(d)),
    'content_sha256', public.drill_content_sha256(to_jsonb(d)), 'curation_status', d.curation_status);
end;
$$;

create function public.approve_drill(p_drill_id uuid, p_content_sha256 text, p_decision text, p_notes text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.drill_library;
  mirror demo.drill_library;
  actor uuid := auth.uid();
  decision_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or actor is null then raise exception 'Authenticated reviewer required'; end if;
  -- Locks serialize revocation against the entire approval transaction.
  perform 1 from public.curation_reviewers where user_id = actor and role = 'drill_curator' and revoked_at is null for share;
  if not found then raise exception 'Active drill reviewer required'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'Invalid decision'; end if;
  select * into strict d from public.drill_library where id = p_drill_id for update;
  if p_content_sha256 is null or public.drill_content_sha256(to_jsonb(d)) <> p_content_sha256 then
    raise exception 'Content changed; review again';
  end if;
  insert into curation_private.authorizations values (txid_current(), pg_backend_pid(), 'public', d.id, actor, p_decision, p_content_sha256);
  update public.drill_library set curation_status = p_decision, curated_at = transaction_timestamp(), curated_by = actor where id = d.id;
  -- An identical repeat decision can leave the capability unconsumed; always remove it.
  delete from curation_private.authorizations where transaction_id = txid_current() and backend_pid = pg_backend_pid() and drill_schema = 'public' and drill_id = d.id;
  insert into public.drill_curation_decisions(drill_id, drill_schema, decision, content_sha256, content, reviewer_id, notes)
    values(d.id, 'public', p_decision, p_content_sha256, public.drill_review_content(to_jsonb(d)), actor, coalesce(p_notes, '')) returning id into decision_id;
  if d.team_id is null then
    select * into mirror from demo.drill_library where team_id is null and slug = d.slug for update;
    if found and public.drill_content_sha256(to_jsonb(mirror)) = p_content_sha256 then
      insert into curation_private.authorizations values (txid_current(), pg_backend_pid(), 'demo', mirror.id, actor, p_decision, p_content_sha256);
      update demo.drill_library set curation_status = p_decision, curated_at = transaction_timestamp(), curated_by = actor where id = mirror.id;
      delete from curation_private.authorizations where transaction_id = txid_current() and backend_pid = pg_backend_pid() and drill_schema = 'demo' and drill_id = mirror.id;
      insert into public.drill_curation_decisions(drill_id, drill_schema, decision, content_sha256, content, reviewer_id, notes)
        values(mirror.id, 'demo', p_decision, p_content_sha256, public.drill_review_content(to_jsonb(mirror)), actor, coalesce(p_notes, ''));
    end if;
  end if;
  return decision_id;
end;
$$;
revoke all on function public.get_drill_review(uuid), public.approve_drill(uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.get_drill_review(uuid), public.approve_drill(uuid,text,text,text) to authenticated;
-- Explicit ownership prevents inheriting an untrusted deployment role's privileges.
alter function public.get_drill_review(uuid) owner to postgres;
alter function public.approve_drill(uuid,text,text,text) owner to postgres;
alter function public.protect_drill_curation_fields() owner to postgres;
