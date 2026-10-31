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
