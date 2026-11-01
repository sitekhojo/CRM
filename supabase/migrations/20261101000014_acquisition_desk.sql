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
