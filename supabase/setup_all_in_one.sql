-- =====================================================================
-- Site Khojo CRM — core schema
-- Run in Supabase SQL editor (or `supabase db push`) in file order.
-- =====================================================================

-- ---------- Types ----------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'team');
exception when duplicate_object then null; end $$;

-- ---------- Users / profiles ----------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  phone       text,
  role        public.app_role not null default 'team',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Configuration tables ------------------------------------
create table if not exists public.stages (
  id          serial primary key,
  key         text not null unique,
  name        text not null,
  sort_order  int  not null,
  color       text not null default '#64748b',
  sla_days    int  check (sla_days is null or sla_days > 0),
  -- active = in pipeline; approved / live / dropped = outcome buckets
  category    text not null default 'active'
              check (category in ('active', 'approved', 'live', 'dropped')),
  admin_only  boolean not null default false,   -- only admins may move a site INTO this stage
  is_active   boolean not null default true
);

create table if not exists public.cities (
  id        serial primary key,
  name      text not null unique,
  state     text,
  is_active boolean not null default true
);

create table if not exists public.drop_reasons (
  id        serial primary key,
  label     text not null unique,
  is_active boolean not null default true
);

-- ---------- Sites ----------------------------------------------------
create sequence if not exists public.site_code_seq;

create table if not exists public.sites (
  id                    uuid primary key default gen_random_uuid(),
  site_code             text not null unique
                        default ('SK-' || lpad(nextval('public.site_code_seq')::text, 5, '0')),
  name                  text not null check (length(trim(name)) > 0),
  address               text,
  city                  text not null,
  pincode               text,
  latitude              double precision not null check (latitude between -90 and 90),
  longitude             double precision not null check (longitude between -180 and 180),
  location_source       text not null default 'gps' check (location_source in ('gps', 'manual', 'map', 'import')),
  location_accuracy_m   numeric,

  site_type             text,          -- e.g. Petrol pump, Parking lot, Shop front
  area_sqft             numeric check (area_sqft is null or area_sqft >= 0),

  landlord_name         text,
  landlord_phone        text,
  landlord_email        text,
  landlord_notes        text,

  rent_expectation      numeric check (rent_expectation is null or rent_expectation >= 0), -- INR / month
  deposit_expectation   numeric check (deposit_expectation is null or deposit_expectation >= 0),
  rent_negotiable       boolean,
  observations          text,

  power_available       boolean,
  power_phase           text check (power_phase is null or power_phase in ('single', 'three')),
  sanctioned_load_kw    numeric check (sanctioned_load_kw is null or sanctioned_load_kw >= 0),
  power_feasibility     text not null default 'unknown'
                        check (power_feasibility in ('feasible', 'upgrade_required', 'not_feasible', 'unknown')),
  power_notes           text,

  remarks               text,

  stage_id              int not null references public.stages(id),
  stage_entered_at      timestamptz not null default now(),
  stage_note            text,          -- note attached to the latest stage change (copied to history)
  drop_reason           text,
  drop_notes            text,
  assigned_to           uuid references public.profiles(id) on delete set null,

  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id) on delete set null,
  updated_at            timestamptz not null default now(),

  extra                 jsonb not null default '{}'::jsonb   -- room for future network-planning attributes
);

create index if not exists sites_city_idx        on public.sites (city);
create index if not exists sites_stage_idx       on public.sites (stage_id);
create index if not exists sites_created_by_idx  on public.sites (created_by);
create index if not exists sites_assigned_to_idx on public.sites (assigned_to);
create index if not exists sites_created_at_idx  on public.sites (created_at desc);

-- ---------- Stage history -------------------------------------------
create table if not exists public.site_stage_history (
  id                  bigserial primary key,
  site_id             uuid not null references public.sites(id) on delete cascade,
  from_stage_id       int references public.stages(id),
  to_stage_id         int not null references public.stages(id),
  changed_by          uuid references public.profiles(id) on delete set null,
  changed_at          timestamptz not null default now(),
  days_in_from_stage  numeric,       -- time spent in from_stage before this change
  note                text,
  drop_reason         text
);
create index if not exists ssh_site_idx on public.site_stage_history (site_id, changed_at);

