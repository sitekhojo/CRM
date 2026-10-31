-- Regions, team roster and site owners.
-- Everyone shares one login, so ownership is a team-member name, not a login.

alter table public.cities add column if not exists region text;
alter table public.cities add column if not exists owner text;   -- default owner for new sites in this city

create table if not exists public.team_members (
  id serial primary key,
  name text not null unique,
  region text not null,
  is_lead boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 100
);
alter table public.team_members enable row level security;
drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to authenticated using (true);
drop policy if exists team_members_admin on public.team_members;
create policy team_members_admin on public.team_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.team_members to authenticated;
grant usage, select on sequence public.team_members_id_seq to authenticated;

alter table public.sites add column if not exists owner text;

-- New sites get the city's default owner when none is given.
create or replace function public.sites_default_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner is null or btrim(new.owner) = '' then
    select c.owner into new.owner from public.cities c where lower(c.name) = lower(new.city) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists sites_default_owner on public.sites;
create trigger sites_default_owner before insert on public.sites
  for each row execute function public.sites_default_owner();

-- Expose owner + region in the overview view (appended columns).
create or replace view public.site_overview with (security_invoker = true) as
select s.id, s.site_code, s.name, s.address, s.city, s.pincode, s.latitude, s.longitude,
  s.location_source, s.location_accuracy_m, s.site_type, s.area_sqft, s.landlord_name,
  s.landlord_phone, s.landlord_email, s.landlord_notes, s.rent_expectation,
  s.deposit_expectation, s.rent_negotiable, s.observations, s.power_available,
  s.power_phase, s.sanctioned_load_kw, s.power_feasibility, s.power_notes, s.remarks,
  s.stage_id, s.stage_entered_at, s.stage_note, s.drop_reason, s.drop_notes,
  s.assigned_to, s.created_by, s.created_at, s.updated_by, s.updated_at, s.extra,
  s.record_type,
  st.name as stage_name, st.color as stage_color, st.category as stage_category,
  st.sort_order as stage_order, st.sla_days as stage_sla_days,
  cb.full_name as created_by_name, ab.full_name as assigned_to_name,
  round(extract(epoch from now() - s.stage_entered_at) / 86400.0, 1) as days_in_stage,
  (st.category = any (array['active', 'approved'])) and st.sla_days is not null
    and (now() - s.stage_entered_at) > make_interval(days => st.sla_days) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::integer as comment_count,
  s.owner,
  ci.region
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to
left join lateral (select c.region from public.cities c where lower(c.name) = lower(s.city) limit 1) ci on true;

-- ---- Data: cities we operate in ----
insert into public.cities (name, state, is_active) values ('Kolkata', 'West Bengal', true)
  on conflict do nothing;
update public.cities set is_active = false, region = null, owner = null;
update public.cities c set is_active = true, region = v.region, owner = v.owner
from (values
  ('Delhi','North','Swarnim'), ('Gurugram','North','Swarnim'), ('Noida','North','Swarnim'),
  ('Ghaziabad','North','Swarnim'), ('Faridabad','North','Swarnim'), ('Jaipur','North','Swarnim'),
  ('Bengaluru','South','Avinash Shaw'), ('Hyderabad','South','Avinash Shaw'), ('Chennai','South','Avinash Shaw'),
  ('Mumbai','West','Azim'), ('Pune','West','Azim'), ('Ahmedabad','West','Azim'),
  ('Kolkata','East','Sneh')
) v(name, region, owner) where c.name = v.name;

insert into public.team_members (name, region, is_lead, sort_order) values
  ('Swarnim','North',true,1), ('Sachin','North',false,2), ('Shashank','North',false,3),
  ('Ankit','North',false,4), ('Rakesh','North',false,5), ('Alok','North',false,6),
  ('Avinash Shaw','South',true,1), ('Neeman','South',false,2), ('Yunus','South',false,3), ('Ilyas','South',false,4),
  ('Azim','West',true,1), ('Amar','West',false,2), ('Pratik','West',false,3),
  ('Sneh','East',true,1)
on conflict (name) do update set region = excluded.region, is_lead = excluded.is_lead, sort_order = excluded.sort_order;

-- Existing sites -> their region lead (owner column is not touched by the stage triggers).
update public.sites s set owner = c.owner from public.cities c
 where lower(c.name) = lower(s.city) and s.owner is null;

-- Network data: one spelling per city so city/region filters catch every point.
update public.network_points set city = 'Bengaluru' where city in ('Bangalore', 'Bengaluru ');
update public.network_points set city = 'Gurugram'  where city = 'Gurgaon';
update public.network_points set city = 'Panipat'   where city = 'PaniPat';
