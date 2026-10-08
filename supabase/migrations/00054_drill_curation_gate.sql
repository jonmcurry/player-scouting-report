-- Active is an operational flag, not evidence of content/safety review.
-- Simplified reports require an explicit curation decision as well.
alter table public.drill_library
  add column curation_status text default 'draft'
    check (curation_status in ('draft', 'approved', 'rejected')),
  add column curated_at timestamptz,
  add column curated_by uuid references auth.users(id) on delete set null,
  add constraint drill_library_curation_record check (
    curation_status <> 'approved' or (
      curated_at is not null and curated_by is not null
      and nullif(btrim(best_for), '') is not null
      and nullif(btrim(looks_right_when), '') is not null
      and nullif(btrim(cue), '') is not null
      and nullif(btrim(source_credit), '') is not null
      and nullif(btrim(demo_url), '') is not null
    )
  );

alter table demo.drill_library
  add column curation_status text default 'draft'
    check (curation_status in ('draft', 'approved', 'rejected')),
  add column curated_at timestamptz,
  add column curated_by uuid,
  add constraint drill_library_curation_record check (
    curation_status <> 'approved' or (
      curated_at is not null and curated_by is not null
      and nullif(btrim(best_for), '') is not null
      and nullif(btrim(looks_right_when), '') is not null
      and nullif(btrim(cue), '') is not null
      and nullif(btrim(source_credit), '') is not null
      and nullif(btrim(demo_url), '') is not null
    )
  );

comment on column public.drill_library.curation_status is
  'Human content/safety decision. Only approved rows may appear in automatic simplified reports.';

-- Team coaches retain their existing row-edit policy, but may not self-mark a
-- drill approved/rejected through ordinary table writes. A service-side
-- curation tool records the final human decision and reviewer identity.
create or replace function public.protect_drill_curation_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and ((
    tg_op = 'INSERT' and (
      new.curation_status is distinct from 'draft'
      or new.curated_at is not null
      or new.curated_by is not null
    )
  ) or (
    tg_op = 'UPDATE' and (
      new.curation_status is distinct from old.curation_status
      or new.curated_at is distinct from old.curated_at
      or new.curated_by is distinct from old.curated_by
    )
  )) then
    raise exception 'drill curation fields are service-managed';
  end if;
  return new;
end;
$$;

create trigger protect_drill_curation_fields
before insert or update on public.drill_library
for each row execute function public.protect_drill_curation_fields();