-- ---------- Network planning reference data ----------------------
-- Existing stations, competitor stations, demand hotspots etc. used by the
-- feasibility checker. Live deals in the CRM are also treated as own stations.
create table if not exists public.network_points (
  id          bigserial primary key,
  point_type  text not null check (point_type in ('own_station', 'competitor', 'demand_hotspot', 'restricted')),
  name        text not null,
  city        text,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  weight      numeric not null default 1,      -- e.g. daily swaps / demand score
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists network_points_type_idx on public.network_points (point_type);

-- Key/value app settings (feasibility rules etc.)
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------- Comments ------------------------------------------------
create table if not exists public.site_comments (
  id          bigserial primary key,
  site_id     uuid not null references public.sites(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists site_comments_site_idx on public.site_comments (site_id, created_at);


-- =====================================================================
-- Helper functions
-- =====================================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

-- New auth user -> profile. The very first user becomes admin; afterwards the
-- role comes from app_metadata.role (only settable server-side) or defaults to team.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  elsif coalesce(new.raw_app_meta_data->>'role', '') in ('admin', 'team') then
    v_role := (new.raw_app_meta_data->>'role')::public.app_role;
  else
    v_role := 'team';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          v_role)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles: non-admins cannot change role / active flag; always keep one active admin.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role      := old.role;
    new.is_active := old.is_active;
    new.email     := old.email;
  end if;
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    if (select count(*) from public.profiles where role = 'admin' and is_active and id <> old.id) = 0 then
      raise exception 'At least one active admin is required';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();


-- =====================================================================
-- Site lifecycle triggers
-- =====================================================================
create or replace function public.sites_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  if new.stage_id is null then
    select id into new.stage_id from public.stages
     where is_active order by sort_order limit 1;
  end if;
  select * into v_stage from public.stages where id = new.stage_id;

  if auth.uid() is not null then
    new.created_by := auth.uid();
    if not v_admin then
      new.assigned_to := auth.uid();         -- scouts own what they submit
      if v_stage.admin_only then
        raise exception 'Only admins can create a site in stage "%"', v_stage.name;
      end if;
    else
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
    end if;
  end if;

  if v_stage.category = 'dropped' and coalesce(trim(new.drop_reason), '') = '' then
    raise exception 'A drop reason is required';
  end if;

  -- admins may back-date imported sites; everyone else gets server time
  if (auth.uid() is not null and not v_admin) or new.created_at is null or new.created_at > now() then
    new.created_at := now();
  end if;
  new.updated_at       := now();
  new.updated_by       := new.created_by;
  new.stage_entered_at := now();
  return new;
end $$;

create or replace function public.sites_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.site_stage_history (site_id, from_stage_id, to_stage_id, changed_by, changed_at, note, drop_reason)
  values (new.id, null, new.stage_id, new.created_by, new.created_at,
          coalesce(new.stage_note, 'Site created'), new.drop_reason);
  return new;
end $$;

create or replace function public.sites_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  -- immutable columns
  new.id         := old.id;
  new.site_code  := old.site_code;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);

  if auth.uid() is not null and not v_admin
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only admins can reassign sites';
  end if;

  if new.stage_id is distinct from old.stage_id then
    select * into v_stage from public.stages where id = new.stage_id;

    if auth.uid() is not null and not v_admin then
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'You can only change the stage of sites assigned to you';
      end if;
      if v_stage.admin_only then
        raise exception 'Only admins can move a site to "%"', v_stage.name;
      end if;
    end if;

    if v_stage.category = 'dropped' then
      if coalesce(trim(new.drop_reason), '') = '' then
        raise exception 'A drop reason is required';
      end if;
    else
      new.drop_reason := null;
      new.drop_notes  := null;
    end if;
    new.stage_entered_at := now();
  else
    new.stage_entered_at := old.stage_entered_at;
    new.stage_note       := old.stage_note;
  end if;
  return new;
end $$;

create or replace function public.sites_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.site_stage_history
      (site_id, from_stage_id, to_stage_id, changed_by, changed_at, days_in_from_stage, note, drop_reason)
    values
      (new.id, old.stage_id, new.stage_id, new.updated_by, new.stage_entered_at,
       round((extract(epoch from (new.stage_entered_at - old.stage_entered_at)) / 86400.0)::numeric, 2),
       new.stage_note, new.drop_reason);
  end if;
  return new;
end $$;

drop trigger if exists sites_before_insert on public.sites;
create trigger sites_before_insert before insert on public.sites
  for each row execute function public.sites_before_insert();
drop trigger if exists sites_after_insert on public.sites;
create trigger sites_after_insert after insert on public.sites
  for each row execute function public.sites_after_insert();
drop trigger if exists sites_before_update on public.sites;
create trigger sites_before_update before update on public.sites
  for each row execute function public.sites_before_update();
drop trigger if exists sites_after_update on public.sites;
create trigger sites_after_update after update on public.sites
  for each row execute function public.sites_after_update();


-- =====================================================================
-- Reporting views (security_invoker => caller's RLS applies)
-- =====================================================================
create or replace view public.site_overview with (security_invoker = true) as
select
  s.*,
  st.name        as stage_name,
  st.color       as stage_color,
  st.category    as stage_category,
  st.sort_order  as stage_order,
  st.sla_days    as stage_sla_days,
  cb.full_name   as created_by_name,
  ab.full_name   as assigned_to_name,
  round((extract(epoch from (now() - s.stage_entered_at)) / 86400.0)::numeric, 1) as days_in_stage,
  (st.category = 'active' and st.sla_days is not null
     and now() - s.stage_entered_at > make_interval(days => st.sla_days)) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::int as comment_count
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to;

create or replace view public.stage_history_overview with (security_invoker = true) as
select
  h.*,
  fs.name as from_stage_name, fs.sort_order as from_stage_order,
  ts.name as to_stage_name,   ts.sort_order as to_stage_order, ts.color as to_stage_color,
  p.full_name as changed_by_name,
  s.city, s.created_by as site_created_by, s.name as site_name, s.site_code
from public.site_stage_history h
join public.sites s on s.id = h.site_id
left join public.stages fs on fs.id = h.from_stage_id
join public.stages ts on ts.id = h.to_stage_id
left join public.profiles p on p.id = h.changed_by;
-- =====================================================================
-- Site Khojo CRM — grants + row level security
-- =====================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin(), public.is_active_user() to authenticated;
revoke all on all tables in schema public from anon;

alter table public.profiles            enable row level security;
alter table public.stages              enable row level security;
alter table public.cities              enable row level security;
alter table public.drop_reasons        enable row level security;
alter table public.sites               enable row level security;
alter table public.site_stage_history  enable row level security;
alter table public.network_points      enable row level security;
alter table public.app_settings        enable row level security;
alter table public.site_comments       enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- inserts happen via the auth trigger; deletes via auth.users cascade

-- ---------- config tables: everyone reads, admins write ----------
do $$
declare t text;
begin
  foreach t in array array['stages', 'cities', 'drop_reasons', 'network_points', 'app_settings'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------- sites ----------
-- Every active user can SEE all sites (avoids duplicate scouting on the map);
-- team members EDIT only sites they created or are assigned to.
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (public.is_active_user());
drop policy if exists sites_insert on public.sites;
create policy sites_insert on public.sites for insert to authenticated
  with check (public.is_active_user());
drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (public.is_admin() or (public.is_active_user() and (created_by = auth.uid() or assigned_to = auth.uid())))
  with check (public.is_admin() or (public.is_active_user() and (created_by = auth.uid() or assigned_to = auth.uid())));
drop policy if exists sites_delete on public.sites;
create policy sites_delete on public.sites for delete to authenticated
  using (public.is_admin());

-- ---------- stage history (written only by triggers) ----------
drop policy if exists ssh_select on public.site_stage_history;
create policy ssh_select on public.site_stage_history for select to authenticated
  using (public.is_active_user());
revoke insert, update, delete on public.site_stage_history from authenticated;

-- ---------- comments ----------
drop policy if exists comments_select on public.site_comments;
create policy comments_select on public.site_comments for select to authenticated
  using (public.is_active_user());
drop policy if exists comments_insert on public.site_comments;
create policy comments_insert on public.site_comments for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());
drop policy if exists comments_delete on public.site_comments;
create policy comments_delete on public.site_comments for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());
revoke update on public.site_comments from authenticated;
-- =====================================================================
-- Site Khojo CRM — default configuration (safe to re-run)
-- Edit later from the app: Admin → Settings
-- =====================================================================

insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only) values
  ('new_lead',          'New Lead',               1,  '#94a3b8', 3,    'active',   false),
  ('scouted',           'Scouted',                2,  '#3b82f6', 5,    'active',   false),
  ('initial_eval',      'Initial Evaluation',     3,  '#6366f1', 7,    'active',   false),
  ('tech_feasibility',  'Technical Feasibility',  4,  '#8b5cf6', 10,   'active',   false),
  ('commercial',        'Commercial Negotiation', 5,  '#f59e0b', 14,   'active',   false),
  ('documentation',     'Documentation',          6,  '#f97316', 14,   'active',   false),
  ('internal_approval', 'Internal Approval',      7,  '#ec4899', 7,    'active',   false),
  ('approved',          'Approved',               8,  '#14b8a6', null, 'approved', true),
  ('deployment',        'Deployment',             9,  '#0ea5e9', 30,   'active',   false),
  ('live',              'Live',                   10, '#22c55e', null, 'live',     true),
  ('dropped',           'Dropped',                11, '#ef4444', null, 'dropped',  false)
on conflict (key) do nothing;

insert into public.cities (name, state) values
  ('Bengaluru', 'Karnataka'), ('Delhi', 'Delhi'), ('Gurugram', 'Haryana'), ('Noida', 'Uttar Pradesh'),
  ('Ghaziabad', 'Uttar Pradesh'), ('Faridabad', 'Haryana'), ('Hyderabad', 'Telangana'), ('Chennai', 'Tamil Nadu'),
  ('Mumbai', 'Maharashtra'), ('Pune', 'Maharashtra'), ('Kolkata', 'West Bengal'), ('Jaipur', 'Rajasthan'),
  ('Ahmedabad', 'Gujarat'), ('Lucknow', 'Uttar Pradesh'), ('Chandigarh', 'Chandigarh'), ('Indore', 'Madhya Pradesh'),
  ('Patna', 'Bihar'), ('Bhubaneswar', 'Odisha'), ('Kochi', 'Kerala'), ('Coimbatore', 'Tamil Nadu'),
  ('Visakhapatnam', 'Andhra Pradesh'), ('Nagpur', 'Maharashtra'), ('Surat', 'Gujarat')
on conflict (name) do nothing;

insert into public.drop_reasons (label) values
  ('Landlord not interested'), ('Rent too high'), ('Power not feasible'), ('Too close to existing station'),
  ('Low demand / footfall'), ('Space too small'), ('Legal / documentation issue'), ('Access / visibility issue'),
  ('Competitor already present'), ('Duplicate entry'), ('Other')
on conflict (label) do nothing;

-- Feasibility rules used by Network Planning (distances in metres)
insert into public.app_settings (key, value) values
  ('feasibility_rules', '{
     "search_radius_m": 3000,
     "min_distance_own_station_m": 1500,
     "ideal_max_distance_own_station_m": 5000,
     "duplicate_radius_m": 150,
     "competitor_radius_m": 1000,
     "max_competitors_in_radius": 2,
     "demand_radius_m": 2000,
     "min_demand_points": 1,
     "restricted_radius_m": 200
   }'::jsonb)
on conflict (key) do nothing;
-- =====================================================================
-- Site Khojo CRM — v1.1: Lead vs Deal, new stages, site types
-- Safe to re-run.
-- =====================================================================

-- 1. Every record is either a Lead or a Deal
alter table public.sites
  add column if not exists record_type text not null default 'deal';
do $$ begin
  alter table public.sites add constraint sites_record_type_chk check (record_type in ('lead', 'deal'));
exception when duplicate_object then null; end $$;
create index if not exists sites_record_type_idx on public.sites (record_type);
create index if not exists sites_site_type_idx on public.sites (site_type);

-- 2. New pipeline stages
insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only) values
  ('site_feasibility', 'Site Feasibility',       4,  '#a855f7', 7,  'active', false),
  ('loi_signed',       'LOI / Agreement Signed', 7,  '#eab308', 10, 'active', false),
  ('deployment_ho',    'Deployment HO',          11, '#06b6d4', 7,  'active', false)
on conflict (key) do nothing;

update public.stages set sort_order = case key
  when 'new_lead' then 1          when 'scouted' then 2           when 'initial_eval' then 3
  when 'site_feasibility' then 4  when 'tech_feasibility' then 5  when 'commercial' then 6
  when 'loi_signed' then 7        when 'documentation' then 8     when 'internal_approval' then 9
  when 'approved' then 10         when 'deployment_ho' then 11    when 'deployment' then 12
  when 'live' then 13             when 'dropped' then 14          else sort_order end;

-- 3. Rebuild the overview view so it includes the new column
drop view if exists public.site_overview;
create view public.site_overview with (security_invoker = true) as
select
  s.*,
  st.name        as stage_name,
  st.color       as stage_color,
  st.category    as stage_category,
  st.sort_order  as stage_order,
  st.sla_days    as stage_sla_days,
  cb.full_name   as created_by_name,
  ab.full_name   as assigned_to_name,
  round((extract(epoch from (now() - s.stage_entered_at)) / 86400.0)::numeric, 1) as days_in_stage,
  (st.category = 'active' and st.sla_days is not null
     and now() - s.stage_entered_at > make_interval(days => st.sla_days)) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::int as comment_count
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to;

grant select on public.site_overview to authenticated;
-- =====================================================================
-- Site Khojo CRM — v1.2: simplified common pipeline (all site types)
--   Scouting → Deployment Feasibility → LOI Signed → Agreement Signed → Agreement Registered
--   → Handover Done → Energized → Live          + Hold, Dropped (any time)
-- Teams can move to ANY stage in any order (e.g. North: agreement after Live).
-- stages.site_types lets a stage be limited to some site types later (NULL = all).
-- Safe to re-run.
-- =====================================================================

-- 1. Stage options
alter table public.stages add column if not exists site_types text[];
alter table public.stages drop constraint if exists stages_category_check;
alter table public.stages add constraint stages_category_check
  check (category in ('active', 'approved', 'live', 'hold', 'dropped'));

-- 2. Rename site type Pvt → Private
update public.sites set site_type = 'Private' where site_type in ('Pvt', 'pvt', 'PVT', 'private');

-- 3. The stage list
insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only) values
  ('scouting',               'Scouting',               1,  '#3b82f6', 3,    'active',   false),
  ('deployment_feasibility', 'Deployment Feasibility', 2,  '#8b5cf6', 7,    'active',   false),
  ('loi_signed',             'LOI Signed',             3,  '#eab308', 10,   'active',   false),
  ('agreement_signed',       'Agreement Signed',       4,  '#f97316', 15,   'approved', false),
  ('agreement_registered',   'Agreement Registered',   5,  '#ec4899', 10,   'approved', false),
  ('ho_done',                'Handover Done',          6,  '#06b6d4', 15,   'approved', false),
  ('energized',              'Energized',              7,  '#14b8a6', 15,   'approved', false),
  ('live',                   'Live',                   8,  '#22c55e', null, 'live',     false),
  ('hold',                   'Hold',                   9,  '#64748b', null, 'hold',     false),
  ('dropped',                'Dropped',                10, '#ef4444', null, 'dropped',  false)
on conflict (key) do nothing;

update public.stages t set
  name = v.name, sort_order = v.ord, category = v.cat, is_active = true, admin_only = false, site_types = null
from (values
  ('scouting', 'Scouting', 1, 'active'), ('deployment_feasibility', 'Deployment Feasibility', 2, 'active'),
  ('loi_signed', 'LOI Signed', 3, 'active'), ('agreement_signed', 'Agreement Signed', 4, 'approved'),
  ('agreement_registered', 'Agreement Registered', 5, 'approved'), ('ho_done', 'Handover Done', 6, 'approved'),
  ('energized', 'Energized', 7, 'approved'), ('live', 'Live', 8, 'live'), ('hold', 'Hold', 9, 'hold'),
  ('dropped', 'Dropped', 10, 'dropped')
) as v(key, name, ord, cat)
where t.key = v.key;

-- 4. Move existing records off retired stages (writes a history entry for each), then retire them
create temp table stage_map (old_key text, new_key text) on commit drop;
insert into stage_map values
  ('new_lead', 'scouting'), ('scouted', 'scouting'),
  ('initial_eval', 'deployment_feasibility'), ('site_feasibility', 'deployment_feasibility'),
  ('tech_feasibility', 'deployment_feasibility'), ('commercial', 'deployment_feasibility'),
  ('documentation', 'deployment_feasibility'), ('internal_approval', 'deployment_feasibility'),
  ('approved', 'agreement_signed'), ('deployment_ho', 'ho_done'), ('deployment', 'ho_done'),
  ('energized_commercialized', 'live');

update public.sites s
   set stage_id = ns.id, stage_note = 'Moved to new pipeline (was ' || os.name || ')'
  from stage_map m
  join public.stages os on os.key = m.old_key
  join public.stages ns on ns.key = m.new_key
 where s.stage_id = os.id;

update public.stages set is_active = false
 where key in (select old_key from stage_map);

-- 5. Enforce stage ↔ site type in the database
create or replace function public.stage_allowed(p_stage int, p_site_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select site_types is null or p_site_type is null or p_site_type = any(site_types)
                     from public.stages where id = p_stage), true);
$$;

create or replace function public.sites_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  if new.stage_id is null then
    select id into new.stage_id from public.stages
     where is_active and category = 'active'
       and (site_types is null or new.site_type is null or new.site_type = any(site_types))
     order by sort_order limit 1;
  end if;
  select * into v_stage from public.stages where id = new.stage_id;

  if not public.stage_allowed(new.stage_id, new.site_type) then
    raise exception 'Stage "%" is only for % sites', v_stage.name, array_to_string(v_stage.site_types, ' / ');
  end if;

  if auth.uid() is not null then
    new.created_by := auth.uid();
    if not v_admin then
      new.assigned_to := auth.uid();
      if v_stage.admin_only then
        raise exception 'Only admins can create a site in stage "%"', v_stage.name;
      end if;
    else
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
    end if;
  end if;

  if v_stage.category = 'dropped' and coalesce(trim(new.drop_reason), '') = '' then
    raise exception 'A drop reason is required';
  end if;

  if (auth.uid() is not null and not v_admin) or new.created_at is null or new.created_at > now() then
    new.created_at := now();
  end if;
  new.updated_at       := now();
  new.updated_by       := new.created_by;
  new.stage_entered_at := now();
  return new;
end $$;

create or replace function public.sites_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  new.id         := old.id;
  new.site_code  := old.site_code;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);

  if auth.uid() is not null and not v_admin
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only admins can reassign sites';
  end if;

  if new.stage_id is distinct from old.stage_id then
    select * into v_stage from public.stages where id = new.stage_id;

    if auth.uid() is not null and not v_admin then
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'You can only change the stage of sites assigned to you';
      end if;
      if v_stage.admin_only then
        raise exception 'Only admins can move a site to "%"', v_stage.name;
      end if;
    end if;

    if v_stage.category = 'dropped' then
      if coalesce(trim(new.drop_reason), '') = '' then
        raise exception 'A drop reason is required';
      end if;
    else
      new.drop_reason := null;
      new.drop_notes  := null;
    end if;
    new.stage_entered_at := now();
  else
    new.stage_entered_at := old.stage_entered_at;
    new.stage_note       := old.stage_note;
  end if;

  if (new.stage_id is distinct from old.stage_id or new.site_type is distinct from old.site_type)
     and not public.stage_allowed(new.stage_id, new.site_type) then
    select * into v_stage from public.stages where id = new.stage_id;
    raise exception 'Stage "%" is only for % sites', v_stage.name, array_to_string(v_stage.site_types, ' / ');
  end if;
  return new;
end $$;

-- 6. SLA applies to every open stage (not Hold / Live / Dropped)
drop view if exists public.site_overview;
create view public.site_overview with (security_invoker = true) as
select
  s.*,
  st.name as stage_name, st.color as stage_color, st.category as stage_category,
  st.sort_order as stage_order, st.sla_days as stage_sla_days,
  cb.full_name as created_by_name, ab.full_name as assigned_to_name,
  round((extract(epoch from (now() - s.stage_entered_at)) / 86400.0)::numeric, 1) as days_in_stage,
  (st.category in ('active', 'approved') and st.sla_days is not null
     and now() - s.stage_entered_at > make_interval(days => st.sla_days)) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::int as comment_count
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to;

grant select on public.site_overview to authenticated;
-- Site Khojo v1.3: site type on network points (Franchise / Private / SPP / IOCL / Metro & Railways)
alter table public.network_points add column if not exists site_type text;
create index if not exists network_points_site_type_idx on public.network_points (site_type);

update public.network_points np set site_type = case
    when lbl in ('franchise') then 'Franchise'
    when lbl in ('private','hub-private','hub private','hub-pvt','private hub','pvt hub','priavte','pinkbull pvt') then 'Private'
    when lbl = 'iocl' then 'IOCL'
    when lbl in ('indian railways','railways','railway','dmrc','bmrcl','mmmocl','dmrc-navnirmaan','ngo dmrc','bypl dmrc') then 'Metro & Railways'
    else 'SPP' end
from (select id, lower(trim(split_part(notes, ' · ', 2))) lbl from public.network_points where point_type = 'own_station') t
where np.id = t.id and np.site_type is null;

update public.sites set site_type = 'Metro & Railways' where site_type in ('Metro', 'Railways');
-- Site Khojo v1.4: Energized (commercialized or not) is the final stage; Live retired.
update public.stages set name = 'Energized', category = 'live', sla_days = null, sort_order = 7, is_active = true where key = 'energized';
update public.sites set stage_id = (select id from public.stages where key = 'energized'), stage_note = 'Live merged into Energized'
 where stage_id = (select id from public.stages where key = 'live');
update public.stages set is_active = false where key = 'live';
update public.stages set sort_order = 8 where key = 'hold';
update public.stages set sort_order = 9 where key = 'dropped';
-- Site Khojo v1.5: per-day energization counts on network points (from QIS tracker).
-- Pipeline milestone dates live in sites.extra: ho_date, energized_on.
alter table public.network_points add column if not exists energized_dates jsonb;  -- {"YYYY-MM-DD": no. of QIS}
-- Site Khojo v1.6: Agreement Registered stage retired (no sites were in it)
update public.stages set is_active = false where key = 'agreement_registered';
-- Site Khojo v1.7: auto-stamp handover / energization dates (sites.extra.ho_date / energized_on)
-- and keep "days in stage" aligned when those dates are edited.
create or replace function public.sites_milestones()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text;
  today text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
begin
  select key into k from public.stages where id = new.stage_id;
  new.extra := coalesce(new.extra, '{}'::jsonb);
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if k = 'ho_done' and coalesce(new.extra->>'ho_date', '') = '' then
      new.extra := new.extra || jsonb_build_object('ho_date', today);
    end if;
    if k = 'energized' and coalesce(new.extra->>'energized_on', '') = '' then
      new.extra := new.extra || jsonb_build_object('energized_on', today);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.stage_id = old.stage_id then
    if k = 'ho_done' and coalesce(new.extra->>'ho_date', '') <> ''
       and new.extra->>'ho_date' is distinct from old.extra->>'ho_date' then
      new.stage_entered_at := (new.extra->>'ho_date')::date + interval '6 hours';
    end if;
    if k = 'energized' and coalesce(new.extra->>'energized_on', '') <> ''
       and new.extra->>'energized_on' is distinct from old.extra->>'energized_on' then
      new.stage_entered_at := (new.extra->>'energized_on')::date + interval '6 hours';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sites_milestones on public.sites;
create trigger sites_milestones before insert or update on public.sites
  for each row execute function public.sites_milestones();
-- Location is optional: sites can be added without coordinates and located later.
alter table public.sites alter column latitude drop not null;
alter table public.sites alter column longitude drop not null;
alter table public.sites drop constraint if exists sites_location_source_check;
alter table public.sites add constraint sites_location_source_check
  check (location_source in ('gps','manual','map','import','none'));
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
-- SLAs are not defined yet: clear them (is_overdue becomes false everywhere).
-- Previous values, for reference: Scouting 3, Deployment Feasibility 7, LOI Signed 10,
-- Agreement Signed 15, Handover Done 15 (plus retired stages).
update public.stages set sla_days = null;
-- Acquisition Desk: priority target locations (P0–P4) with a target month.
-- Sites are matched to a location by distance (within radius_m) in the app.

create table if not exists public.target_locations (
  id bigserial primary key,
  name text not null,
  city text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  priority text not null default 'P0' check (priority in ('P0','P1','P2','P3','P4')),
  target_month date,                 -- first day of the month of acquisition
  radius_m integer not null default 1000 check (radius_m > 0),
  target_qis integer,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists target_locations_priority_idx on public.target_locations (priority);

alter table public.target_locations enable row level security;
drop policy if exists target_locations_read on public.target_locations;
create policy target_locations_read on public.target_locations for select to authenticated using (true);
drop policy if exists target_locations_admin on public.target_locations;
create policy target_locations_admin on public.target_locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.target_locations to authenticated;
grant usage, select on sequence public.target_locations_id_seq to authenticated;
